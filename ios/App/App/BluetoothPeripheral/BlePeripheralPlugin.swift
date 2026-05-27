//
//  BlePeripheralPlugin.swift
//  GuardiaAI - Capacitor 插件：JS ↔ Swift 橋接層
//
//  本檔案的職責：
//    - 提供 JS 端可呼叫的方法（startAdvertising / stopAdvertising / isAdvertising）
//    - 把 BlePeripheralManager 收到的訊息以 Capacitor event 推給 JS
//
//  不在本檔案處理藍牙協定細節（那在 BlePeripheralManager.swift）。
//  插件對 JS 的註冊在同資料夾的 BlePeripheralPlugin.m。
//

import Foundation
import Capacitor

@objc(BlePeripheralPlugin)
public class BlePeripheralPlugin: CAPPlugin {

    /// 對應 JS 端 addListener('messageReceived', ...) 的事件名
    private let MESSAGE_EVENT_NAME = "messageReceived"

    /// 底層藍牙 Peripheral Manager（只在首次使用時建立）
    private lazy var manager: BlePeripheralManager = {
        let m = BlePeripheralManager()
        // 註冊收訊 callback：每收到一筆訊息就推 event 給 JS
        m.onMessageReceived = { [weak self] data, centralId in
            guard let self = self else { return }
            self.notifyListeners(self.MESSAGE_EVENT_NAME, data: [
                // 以 UTF-8 字串形式傳給 JS；JS 端可進一步 JSON.parse
                "message": String(data: data, encoding: .utf8) ?? "",
                "centralId": centralId,
                "timestamp": Int(Date().timeIntervalSince1970 * 1000)
            ])
        }
        return m
    }()

    // MARK: - JS 可呼叫的方法

    /// JS: BlePeripheral.startAdvertising({ localId: 'xxx' })
    /// 開始廣播，讓附近的 GuardiaAI 使用者能掃到此裝置。
    ///
    /// 廣播啟動是非同步的（要等 service 註冊 + 廣播實際開始），
    /// 因此此方法會 keepAlive，直到 manager 回呼後才 resolve / reject。
    @objc func startAdvertising(_ call: CAPPluginCall) {
        let localId = call.getString("localId") ?? ""
        call.keepAlive = true

        // 注入啟動結果 callback；只會觸發一次
        manager.onAdvertisingStarted = { [weak call] error in
            guard let call = call else { return }
            if let error = error {
                call.reject("廣播啟動失敗：\(error.localizedDescription)")
            } else {
                call.resolve([
                    "success": true,
                    "localId": localId
                ])
            }
        }

        manager.startAdvertising(localId: localId)
    }

    /// JS: BlePeripheral.stopAdvertising()
    /// 停止廣播
    @objc func stopAdvertising(_ call: CAPPluginCall) {
        manager.stopAdvertising()
        call.resolve(["success": true])
    }

    /// JS: BlePeripheral.isAdvertising()
    /// 查詢目前是否正在廣播
    @objc func isAdvertising(_ call: CAPPluginCall) {
        call.resolve(["isAdvertising": manager.isAdvertising()])
    }
}
