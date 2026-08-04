import Capacitor

@objc(AppBridgeViewController)
final class AppBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RoomRiskARPlugin())
    }
}
