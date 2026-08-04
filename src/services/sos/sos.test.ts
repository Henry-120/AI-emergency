/**
 * SOS 多跳中繼 - 協定層測試
 *
 * 這裡驗證的是**不需要藍牙硬體**的部分：封包編解碼、加解密、簽章防偽、
 * 去重、TTL、電量門檻、轉發決策。
 *
 * 多跳中繼的端到端行為（三支手機接力）仍必須實機演練，無法在此證明。
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_TTL,
  MAX_TTL,
  SOS_HEADER_FIXED_BYTES,
  createHeader,
  decodePacket,
  decrementForRelay,
  encodePacket,
  generateMsgId,
} from "./sosProtocol";
import {
  decryptAsBackend,
  encryptForBackend,
  signAckAsBackend,
  verifyAck,
  bytesToBase64,
} from "./sosCrypto";
import { RelayStore } from "./relayStore";
import { RELAY_MIN_BATTERY, decideAction, isAckForMe, scanIntervalForBattery } from "./relayPolicy";
import {
  PacketType,
  RelayAction,
  type Packet,
  type RelayContext,
  type SosPayload,
} from "./sosTypes";

// ---------------------------------------------------------------------------
// 測試用金鑰（模擬後端）
// ---------------------------------------------------------------------------

let backendEncryptPrivate: CryptoKey;
let backendEncryptPublicB64: string;
let backendSignPrivate: CryptoKey;
let backendSignPublicB64: string;
/** 另一組金鑰，用來確認「不是後端」的人解不開、簽不了 */
let attackerSignPrivate: CryptoKey;

beforeAll(async () => {
  const enc = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"],
  );
  backendEncryptPrivate = enc.privateKey;
  backendEncryptPublicB64 = bytesToBase64(
    new Uint8Array(await crypto.subtle.exportKey("raw", enc.publicKey)),
  );

  const sign = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  backendSignPrivate = sign.privateKey;
  backendSignPublicB64 = bytesToBase64(
    new Uint8Array(await crypto.subtle.exportKey("raw", sign.publicKey)),
  );

  const attacker = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  attackerSignPrivate = attacker.privateKey;
});

function samplePayload(overrides: Partial<SosPayload> = {}): SosPayload {
  return {
    username: "王小明",
    injurySummary: "右腳受傷無法行走，鐵門變形打不開",
    rescueNeeds: ["醫療協助", "搬運/抬送"],
    mobilityStatus: "immobile",
    medical: { bloodType: "O+", drugAllergies: "盤尼西林" },
    timestamp: Date.UTC(2026, 6, 13),
    ...overrides,
  };
}

function makePacket(overrides: Partial<Packet["header"]> = {}, body = new Uint8Array([1, 2, 3])): Packet {
  return {
    header: {
      ...createHeader({
        type: PacketType.SOS,
        keyVersion: 1,
        fromLocalId: "AB2CD3",
        urgencyLevel: 7,
        isTrapped: true,
        battery: 63,
        location: { lat: 25.0339, lng: 121.5645 },
        locationDetails: "民生路 12 號三樓",
      }),
      ...overrides,
    },
    body,
  };
}

// ---------------------------------------------------------------------------
// 封包編解碼
// ---------------------------------------------------------------------------

