//
//  BlePeripheralManager.swift
//  GuardiaAI - 藍牙 Peripheral（廣播 + GATT 收訊）核心邏輯
//
//  本檔案僅處理 iOS CoreBluetooth 的 CBPeripheralManager 操作，
//  不直接與 Capacitor / JS 互動；那部分在 BlePeripheralPlugin.swift。
//
//  功能：
//    1. startAdvertising：開始廣播本機為 GuardiaAI 使用者
//    2. stopAdvertising ：停止廣播
//    3. 建立一個 GATT Service（含 1 個 writable + notify 特徵值），
//       供附近的 Central 連線寫入訊息
//    4. 當有 Central 寫入資料 → 透過 onMessageReceived callback 回拋
//
//  啟動順序（重要）：
//    startAdvertising → 等 .poweredOn → add(service) → 等 didAdd 回呼
//      → startAdvertising(data) → 等 didStartAdvertising 回呼 → 通知 plugin
//

import Foundation
import CoreBluetooth

/// 對外回拋訊息的 callback 型別
/// - parameters:
///   - data: 對方寫入的原始 bytes（JS 端會把它當 UTF-8 字串解析）
///   - centralId: 寫入者的 CBCentral 識別字串（可用來區分多個來源）
typealias OnMessageReceived = (_ data: Data, _ centralId: String) -> Void

/// 廣播啟動完成時的回呼。error 為 nil 表示成功。
typealias OnAdvertisingStarted = (_ error: Error?) -> Void

class BlePeripheralManager: NSObject, CBPeripheralManagerDelegate {

    // MARK: - 常數（必須與 JS 端 bluetoothConstants.ts 一致）

    /// GuardiaAI 服務 UUID。所有 App 安裝皆共用此 ID，作為「同 App 識別」依據
    static let SERVICE_UUID = CBUUID(string: "7E5F9B40-9C8E-4F1A-A0D3-2C1B7E0A5F40")

    /// 訊息收件特徵值 UUID。Central 將訊息寫入此特徵 → 觸發 didReceiveWrite
    static let INBOX_CHAR_UUID = CBUUID(string: "7E5F9B40-9C8E-4F1A-A0D3-2C1B7E0A5F41")

    // MARK: - 內部狀態

    private var peripheralManager: CBPeripheralManager!
    private var inboxCharacteristic: CBMutableCharacteristic!
    /// 是否已經對 peripheralManager 註冊過 service。
    /// 注意：藍牙離開 .poweredOn 後 iOS 會清掉 services，此旗標也必須跟著清。
    private var serviceAdded = false
    private var isAdvertisingRequested = false

    /// 廣播時要附加的本機短 ID（最多 ~20 bytes，建議 4–8 bytes，例如裝置雜湊）
    /// 由 startAdvertising(localId:) 傳入
    private var pendingLocalId: String = ""

    /// 收到訊息時要呼叫的 callback（由 BlePeripheralPlugin 注入）
    var onMessageReceived: OnMessageReceived?

    /// 廣播啟動結果的回呼（由 plugin 在每次 startAdvertising 前注入）。
    /// 啟動成功 / 失敗只觸發一次後即被清空，避免之後的狀態變動誤觸。
    var onAdvertisingStarted: OnAdvertisingStarted?

    // MARK: - 初始化

    /// 建立 CBPeripheralManager 並開始監聽藍牙狀態變化
    /// 注意：此處不會立即廣播，必須等 peripheralManagerDidUpdateState 回到 .poweredOn 才能廣播
    override init() {
        super.init()
        peripheralManager = CBPeripheralManager(delegate: self, queue: nil)
    }

    // MARK: - 公開 API（被 BlePeripheralPlugin 呼叫）

    /// 開始廣播。
    /// - parameter localId: 顯示給附近使用者看的短識別字串
    ///
    /// 廣播啟動是非同步的：
    ///   1. 若藍牙還沒 powered on，會等 didUpdateState 回到 .poweredOn
    ///   2. service 尚未註冊 → 先呼叫 add(service)，等 didAdd 回呼
    ///   3. 才呼叫 CBPeripheralManager.startAdvertising，等 didStartAdvertising 回呼
    ///
    /// 結果（成功或失敗）會透過 onAdvertisingStarted 通知 plugin 回拋給 JS。
    func startAdvertising(localId: String) {
        pendingLocalId = localId
        isAdvertisingRequested = true
        tryStartIfReady()
    }

    /// 停止廣播
    func stopAdvertising() {
        isAdvertisingRequested = false
        if peripheralManager.isAdvertising {
            peripheralManager.stopAdvertising()
        }
    }

