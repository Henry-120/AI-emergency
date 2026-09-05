"""
GuardiaAI SOS 多跳中繼 - 後端服務

這個檔案是前端 src/services/sos/{sosProtocol,sosCrypto}.ts 的 Python 對應實作，
線路格式（封包標頭、加密演算法、簽章格式）必須逐位元組一致，否則兩邊解不開彼此的資料。

對應關係：
    encode_header / decode_header   <-> sosProtocol.ts 的 encodePacket / decodePacket
    decrypt_sos_payload             <-> sosCrypto.ts 的 decryptAsBackend
    sign_ack                        <-> sosCrypto.ts 的 signAckAsBackend
    build_ack_packet                <-> 组出一個完整 ACK Packet 回傳給呼叫端

關鍵密碼學細節（與前端 Web Crypto API 對齊，任何一項不一致都會解密/驗簽失敗）：
    - ECDH 共享密鑰直接當 AES-256 金鑰使用，**不經過 HKDF**。
      Web Crypto 的 `deriveKey({name:"ECDH"}, ..., {name:"AES-GCM", length:256})`
      就是把 ECDH 的原始 X 座標（32 bytes，剛好等於 AES-256 金鑰長度）直接當金鑰，
      Python 的 `private_key.exchange(ec.ECDH(), peer_pub)` 回傳的正是同一段 bytes。
    - ECDSA 簽章用 **raw r‖s** 格式（各 32 bytes，共 64 bytes），
      不是 cryptography 預設的 DER 格式，需要用 decode_dss_signature 轉換。
"""

from __future__ import annotations

import json
import struct
import time
from dataclasses import dataclass
from typing import Optional

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils as ec_utils
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from sos_keys import ACK_SIGNING_PRIVATE_KEY_PEM, ENCRYPTION_PRIVATE_KEY_PEM, KEY_VERSION

# ---------------------------------------------------------------------------
# 封包標頭（對應 sosProtocol.ts，v3 格式——緊急度/是否受困/位置/位置描述/電量/
# 發送者識別碼都在明文標頭，見 sosTypes.ts 開頭的信任模型說明）
# ---------------------------------------------------------------------------

SOS_PROTOCOL_VERSION = 3
SOS_HEADER_FIXED_BYTES = 33
MSG_ID_LENGTH = 8
FROM_LOCAL_ID_BYTES = 8
MAX_LOCATION_DETAILS_BYTES = 120

PACKET_TYPE_SOS = 1
PACKET_TYPE_ALERT = 2
PACKET_TYPE_ACK = 3

FLAG_IS_TRAPPED = 1 << 0
FLAG_HAS_LOCATION = 1 << 1
FLAG_HAS_BATTERY = 1 << 2

# ECDH 臨時公鑰（raw，未壓縮點）長度；AES-GCM IV 長度；ECDSA raw 簽章長度
EPHEMERAL_KEY_BYTES = 65
IV_BYTES = 12
SIGNATURE_BYTES = 64


@dataclass
class PacketHeader:
    version: int
    key_version: int
    type: int
    msg_id: str
    ttl: int
    hops: int
    from_local_id: str
    urgency_level: int
    is_trapped: bool
    battery: Optional[int]
    location: Optional[tuple[float, float]]  # (lat, lng)
    location_details: str


@dataclass
class DecodedPacket:
    header: PacketHeader
    body: bytes


class SosProtocolError(ValueError):
    """封包格式不合法或無法解密——來源不可信，呼叫端應丟棄而非讓例外往外傳。"""


