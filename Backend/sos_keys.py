"""
GuardiaAI SOS 中繼 - 後端金鑰（測試用）

⚠️ 這是 TEST ONLY 的金鑰組，只為了讓本機開發環境能跑通「加密 -> 中繼 -> 上傳 ->
解密 -> 簽章回執 -> 驗簽」整條流程。正式上線前必須：

    1. 用下面「產生新金鑰」的程式碼重新產生一組
    2. 私鑰改用環境變數或密鑰管理服務注入，絕不進版控
    3. 把新的公鑰同步更新到前端 src/services/sos/sosKeys.ts 的 BACKEND_KEYS

公鑰（必須與 sosKeys.ts 的 BACKEND_KEYS 完全一致，否則加解密對不上）：
    encryptionPublicKey = BFLpfLUJBH9Y4waLLC27L7IHq8rrNKu66J9rXEBXcaVfL/G+aryU6zVE4tcsAICU4jr1XpBcMvR3MQxD5nwZX6k=
    ackVerifyPublicKey  = BBZ+AeOEavOek2TAjwh/Z0QezFPkW14vBljbWaVMPX0XtGHposje0eqQEQOZ3YuWYmP+Tj9+vWq20MoeN0CnP4Y=

產生新金鑰：

    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization
    priv = ec.generate_private_key(ec.SECP256R1())
    pub_raw = priv.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    priv_pem = priv.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption())
"""

KEY_VERSION = 1

# ECDH P-256 私鑰：用於解密求救內容（對應前端 encryptionPublicKey）
ENCRYPTION_PRIVATE_KEY_PEM = """-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgNhnUUxQPP7fMlEIu
I46kGtusNFnOTjCBidws3hZP4L2hRANCAARS6Xy1CQR/WOMGiywtuy+yB6vK6zSr
uuifa1xAV3GlXy/xvmq8lOs1ROLXLACAlOI69V6QXDL0dzEMQ+Z8GV+p
-----END PRIVATE KEY-----
"""

# ECDSA P-256 私鑰：用於簽章 ACK 回執（對應前端 ackVerifyPublicKey）
ACK_SIGNING_PRIVATE_KEY_PEM = """-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg5JTuVbltstaBIcOY
EJvZl5nqjM0UGBvnGIrnchNMNVOhRANCAAQWfgHjhGrznpNkwI8If2dEHsxT5Fte
LwZY21mlTD19F7Rh6aLI3tHqkBEDmd2LlmJj/k4/fr1qttDKHjdApz+G
-----END PRIVATE KEY-----
"""