    /// 查詢目前是否正在廣播
    func isAdvertising() -> Bool {
        return peripheralManager.isAdvertising
    }

    // MARK: - 內部：啟動流程

    /// 嘗試推進廣播啟動流程，依目前狀態走到下一步。
    /// 可被 startAdvertising / didUpdateState / didAdd 多處呼叫，本身是冪等的。
    private func tryStartIfReady() {
        guard isAdvertisingRequested else { return }
        guard peripheralManager.state == .poweredOn else {
            // 留到 peripheralManagerDidUpdateState 處理
            return
        }
        if !serviceAdded {
            addService()
            // 等待 didAdd 回呼才繼續
        } else {
            startAdvertisingInternal()
        }
    }

    /// 建立並向 peripheralManager 註冊 GuardiaAI 服務。實際完成要等 didAdd 回呼。
    private func addService() {
        // 收件特徵值：允許 Central write、也支援 notify 讓我們可主動推訊息
        inboxCharacteristic = CBMutableCharacteristic(
            type: BlePeripheralManager.INBOX_CHAR_UUID,
            properties: [.write, .writeWithoutResponse, .notify, .read],
            value: nil,
            permissions: [.writeable, .readable]
        )

        let service = CBMutableService(type: BlePeripheralManager.SERVICE_UUID, primary: true)
        service.characteristics = [inboxCharacteristic]

        peripheralManager.add(service)
        serviceAdded = true
    }

    /// 開始實際的 advertise（前提：service 已 add、藍牙已 powered on）
    private func startAdvertisingInternal() {
        // iOS 廣播限制：在前景時 ServiceUUIDs + LocalName 都會出現；
        // 在背景時 LocalName 會被丟掉、ServiceUUIDs 也會被移到 overflow area。
        // 所以本機短 ID 我們同時放在 localName，供前景時對方解析。
        let advertisingData: [String: Any] = [
            CBAdvertisementDataServiceUUIDsKey: [BlePeripheralManager.SERVICE_UUID],
            CBAdvertisementDataLocalNameKey: pendingLocalId
        ]
        peripheralManager.startAdvertising(advertisingData)
    }

    // MARK: - CBPeripheralManagerDelegate

    /// 藍牙狀態變更時被呼叫（開機、權限變更、藍牙開關等都會觸發）
    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        if peripheral.state == .poweredOn {
            // 藍牙準備好後，若稍早曾被要求廣播，現在補做
            tryStartIfReady()
        } else {
            // 藍牙離開 poweredOn 狀態時，iOS 會清除已註冊的 services。
            // 重設 flag 以便下次回到 poweredOn 時重新註冊。
            serviceAdded = false
            // 若仍有 plugin 等著啟動結果，回報錯誤避免它一直 keepAlive
            if let cb = onAdvertisingStarted {
                onAdvertisingStarted = nil
                cb(NSError(domain: "BlePeripheral", code: -1, userInfo: [
                    NSLocalizedDescriptionKey: "藍牙未開啟（state=\(peripheral.state.rawValue)）"
                ]))
            }
        }
    }

    /// service 註冊完成（或失敗）後被呼叫
    func peripheralManager(_ peripheral: CBPeripheralManager,
                           didAdd service: CBService,
                           error: Error?) {
        if let error = error {
            // 註冊失敗：清掉 flag、回報錯誤
            serviceAdded = false
            if let cb = onAdvertisingStarted {
                onAdvertisingStarted = nil
                cb(error)
            }
            return
        }
        // service ready，正式啟動 advertise
        if isAdvertisingRequested {
            startAdvertisingInternal()
        }
    }

    /// 廣播實際啟動完成（或失敗）後被呼叫
    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager,
                                              error: Error?) {
        if let cb = onAdvertisingStarted {
            onAdvertisingStarted = nil
            cb(error)
        }
    }

    /// 有 Central 對我們的 inbox 特徵寫入資料時被呼叫
    func peripheralManager(_ peripheral: CBPeripheralManager,
                           didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            // 只處理我們認得的 inbox 特徵
            if request.characteristic.uuid == BlePeripheralManager.INBOX_CHAR_UUID,
               let value = request.value {
                let centralId = request.central.identifier.uuidString
                // 回拋給上層（BlePeripheralPlugin → Capacitor event → JS）
                onMessageReceived?(value, centralId)
            }
            // 必須回應 success，否則對方 Central 會收到錯誤
            peripheralManager.respond(to: request, withResult: .success)
        }
    }
}