def decode_header(raw: bytes) -> DecodedPacket:
    """解析收到的封包。格式錯誤一律拋 SosProtocolError，呼叫端應回應失敗，不得當成有效求救。"""
    if len(raw) < SOS_HEADER_FIXED_BYTES:
        raise SosProtocolError("封包長度不足，缺少標頭")

    version = raw[0]
    if version != SOS_PROTOCOL_VERSION:
        raise SosProtocolError(f"不支援的協定版本：{version}")

    packet_type = raw[2]
    if packet_type not in (PACKET_TYPE_SOS, PACKET_TYPE_ALERT, PACKET_TYPE_ACK):
        raise SosProtocolError(f"未知的封包類型：{packet_type}")

    msg_id_bytes = raw[3 : 3 + MSG_ID_LENGTH]
    if any(b < 0x20 or b > 0x7E for b in msg_id_bytes):
        raise SosProtocolError("msgId 含不可列印字元，封包已損毀")
    msg_id = msg_id_bytes.decode("ascii")

    urgency_level = raw[13]
    if urgency_level > 10:
        raise SosProtocolError(f"urgencyLevel 超出範圍：{urgency_level}")

    flags = raw[14]
    battery = raw[15] if flags & FLAG_HAS_BATTERY else None
    location = None
    if flags & FLAG_HAS_LOCATION:
        lat = struct.unpack(">f", raw[16:20])[0]
        lng = struct.unpack(">f", raw[20:24])[0]
        location = (lat, lng)

    # fromLocalId：固定 8 bytes，去掉補位的 \0
    from_local_id = raw[24 : 24 + FROM_LOCAL_ID_BYTES].split(b"\x00", 1)[0]
    if any(b < 0x20 or b > 0x7E for b in from_local_id):
        raise SosProtocolError("fromLocalId 含不可列印字元，封包已損毀")

    location_details_len = raw[32]
    header_bytes = SOS_HEADER_FIXED_BYTES + location_details_len
    if len(raw) < header_bytes:
        raise SosProtocolError("封包長度不足，位置描述被截斷")

    try:
        location_details = raw[SOS_HEADER_FIXED_BYTES:header_bytes].decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SosProtocolError("位置描述不是合法 UTF-8") from exc

    header = PacketHeader(
        version=version,
        key_version=raw[1],
        type=packet_type,
        msg_id=msg_id,
        ttl=raw[11],
        hops=raw[12],
        from_local_id=from_local_id.decode("ascii"),
        urgency_level=urgency_level,
        is_trapped=bool(flags & FLAG_IS_TRAPPED),
        battery=battery,
        location=location,
        location_details=location_details,
    )
    return DecodedPacket(header=header, body=bytes(raw[header_bytes:]))


def encode_header(header: PacketHeader, body: bytes) -> bytes:
    """組出完整封包 bytes：標頭 + body。對應 sosProtocol.ts 的 encodePacket。"""
    if len(header.msg_id) != MSG_ID_LENGTH:
        raise SosProtocolError(f"msgId 必須是 {MSG_ID_LENGTH} 個字元")

    location_details_bytes = header.location_details.encode("utf-8")
    if len(location_details_bytes) > MAX_LOCATION_DETAILS_BYTES:
        raise SosProtocolError(f"位置描述過長（>{MAX_LOCATION_DETAILS_BYTES} bytes）")

    header_bytes = SOS_HEADER_FIXED_BYTES + len(location_details_bytes)
    out = bytearray(header_bytes + len(body))
    out[0] = header.version
    out[1] = header.key_version
    out[2] = header.type
    out[3 : 3 + MSG_ID_LENGTH] = header.msg_id.encode("ascii")
    out[11] = header.ttl
    out[12] = header.hops
    out[13] = header.urgency_level

    flags = 0
    if header.is_trapped:
        flags |= FLAG_IS_TRAPPED
    if header.location is not None:
        flags |= FLAG_HAS_LOCATION
    if header.battery is not None:
        flags |= FLAG_HAS_BATTERY
    out[14] = flags

    out[15] = header.battery if header.battery is not None else 0
    lat, lng = header.location if header.location is not None else (0.0, 0.0)
    out[16:20] = struct.pack(">f", lat)
    out[20:24] = struct.pack(">f", lng)

    from_local_id_bytes = header.from_local_id.encode("ascii")
    if len(from_local_id_bytes) > FROM_LOCAL_ID_BYTES:
        raise SosProtocolError(f"fromLocalId 不得超過 {FROM_LOCAL_ID_BYTES} 個字元")
    out[24 : 24 + len(from_local_id_bytes)] = from_local_id_bytes

    out[32] = len(location_details_bytes)
    out[SOS_HEADER_FIXED_BYTES:header_bytes] = location_details_bytes
    out[header_bytes:] = body
    return bytes(out)


