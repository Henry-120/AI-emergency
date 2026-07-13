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

    /// 廣播啟動逾時（秒）。藍牙權限被拒或狀態卡住時，避免 JS 端的 Promise 永遠不 resolve。
    private let START_TIMEOUT_SECONDS: Double = 10

    /// 目前正在等待廣播啟動結果的 call。
    /// 用途是併發保護：若不擋住第二次呼叫，manager.onAdvertisingStarted 會被覆寫，
    /// 第一個 call 就永遠不會 resolve，JS 端的 await 永遠掛著。
    private var pendingStartCall: CAPPluginCall?

    /// 底層藍牙 Peripheral Manager（只在首次使用時建立）
    private lazy var manager: BlePeripheralManager = {
        let m = BlePeripheralManager()
        // 註冊收訊 callback：每收到一個分片就推 event 給 JS
        m.onMessageReceived = { [weak self] data, centralId in
            guard let self = self else { return }
            self.notifyListeners(self.MESSAGE_EVENT_NAME, data: [
                // 以 base64 傳原始 bytes，不可先轉成 UTF-8 字串。
                //
                // 收到的是「分片」而非完整訊息：長訊息會在任意 byte 邊界被切開，
                // 切點可能落在某個中文字的多位元組編碼中間。此時
                // String(data:encoding:.utf8) 會回傳 nil，整個分片就靜默變成空字串。
                // 重組必須在 JS 端對原始 bytes 進行。
                "data": data.base64EncodedString(),
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
    /// 結果由 manager 的 onAdvertisingStarted 回呼帶回。
    @objc func startAdvertising(_ call: CAPPluginCall) {
        // 併發保護：正在啟動中就直接回絕，不覆寫既有的 callback
        guard pendingStartCall == nil else {
            call.reject("廣播啟動中，請稍候")
            return
        }

        let localId = call.getString("localId") ?? ""
        pendingStartCall = call

        // 注入啟動結果 callback；由 finishStart 保證只會結算一次
        manager.onAdvertisingStarted = { [weak self] error in
            guard let self = self else { return }
            if let error = error {
                self.finishStart(error: "廣播啟動失敗：\(error.localizedDescription)")
            } else {
                self.finishStart(result: ["success": true, "localId": localId])
            }
        }

        // 逾時保險：藍牙未授權或狀態卡住時，避免 JS 端永遠等待
        DispatchQueue.main.asyncAfter(deadline: .now() + START_TIMEOUT_SECONDS) { [weak self] in
            self?.finishStart(error: "廣播啟動逾時，請確認藍牙已開啟並已授權")
        }

        manager.startAdvertising(localId: localId)
    }

    /// 結算 pendingStartCall。先到者為準，之後的呼叫皆為 no-op（callback 與逾時只會生效一個）。
    private func finishStart(result: [String: Any]? = nil, error: String? = nil) {
        guard let call = pendingStartCall else { return }
        pendingStartCall = nil

        if let error = error {
            call.reject(error)
        } else {
            call.resolve(result ?? ["success": true])
        }
    }

    /// JS: BlePeripheral.stopAdvertising()
    /// 停止廣播
    @objc func stopAdvertising(_ call: CAPPluginCall) {
        // 若還有廣播啟動流程在跑，一併結算掉，避免它懸在那裡直到逾時
        finishStart(error: "廣播已被停止")

        manager.stopAdvertising()
        call.resolve(["success": true])
    }

    /// JS: BlePeripheral.isAdvertising()
    /// 查詢目前是否正在廣播
    @objc func isAdvertising(_ call: CAPPluginCall) {
        call.resolve(["isAdvertising": manager.isAdvertising()])
    }
}