describe("封包編碼與解碼", () => {
  it("編碼後再解碼，標頭與內容完全一致", () => {
    const packet = makePacket({}, new Uint8Array([9, 8, 7, 6]));
    const decoded = decodePacket(encodePacket(packet));

    // lat/lng 走 float32，精度會有微小損失，跟其餘欄位分開比對
    const { location, ...restOfOriginal } = packet.header;
    const { location: decodedLocation, ...restOfDecoded } = decoded!.header;
    expect(restOfDecoded).toEqual(restOfOriginal);
    expect(decodedLocation!.lat).toBeCloseTo(location!.lat, 4);
    expect(decodedLocation!.lng).toBeCloseTo(location!.lng, 4);
    expect(Array.from(decoded!.body)).toEqual([9, 8, 7, 6]);
  });

  it("標頭固定長度 + 位置描述變長段", () => {
    const encoded = encodePacket(makePacket({ locationDetails: "三樓" }, new Uint8Array(0)));
    const detailsBytes = new TextEncoder().encode("三樓").byteLength;
    expect(encoded.byteLength).toBe(SOS_HEADER_FIXED_BYTES + detailsBytes);
  });

  it("緊急度、是否受困、位置只存在於明文標頭，中繼者不解密也讀得到", () => {
    const decoded = decodePacket(encodePacket(makePacket({ urgencyLevel: 9, isTrapped: true })));

    expect(decoded!.header.urgencyLevel).toBe(9);
    expect(decoded!.header.isTrapped).toBe(true);
  });

  it("沒有位置/電量時，flags 正確反映為 undefined（不會誤讀出 0,0 座標）", () => {
    const decoded = decodePacket(
      encodePacket(makePacket({ location: undefined, battery: undefined })),
    );

    expect(decoded!.header.location).toBeUndefined();
    expect(decoded!.header.battery).toBeUndefined();
  });

  it.each([
    ["長度不足", new Uint8Array(5)],
    ["版本不符", new Uint8Array(SOS_HEADER_FIXED_BYTES).fill(0)],
  ])("損毀封包回傳 null 而非拋錯：%s", (_label, bytes) => {
    expect(decodePacket(bytes)).toBeNull();
  });

  it("拒絕型別不明的封包", () => {
    const encoded = encodePacket(makePacket());
    encoded[2] = 99; // 不存在的 type
    expect(decodePacket(encoded)).toBeNull();
  });

  it("拒絕 TTL 過大的封包（惡意端想讓訊息無限擴散、燒光所有人的電）", () => {
    const encoded = encodePacket(makePacket());
    encoded[11] = MAX_TTL + 1;
    expect(decodePacket(encoded)).toBeNull();
  });

  it("msgId 每次產生都不同", () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateMsgId()));
    expect(ids.size).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// TTL
// ---------------------------------------------------------------------------

describe("TTL 與跳數", () => {
  it("轉發時 TTL 減 1、hops 加 1，內容原封不動", () => {
    const original = makePacket({ ttl: 4, hops: 0 }, new Uint8Array([42]));
    const relayed = decrementForRelay(original)!;

    expect(relayed.header.ttl).toBe(3);
    expect(relayed.header.hops).toBe(1);
    expect(Array.from(relayed.body)).toEqual([42]); // 中繼者不碰內容
    expect(relayed.header.msgId).toBe(original.header.msgId); // 同一則訊息
  });

  it("TTL 歸零後不再轉發", () => {
    expect(decrementForRelay(makePacket({ ttl: 0 }))).toBeNull();
  });

  it("經過 DEFAULT_TTL 次接力後，訊息自然停止擴散", () => {
    let packet: Packet | null = makePacket({ ttl: DEFAULT_TTL });
    let hops = 0;

    while (packet) {
      const next: Packet | null = decrementForRelay(packet);
      if (!next) break;
      packet = next;
      hops++;
    }

    expect(hops).toBe(DEFAULT_TTL);
    expect(packet.header.hops).toBe(DEFAULT_TTL);
  });
});

// ---------------------------------------------------------------------------
// 加密：中繼者只搬箱子，不開箱
// ---------------------------------------------------------------------------

describe("求救內容加密", () => {
  it("後端能解密，且內容與原始求救完全一致", async () => {
    const payload = samplePayload();
    const body = await encryptForBackend(payload, backendEncryptPublicB64);

    expect(await decryptAsBackend(body, backendEncryptPrivate)).toEqual(payload);
  });

  it("中繼者拿到的密文裡看不到真實姓名、病史、傷勢摘要", async () => {
    const payload = samplePayload();
    const body = await encryptForBackend(payload, backendEncryptPublicB64);

    // 中繼者看到的就是這串 bytes。把它當字串搜尋，任何敏感字樣都不該出現。
    const asText = new TextDecoder().decode(body);
    const asBase64 = bytesToBase64(body);

    // 註：識別碼（AB2CD3）刻意不在此列——它本來就以明文廣播，v3 起也放在明文標頭
    for (const secret of ["王小明", "盤尼西林", "O+", "右腳受傷"]) {
      expect(asText).not.toContain(secret);
      expect(asBase64).not.toContain(secret);
    }
  });

  it("同一份內容加密兩次，密文不同（每則訊息用新的臨時金鑰）", async () => {
    const payload = samplePayload();
    const a = await encryptForBackend(payload, backendEncryptPublicB64);
    const b = await encryptForBackend(payload, backendEncryptPublicB64);

    expect(bytesToBase64(a)).not.toBe(bytesToBase64(b));
  });

  it("內容被竄改後解密失敗（AES-GCM 的完整性驗證）", async () => {
    const body = await encryptForBackend(samplePayload(), backendEncryptPublicB64);
    body[body.byteLength - 1] ^= 0xff; // 動一個 bit

    expect(await decryptAsBackend(body, backendEncryptPrivate)).toBeNull();
  });

  it("用錯的私鑰解不開", async () => {
    const wrong = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey"],
    );
    const body = await encryptForBackend(samplePayload(), backendEncryptPublicB64);

    expect(await decryptAsBackend(body, wrong.privateKey)).toBeNull();
  });

  it("損毀的密文回傳 null 而非拋錯", async () => {
    expect(await decryptAsBackend(new Uint8Array(10), backendEncryptPrivate)).toBeNull();
  });

  it("加密後的封包塞不進單一 BLE 包 —— 這正是分片非做不可的原因", async () => {
    const body = await encryptForBackend(samplePayload(), backendEncryptPublicB64);
    const packet = encodePacket(makePacket({ type: PacketType.SOS }, body));

    // MAX_FRAME_BYTES 是 180
    expect(packet.byteLength).toBeGreaterThan(180);
  });
});