# ---------------------------------------------------------------------------
# 解密求救內容（對應 sosCrypto.ts 的 decryptAsBackend）
# ---------------------------------------------------------------------------

def _load_private_key(value: str, variable_name: str):
    if not value:
        raise SosProtocolError(f"後端尚未設定 {variable_name}")
    try:
        return serialization.load_pem_private_key(value.encode(), password=None)
    except Exception as exc:  # noqa: BLE001 - runtime secret validation
        raise SosProtocolError(f"{variable_name} 格式無效") from exc


def decrypt_sos_payload(body: bytes) -> dict:
    """
    解密 SOS/ALERT 封包的 body。

    線路格式：臨時公鑰(65 bytes) ‖ IV(12 bytes) ‖ 密文+GCM認證標籤

    @raises SosProtocolError 格式不合法、金鑰不對、或內容被竄改（GCM tag 驗證失敗）
    """
    if len(body) < EPHEMERAL_KEY_BYTES + IV_BYTES:
        raise SosProtocolError("body 長度不足，無法解密")

    ephemeral_public_raw = body[:EPHEMERAL_KEY_BYTES]
    iv = body[EPHEMERAL_KEY_BYTES : EPHEMERAL_KEY_BYTES + IV_BYTES]
    ciphertext = body[EPHEMERAL_KEY_BYTES + IV_BYTES :]

    try:
        ephemeral_public_key = ec.EllipticCurvePublicKey.from_encoded_point(
            ec.SECP256R1(), ephemeral_public_raw
        )
        # 與前端 Web Crypto 的 deriveKey({name:"ECDH"}, ...) 對齊：
        # 共享密鑰（X 座標，32 bytes）直接當 AES-256 金鑰，無 HKDF。
        encryption_private_key = _load_private_key(
            ENCRYPTION_PRIVATE_KEY_PEM, "SOS_ENCRYPTION_PRIVATE_KEY_PEM"
        )
        shared_key = encryption_private_key.exchange(ec.ECDH(), ephemeral_public_key)
        plaintext = AESGCM(shared_key).decrypt(iv, ciphertext, None)
        return json.loads(plaintext.decode("utf-8"))
    except SosProtocolError:
        raise
    except Exception as exc:  # noqa: BLE001 - 來源不可信，任何失敗都視為解密失敗
        raise SosProtocolError(f"解密失敗：{exc}") from exc


# ---------------------------------------------------------------------------
# 簽章 ACK（對應 sosCrypto.ts 的 signAckAsBackend）
# ---------------------------------------------------------------------------


def sign_ack(ref_id: str, uploaded_at_ms: Optional[int] = None) -> bytes:
    """
    簽署一則 ACK 回執。

    線路格式：簽章(64 bytes，raw r‖s) ‖ 明文 JSON body
    """
    payload = {
        "refId": ref_id,
        "uploadedAt": uploaded_at_ms if uploaded_at_ms is not None else int(time.time() * 1000),
    }
    body = json.dumps(payload).encode("utf-8")

    # cryptography 預設輸出 DER；前端 Web Crypto 用的是 raw r‖s，需要轉換格式。
    ack_signing_private_key = _load_private_key(
        ACK_SIGNING_PRIVATE_KEY_PEM, "SOS_ACK_SIGNING_PRIVATE_KEY_PEM"
    )
    der_signature = ack_signing_private_key.sign(body, ec.ECDSA(hashes.SHA256()))
    r, s = ec_utils.decode_dss_signature(der_signature)
    raw_signature = r.to_bytes(32, "big") + s.to_bytes(32, "big")

    return raw_signature + body


def build_ack_packet(msg_id: str, ttl: int = 4) -> bytes:
    """組出完整的 ACK Packet，回傳給呼叫端（有網路的中繼者），由他繼續往回傳播。"""
    ack_body = sign_ack(msg_id)
    header = PacketHeader(
        version=SOS_PROTOCOL_VERSION,
        key_version=KEY_VERSION,
        type=PACKET_TYPE_ACK,
        msg_id=msg_id,
        ttl=ttl,
        hops=0,
        from_local_id="",
        urgency_level=0,
        is_trapped=False,
        battery=None,
        location=None,
        location_details="",
    )
    return encode_header(header, ack_body)
