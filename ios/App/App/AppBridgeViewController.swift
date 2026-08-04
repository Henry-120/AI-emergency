import Capacitor

@objc(AppBridgeViewController)
final class AppBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // App target 內的 plugin 不會被 Capacitor 自動探索到——只實作 CAPBridgedPlugin
        // 協定並不夠，一定要在這裡明確註冊，否則 JS 端 registerPlugin() 只會拿到空殼，
        // 呼叫任何方法都會丟 "not implemented"。
        bridge?.registerPluginInstance(RoomRiskARPlugin())
        bridge?.registerPluginInstance(BlePeripheralPlugin())
    }
}
