//
//  BlePeripheralPlugin.m
//  GuardiaAI - Capacitor 插件註冊
//
//  Capacitor 用 Objective-C 巨集 CAP_PLUGIN 把 Swift 寫的插件登錄到 Bridge。
//  雖然主要邏輯都在 .swift，這個 .m 檔仍然必要、不能省略。
//
//  以下 CAP_PLUGIN(BlePeripheralPlugin, "BlePeripheral", ...) 意思是：
//    - 把 Swift 類別 BlePeripheralPlugin 註冊
//    - JS 端用 registerPlugin('BlePeripheral') 取得這個插件
//    - 列出 JS 可呼叫的方法名稱與回傳形式
//

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// 註：addListener / removeAllListeners 已由 CAPPlugin base class 自動註冊，
//     此處不要再宣告，否則部分 Capacitor 版本會出 warning 或重複註冊。
CAP_PLUGIN(BlePeripheralPlugin, "BlePeripheral",
    CAP_PLUGIN_METHOD(startAdvertising, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stopAdvertising,  CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(isAdvertising,    CAPPluginReturnPromise);
)
