import Capacitor
import Foundation

@objc(OfflineModelPlugin)
final class OfflineModelPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "OfflineModelPlugin"
    let jsName = "OfflineModel"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "installBundledModel", returnType: CAPPluginReturnPromise)
    ]

    @objc func installBundledModel(_ call: CAPPluginCall) {
        guard let fileName = call.getString("fileName"), !fileName.isEmpty else {
            call.reject("fileName is required")
            return
        }
        guard let documents = FileManager.default.urls(
            for: .documentDirectory,
            in: .userDomainMask
        ).first else {
            call.reject("無法存取 App Documents")
            return
        }

        let destination = documents.appendingPathComponent(fileName)
        if FileManager.default.fileExists(atPath: destination.path) {
            call.resolve(["path": destination.path])
            return
        }

        let stem = (fileName as NSString).deletingPathExtension
        let ext = (fileName as NSString).pathExtension
        let source =
            Bundle.main.url(forResource: stem, withExtension: ext, subdirectory: "public/models")
            ?? Bundle.main.url(forResource: stem, withExtension: ext, subdirectory: "models")

        guard let source else {
            call.reject("App 內找不到離線模型 \(fileName)，請先執行 npm run ios:sync-model")
            return
        }

        do {
            try FileManager.default.copyItem(at: source, to: destination)
            call.resolve(["path": destination.path])
        } catch {
            call.reject("安裝離線模型失敗：\(error.localizedDescription)")
        }
    }
}

@objc(AppBridgeViewController)
final class AppBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RoomRiskARPlugin())
        bridge?.registerPluginInstance(OfflineModelPlugin())
    }
}