// ---------------------------------------------------------------------------
// ACK 防偽：比洩漏內容更致命的攻擊面
// ---------------------------------------------------------------------------

describe("ACK 簽章", () => {
  const ack = { refId: "MSG12345", uploadedAt: Date.UTC(2026, 6, 13) };

  it("後端簽的 ACK 驗得過", async () => {
    const body = await signAckAsBackend(ack, backendSignPrivate);
    expect(await verifyAck(body, backendSignPublicB64)).toEqual(ack);
  });

  it("惡意節點用自己的金鑰偽造 ACK → 驗簽失敗", async () => {
    // 攻擊情境：中繼者偽造「求救已送達」，讓受困者放棄呼救。
    // 這比讀取內容更致命，所以必須擋下來。
    const forged = await signAckAsBackend(ack, attackerSignPrivate);
    expect(await verifyAck(forged, backendSignPublicB64)).toBeNull();
  });

  it("竄改 ACK 內容（改 refId）→ 驗簽失敗", async () => {
    const body = await signAckAsBackend(ack, backendSignPrivate);

    // 把簽章後的明文 refId 改掉，簽章就對不上了
    const text = new TextDecoder().decode(body.subarray(64));
    const tampered = new TextEncoder().encode(text.replace("MSG12345", "MSG99999"));
    const attack = new Uint8Array(64 + tampered.byteLength);
    attack.set(body.subarray(0, 64), 0);
    attack.set(tampered, 64);

    expect(await verifyAck(attack, backendSignPublicB64)).toBeNull();
  });

  it("沒有簽章的裸 ACK → 拒絕", async () => {
    const naked = new TextEncoder().encode(JSON.stringify(ack));
    expect(await verifyAck(naked, backendSignPublicB64)).toBeNull();
  });

  it("空的或過短的 body → 回傳 null 而非拋錯", async () => {
    expect(await verifyAck(new Uint8Array(0), backendSignPublicB64)).toBeNull();
    expect(await verifyAck(new Uint8Array(64), backendSignPublicB64)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 去重與待轉發佇列
// ---------------------------------------------------------------------------

describe("RelayStore", () => {
  it("記住看過的 msgId", () => {
    const store = new RelayStore();
    expect(store.hasSeen("MSG00001")).toBe(false);

    store.markSeen("MSG00001");
    expect(store.hasSeen("MSG00001")).toBe(true);
  });

  it("超過上限時淘汰最舊的 msgId", () => {
    const store = new RelayStore(3);
    ["A", "B", "C"].forEach((id) => store.markSeen(id));

    store.markSeen("D"); // 淘汰 A

    expect(store.hasSeen("A")).toBe(false);
    expect(store.hasSeen("D")).toBe(true);
    expect(store.seenCount).toBe(3);
  });

  it("同一則訊息重複排入待轉發，只會保留一份", () => {
    const store = new RelayStore();
    const packet = makePacket();

    store.enqueue(packet);
    store.enqueue(packet);

    expect(store.pendingCount).toBe(1);
  });

  it("收到 ACK 後可把對應的待轉發封包移除（後端已收到，不必再轉）", () => {
    const store = new RelayStore();
    const packet = makePacket();

    store.enqueue(packet);
    store.remove(packet.header.msgId);

    expect(store.pendingCount).toBe(0);
  });

  it("待轉發佇列有上限，惡意端灌不爆記憶體", () => {
    const store = new RelayStore(200, 5);
    for (let i = 0; i < 100; i++) {
      store.enqueue(makePacket({ msgId: `MSG${String(i).padStart(5, "0")}` }));
    }
    expect(store.pendingCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 轉發決策
// ---------------------------------------------------------------------------

describe("轉發決策", () => {
  function context(overrides: Partial<RelayContext> = {}): RelayContext {
    return {
      isOnline: false,
      batteryLevel: 80,
      localId: "ME1234",
      myPendingSosIds: new Set(),
      hasSeen: () => false,
      ...overrides,
    };
  }

  it("重複的封包直接丟棄（否則訊息會無限彈跳，燒乾所有人的電池）", () => {
    const packet = makePacket();
    const ctx = context({ hasSeen: (id) => id === packet.header.msgId });

    expect(decideAction(packet, ctx)).toBe(RelayAction.DROP_DUPLICATE);
  });

  it("有網路 → 上傳後端，訊息就此離開藍牙網路", () => {
    expect(decideAction(makePacket(), context({ isOnline: true }))).toBe(RelayAction.UPLOAD);
  });

  it("沒網路 + 電量充足 → 幫忙轉發", () => {
    expect(decideAction(makePacket(), context({ batteryLevel: 80 }))).toBe(RelayAction.RELAY);
  });

  it("電量過低 → 只接收不轉發（保住自己的求救能力優先）", () => {
    const ctx = context({ batteryLevel: RELAY_MIN_BATTERY - 1 });
    expect(decideAction(makePacket(), ctx)).toBe(RelayAction.DROP_LOW_BATTERY);
  });

  it("TTL 耗盡 → 不再轉發", () => {
    expect(decideAction(makePacket({ ttl: 0 }), context())).toBe(RelayAction.DROP_TTL_EXPIRED);
  });

  it("電量低但有網路時，仍然會上傳（上傳不像轉發那樣持續耗電）", () => {
    const ctx = context({ isOnline: true, batteryLevel: 5 });
    expect(decideAction(makePacket(), ctx)).toBe(RelayAction.UPLOAD);
  });

  it("ACK 一律交給上層處理（含驗簽），不會被誤當成要上傳的求救", () => {
    const ack = makePacket({ type: PacketType.ACK });
    expect(decideAction(ack, context({ isOnline: true }))).toBe(RelayAction.DELIVER_ACK);
  });

  it("重複的 ACK 一樣會被去重擋下", () => {
    const ack = makePacket({ type: PacketType.ACK });
    const ctx = context({ hasSeen: () => true });
    expect(decideAction(ack, ctx)).toBe(RelayAction.DROP_DUPLICATE);
  });

  it("能分辨 ACK 是回給自己的，還是只是路過幫忙轉的", () => {
    const mine = context({ myPendingSosIds: new Set(["MSG12345"]) });

    expect(isAckForMe("MSG12345", mine)).toBe(true);
    expect(isAckForMe("MSG99999", mine)).toBe(false);
  });

  it("掃描間隔隨電量調整", () => {
    expect(scanIntervalForBattery(10)).toBe(0); // 不中繼
    expect(scanIntervalForBattery(35)).toBe(30_000); // 省電
    expect(scanIntervalForBattery(80)).toBe(15_000); // 全速
  });
});

// ---------------------------------------------------------------------------
// 端到端：受困者 → 中繼者 → 有網路的人 → 後端 → ACK 回程
// ---------------------------------------------------------------------------

describe("端到端：三跳中繼", () => {
  it("求救經 B 中繼、由 C 上傳，全程中繼者都讀不到內容；ACK 回到 A", async () => {
    const payload = samplePayload();

    // --- A（受困者，飛航模式）發出求救 ---
    const body = await encryptForBackend(payload, backendEncryptPublicB64);
    const sos: Packet = {
      header: createHeader({
        type: PacketType.SOS,
        keyVersion: 1,
        fromLocalId: "AB2CD3",
        urgencyLevel: 9,
        isTrapped: true,
        battery: 63,
        location: { lat: 25.0339, lng: 121.5645 },
        locationDetails: "民生路 12 號三樓",
      }),
      body,
    };
    const onWire = encodePacket(sos);
    const myMsgId = sos.header.msgId;

    // --- B（中繼者，也沒網路）---
    const bStore = new RelayStore();
    const bReceived = decodePacket(onWire)!;
    const bCtx: RelayContext = {
      isOnline: false,
      batteryLevel: 70,
      localId: "BBB111",
      myPendingSosIds: new Set(),
      hasSeen: (id) => bStore.hasSeen(id),
    };

    expect(decideAction(bReceived, bCtx)).toBe(RelayAction.RELAY);

    // B 讀得到緊急度、是否受困、位置（決定要不要直接衝過去幫忙），但讀不到加密內容
    expect(bReceived.header.urgencyLevel).toBe(9);
    expect(bReceived.header.isTrapped).toBe(true);
    expect(bReceived.header.locationDetails).toBe("民生路 12 號三樓");
    // 認得出是誰在求救 → 才能在「附近的人」裡找到本人並回訊息
    expect(bReceived.header.fromLocalId).toBe("AB2CD3");
    expect(await decryptAsBackend(bReceived.body, backendEncryptPrivate)).toEqual(payload);
    //   ^ 這是後端用私鑰解的。B 沒有私鑰，下面驗證 B 真的解不開：
    const bKeys = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey"],
    );
    expect(await decryptAsBackend(bReceived.body, bKeys.privateKey)).toBeNull();

    bStore.markSeen(bReceived.header.msgId);
    const relayed = decrementForRelay(bReceived)!;
    expect(relayed.header.hops).toBe(1);

    // --- C（有網路）---
    const cStore = new RelayStore();
    const cReceived = decodePacket(encodePacket(relayed))!;
    const cCtx: RelayContext = {
      isOnline: true,
      batteryLevel: 90,
      localId: "CCC222",
      myPendingSosIds: new Set(),
      hasSeen: (id) => cStore.hasSeen(id),
    };

    expect(decideAction(cReceived, cCtx)).toBe(RelayAction.UPLOAD);
    cStore.markSeen(cReceived.header.msgId);

    // C 把密文原封不動上傳（他自己也解不開）
    const uploadedBody = cReceived.body;

    // --- 後端解密 ---
    const atBackend = await decryptAsBackend(uploadedBody, backendEncryptPrivate);
    expect(atBackend).toEqual(payload);
    expect(atBackend!.injurySummary).toContain("右腳受傷");

    // --- 後端簽章 ACK，經 C → B → A 回傳 ---
    const ackBody = await signAckAsBackend(
      { refId: cReceived.header.msgId, uploadedAt: Date.UTC(2026, 6, 13, 1) },
      backendSignPrivate,
    );
    const ackPacket: Packet = {
      header: createHeader({ type: PacketType.ACK, keyVersion: 1 }),
      body: ackBody,
    };

    // --- A 收到 ACK ---
    const aReceived = decodePacket(encodePacket(ackPacket))!;
    const aCtx: RelayContext = {
      isOnline: false,
      batteryLevel: 40,
      localId: "AB2CD3",
      myPendingSosIds: new Set([myMsgId]),
      hasSeen: () => false,
    };

    expect(decideAction(aReceived, aCtx)).toBe(RelayAction.DELIVER_ACK);

    const verified = await verifyAck(aReceived.body, backendSignPublicB64);
    expect(verified).not.toBeNull();
    expect(isAckForMe(verified!.refId, aCtx)).toBe(true);
    // → A 的畫面顯示「你的求救已成功送出報案」
  });

  it("惡意中繼者偽造的 ACK 無法讓受困者放棄呼救", async () => {
    const myMsgId = generateMsgId();

    // 惡意節點用自己的金鑰簽一則假 ACK
    const forged = await signAckAsBackend(
      { refId: myMsgId, uploadedAt: Date.now() },
      attackerSignPrivate,
    );
    const packet: Packet = {
      header: createHeader({ type: PacketType.ACK, keyVersion: 1 }),
      body: forged,
    };

    const received = decodePacket(encodePacket(packet))!;

    // 決策層會說「這是 ACK，交給上層」——但上層的驗簽會擋下它
    expect(decideAction(received, {
      isOnline: false,
      batteryLevel: 50,
      localId: "AB2CD3",
      myPendingSosIds: new Set([myMsgId]),
      hasSeen: () => false,
    })).toBe(RelayAction.DELIVER_ACK);

    expect(await verifyAck(received.body, backendSignPublicB64)).toBeNull();
    // → 丟棄。受困者不會被騙，會繼續呼救。
  });
});
