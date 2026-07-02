import ARKit
import Capacitor
import SceneKit
import UIKit

@objc(RoomRiskARPlugin)
public class RoomRiskARPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RoomRiskARPlugin"
    public let jsName = "RoomRiskAR"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)
    ]

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve([
            "supported": ARWorldTrackingConfiguration.isSupported,
            "depthSupported": ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        ])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard ARWorldTrackingConfiguration.isSupported else {
            call.reject("此裝置不支援 ARKit 世界追蹤。")
            return
        }
        guard let backendURL = call.getString("backendUrl"),
              let endpoint = URL(string: "\(backendURL)/api/room-risk/analyze") else {
            call.reject("後端網址無效。")
            return
        }

        DispatchQueue.main.async {
            let controller = RoomRiskARViewController(endpoint: endpoint)
            controller.modalPresentationStyle = .fullScreen
            controller.onFinish = { result in
                if let result {
                    call.resolve(["analysis": result])
                } else {
                    call.resolve(["cancelled": true])
                }
            }
            self.bridge?.viewController?.present(controller, animated: true)
        }
    }
}

final class RoomRiskARViewController: UIViewController, ARSCNViewDelegate {
    private let endpoint: URL
    private let sceneView = ARSCNView(frame: .zero)
    private let coachingOverlay = ARCoachingOverlayView()
    private let statusLabel = UILabel()
    private let scanButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private let clearButton = UIButton(type: .system)
    private let legendStack = UIStackView()
    private let zoneRoot = SCNNode()
    private var isAnalyzing = false
    private var latestAnalysis: [String: Any]?
    private var detectedHorizontalPlanes = 0
    private var horizontalPlaneAnchors: [UUID: ARPlaneAnchor] = [:]

    var onFinish: (([String: Any]?) -> Void)?

    init(endpoint: URL) {
        self.endpoint = endpoint
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        buildInterface()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        runSession(reset: true)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sceneView.session.pause()
    }

    private func buildInterface() {
        view.backgroundColor = .black
        sceneView.translatesAutoresizingMaskIntoConstraints = false
        sceneView.delegate = self
        sceneView.scene = SCNScene()
        sceneView.scene.rootNode.addChildNode(zoneRoot)
        sceneView.automaticallyUpdatesLighting = true
        view.addSubview(sceneView)

        coachingOverlay.translatesAutoresizingMaskIntoConstraints = false
        coachingOverlay.session = sceneView.session
        coachingOverlay.goal = .horizontalPlane
        coachingOverlay.activatesAutomatically = true
        view.addSubview(coachingOverlay)

        let topBar = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterialDark))
        topBar.translatesAutoresizingMaskIntoConstraints = false
        topBar.layer.cornerRadius = 18
        topBar.clipsToBounds = true
        view.addSubview(topBar)

        let titleLabel = UILabel()
        titleLabel.text = "AR 地震安全掃描"
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 17, weight: .bold)
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        topBar.contentView.addSubview(titleLabel)

        statusLabel.text = "慢慢移動手機，先掃描地板"
        statusLabel.textColor = UIColor.white.withAlphaComponent(0.75)
        statusLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        statusLabel.numberOfLines = 2
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        topBar.contentView.addSubview(statusLabel)

        closeButton.setImage(UIImage(systemName: "xmark"), for: .normal)
        closeButton.tintColor = .white
        closeButton.backgroundColor = UIColor.white.withAlphaComponent(0.12)
        closeButton.layer.cornerRadius = 18
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        topBar.contentView.addSubview(closeButton)

        legendStack.axis = .horizontal
        legendStack.spacing = 8
        legendStack.distribution = .fillEqually
        legendStack.translatesAutoresizingMaskIntoConstraints = false
        legendStack.addArrangedSubview(makeLegend(title: "危險", color: .coralRed))
        legendStack.addArrangedSubview(makeLegend(title: "注意", color: .honeyYellow))
        legendStack.addArrangedSubview(makeLegend(title: "安全", color: .mintGreen))
        view.addSubview(legendStack)

        scanButton.setTitle("分析地面風險", for: .normal)
        scanButton.setImage(UIImage(systemName: "viewfinder"), for: .normal)
        scanButton.tintColor = UIColor(red: 0.02, green: 0.20, blue: 0.16, alpha: 1)
        scanButton.backgroundColor = .mintGreen
        scanButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .bold)
        scanButton.layer.cornerRadius = 28
        scanButton.configuration = UIButton.Configuration.plain()
        scanButton.configuration?.imagePadding = 9
        scanButton.translatesAutoresizingMaskIntoConstraints = false
        scanButton.addTarget(self, action: #selector(scanTapped), for: .touchUpInside)
        view.addSubview(scanButton)

        clearButton.setImage(UIImage(systemName: "arrow.counterclockwise"), for: .normal)
        clearButton.tintColor = .white
        clearButton.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        clearButton.layer.cornerRadius = 24
        clearButton.translatesAutoresizingMaskIntoConstraints = false
        clearButton.addTarget(self, action: #selector(clearTapped), for: .touchUpInside)
        view.addSubview(clearButton)

        NSLayoutConstraint.activate([
            sceneView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            sceneView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            sceneView.topAnchor.constraint(equalTo: view.topAnchor),
            sceneView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            coachingOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            coachingOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            coachingOverlay.topAnchor.constraint(equalTo: view.topAnchor),
            coachingOverlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            topBar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 14),
            topBar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -14),
            topBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            topBar.heightAnchor.constraint(equalToConstant: 72),

            titleLabel.leadingAnchor.constraint(equalTo: topBar.contentView.leadingAnchor, constant: 16),
            titleLabel.topAnchor.constraint(equalTo: topBar.contentView.topAnchor, constant: 12),
            statusLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: closeButton.leadingAnchor, constant: -10),
            statusLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 3),

            closeButton.trailingAnchor.constraint(equalTo: topBar.contentView.trailingAnchor, constant: -14),
            closeButton.centerYAnchor.constraint(equalTo: topBar.contentView.centerYAnchor),
            closeButton.widthAnchor.constraint(equalToConstant: 36),
            closeButton.heightAnchor.constraint(equalToConstant: 36),

            legendStack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 28),
            legendStack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -28),
            legendStack.topAnchor.constraint(equalTo: topBar.bottomAnchor, constant: 10),
            legendStack.heightAnchor.constraint(equalToConstant: 32),

            scanButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            scanButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -18),
            scanButton.widthAnchor.constraint(equalToConstant: 210),
            scanButton.heightAnchor.constraint(equalToConstant: 56),

            clearButton.trailingAnchor.constraint(equalTo: scanButton.leadingAnchor, constant: -14),
            clearButton.centerYAnchor.constraint(equalTo: scanButton.centerYAnchor),
            clearButton.widthAnchor.constraint(equalToConstant: 48),
            clearButton.heightAnchor.constraint(equalToConstant: 48)
        ])
    }

    private func runSession(reset: Bool) {
        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal]
        configuration.environmentTexturing = .automatic
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) {
            configuration.frameSemantics.insert(.smoothedSceneDepth)
        } else if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            configuration.frameSemantics.insert(.sceneDepth)
        }
        let options: ARSession.RunOptions = reset
            ? [.resetTracking, .removeExistingAnchors]
            : []
        sceneView.session.run(configuration, options: options)
    }

    private func makeLegend(title: String, color: UIColor) -> UIView {
        let container = UIView()
        container.backgroundColor = UIColor.black.withAlphaComponent(0.42)
        container.layer.cornerRadius = 14

        let dot = UIView()
        dot.backgroundColor = color
        dot.layer.cornerRadius = 5
        dot.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(dot)

        let label = UILabel()
        label.text = title
        label.textColor = .white
        label.font = .systemFont(ofSize: 11, weight: .bold)
        label.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(label)

        NSLayoutConstraint.activate([
            dot.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12),
            dot.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            dot.widthAnchor.constraint(equalToConstant: 10),
            dot.heightAnchor.constraint(equalToConstant: 10),
            label.leadingAnchor.constraint(equalTo: dot.trailingAnchor, constant: 6),
            label.centerYAnchor.constraint(equalTo: container.centerYAnchor)
        ])
        return container
    }

    @objc private func closeTapped() {
        dismiss(animated: true) {
            self.onFinish?(self.latestAnalysis)
        }
    }

    @objc private func clearTapped() {
        zoneRoot.childNodes.forEach { $0.removeFromParentNode() }
        latestAnalysis = nil
        statusLabel.text = "已清除標記，請重新掃描地板"
        runSession(reset: false)
    }

    @objc private func scanTapped() {
        guard !isAnalyzing else { return }
        guard detectedHorizontalPlanes > 0 else {
            showMessage("尚未找到地板", detail: "請慢慢左右移動手機，讓白色平面網格覆蓋地板後再分析。")
            return
        }
        guard let frame = sceneView.session.currentFrame else {
            showMessage("相機尚未準備完成", detail: "請稍後再試。")
            return
        }

        isAnalyzing = true
        scanButton.isEnabled = false
        scanButton.setTitle("AI 分析中...", for: .normal)
        statusLabel.text = depthStatus(frame: frame)

        guard let imageData = sceneView.snapshot().jpegData(compressionQuality: 0.86) else {
            finishAnalysisWithError("無法擷取 AR 相機畫面。")
            return
        }

        analyze(imageData: imageData) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                switch result {
                case .success(let analysis):
                    self.latestAnalysis = analysis
                    let renderedCount = self.renderZones(from: analysis)
                    if renderedCount > 0 {
                        self.statusLabel.text = "分析完成，已在地板標示 \(renderedCount) 個區域"
                    } else {
                        self.statusLabel.text = "分析完成，但目前無法把區域投影到地板"
                        self.showMessage(
                            "找不到可顯示的位置",
                            detail: "請將鏡頭稍微朝向已掃描的地板，再按一次重新分析。"
                        )
                    }
                case .failure(let error):
                    self.showMessage("分析失敗", detail: error.localizedDescription)
                }
                self.isAnalyzing = false
                self.scanButton.isEnabled = true
                self.scanButton.setTitle("重新分析", for: .normal)
            }
        }
    }

    private func depthStatus(frame: ARFrame) -> String {
        if let depth = frame.smoothedSceneDepth ?? frame.sceneDepth {
            let width = CVPixelBufferGetWidth(depth.depthMap)
            let height = CVPixelBufferGetHeight(depth.depthMap)
            return "AI 分析中，已取得 LiDAR 深度圖 \(width)x\(height)"
        }
        return "AI 分析中，使用平面偵測與世界座標 raycast"
    }

    private func analyze(
        imageData: Data,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        body.appendMultipart("--\(boundary)\r\n")
        body.appendMultipart("Content-Disposition: form-data; name=\"sensor_context\"\r\n\r\n")
        body.appendMultipart("ARKit world tracking; horizontal plane detected; scene depth \(ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) ? "supported" : "unavailable")\r\n")
        body.appendMultipart("--\(boundary)\r\n")
        body.appendMultipart("Content-Disposition: form-data; name=\"image\"; filename=\"arkit-room.jpg\"\r\n")
        body.appendMultipart("Content-Type: image/jpeg\r\n\r\n")
        body.append(imageData)
        body.appendMultipart("\r\n--\(boundary)--\r\n")
        request.httpBody = body

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                completion(.failure(error))
                return
            }
            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode),
                  let data else {
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                completion(.failure(ARRiskError.server("後端回應錯誤 \(status)")))
                return
            }
            do {
                guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    throw ARRiskError.server("AI 回應格式錯誤。")
                }
                completion(.success(json))
            } catch {
                completion(.failure(error))
            }
        }.resume()
    }

    @discardableResult
    private func renderZones(from analysis: [String: Any]) -> Int {
        zoneRoot.childNodes.forEach { $0.removeFromParentNode() }
        guard let zones = analysis["zones"] as? [[String: Any]] else { return 0 }
        var renderedCount = 0

        for (zoneIndex, zone) in zones.enumerated() {
            guard let polygon = zone["polygon"] as? [[String: Any]],
                  polygon.count >= 3 else { continue }

            let projectedPoints = polygon.compactMap { point -> SCNVector3? in
                guard let x = point["x"] as? NSNumber,
                      let y = point["y"] as? NSNumber else { return nil }
                return worldPoint(normalizedX: CGFloat(truncating: x), normalizedY: CGFloat(truncating: y))
            }
            let worldPoints: [SCNVector3]
            if projectedPoints.count == polygon.count {
                worldPoints = projectedPoints
            } else if let fallback = fallbackFloorPoints(
                zoneIndex: zoneIndex,
                zoneCount: zones.count
            ) {
                worldPoints = fallback
            } else {
                continue
            }

            let type = zone["type"] as? String ?? "caution"
            let label = zone["label"] as? String ?? "注意區域"
            let color: UIColor = type == "danger"
                ? .coralRed
                : type == "safe"
                    ? .mintGreen
                    : .honeyYellow

            let floorY = worldPoints.map(\.y).reduce(0, +) / Float(worldPoints.count) + 0.008
            let flattened = worldPoints.map { SCNVector3($0.x, floorY, $0.z) }
            if let mesh = makePolygonNode(points: flattened, color: color) {
                zoneRoot.addChildNode(mesh)
            }
            zoneRoot.addChildNode(makeLabelNode(text: label, color: color, points: flattened))
            renderedCount += 1
        }
        return renderedCount
    }

    private func worldPoint(normalizedX: CGFloat, normalizedY: CGFloat) -> SCNVector3? {
        let screenPoint = CGPoint(
            x: normalizedX * sceneView.bounds.width,
            y: normalizedY * sceneView.bounds.height
        )

        if let query = sceneView.raycastQuery(
            from: screenPoint,
            allowing: .existingPlaneGeometry,
            alignment: .horizontal
        ), let result = sceneView.session.raycast(query).first {
            return SCNVector3(
                result.worldTransform.columns.3.x,
                result.worldTransform.columns.3.y,
                result.worldTransform.columns.3.z
            )
        }

        if let query = sceneView.raycastQuery(
            from: screenPoint,
            allowing: .estimatedPlane,
            alignment: .horizontal
        ), let result = sceneView.session.raycast(query).first {
            return SCNVector3(
                result.worldTransform.columns.3.x,
                result.worldTransform.columns.3.y,
                result.worldTransform.columns.3.z
            )
        }
        return nil
    }

    private func fallbackFloorPoints(zoneIndex: Int, zoneCount: Int) -> [SCNVector3]? {
        let planes = Array(horizontalPlaneAnchors.values)
        guard !planes.isEmpty else { return nil }

        guard let plane = planes.max(by: {
            ($0.extent.x * $0.extent.z) < ($1.extent.x * $1.extent.z)
        }) else {
            return nil
        }

        let width = min(max(plane.extent.x * 0.34, 0.24), 0.72)
        let depth = min(max(plane.extent.z * 0.34, 0.24), 0.72)
        let availableX = max(0, plane.extent.x - width)
        let normalizedOffset: Float
        if zoneCount <= 1 {
            normalizedOffset = 0
        } else {
            normalizedOffset = Float(zoneIndex) / Float(zoneCount - 1) - 0.5
        }
        let offsetX = normalizedOffset * availableX * 0.8
        let centerX = plane.center.x + offsetX
        let centerZ = plane.center.z

        let localCorners = [
            SIMD4<Float>(centerX - width / 2, 0, centerZ - depth / 2, 1),
            SIMD4<Float>(centerX + width / 2, 0, centerZ - depth / 2, 1),
            SIMD4<Float>(centerX + width / 2, 0, centerZ + depth / 2, 1),
            SIMD4<Float>(centerX - width / 2, 0, centerZ + depth / 2, 1)
        ]

        return localCorners.map { corner in
            let world = plane.transform * corner
            return SCNVector3(world.x, world.y + 0.012, world.z)
        }
    }

    private func makePolygonNode(points: [SCNVector3], color: UIColor) -> SCNNode? {
        guard points.count >= 3 else { return nil }
        let vertices = [averagePoint(points)] + points
        var indices: [Int32] = []
        for index in 1...points.count {
            let next = index == points.count ? 1 : index + 1
            indices.append(contentsOf: [0, Int32(index), Int32(next)])
        }

        let source = SCNGeometrySource(vertices: vertices)
        let data = Data(bytes: indices, count: indices.count * MemoryLayout<Int32>.size)
        let element = SCNGeometryElement(
            data: data,
            primitiveType: .triangles,
            primitiveCount: indices.count / 3,
            bytesPerIndex: MemoryLayout<Int32>.size
        )
        let geometry = SCNGeometry(sources: [source], elements: [element])
        let material = SCNMaterial()
        material.diffuse.contents = color.withAlphaComponent(0.48)
        material.emission.contents = color.withAlphaComponent(0.16)
        material.isDoubleSided = true
        material.lightingModel = .constant
        geometry.materials = [material]

        let node = SCNNode(geometry: geometry)
        let border = makeBorderNode(points: points, color: color)
        node.addChildNode(border)
        return node
    }

    private func makeBorderNode(points: [SCNVector3], color: UIColor) -> SCNNode {
        let container = SCNNode()
        for index in points.indices {
            let next = points[(index + 1) % points.count]
            container.addChildNode(makeLine(from: points[index], to: next, color: color))
        }
        return container
    }

    private func makeLine(from start: SCNVector3, to end: SCNVector3, color: UIColor) -> SCNNode {
        let vector = SCNVector3(end.x - start.x, end.y - start.y, end.z - start.z)
        let distance = sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)
        let cylinder = SCNCylinder(radius: 0.009, height: CGFloat(distance))
        cylinder.radialSegmentCount = 8
        cylinder.firstMaterial?.diffuse.contents = color
        cylinder.firstMaterial?.lightingModel = .constant

        let node = SCNNode(geometry: cylinder)
        node.position = SCNVector3(
            (start.x + end.x) / 2,
            (start.y + end.y) / 2 + 0.006,
            (start.z + end.z) / 2
        )
        node.look(at: end, up: sceneView.scene.rootNode.worldUp, localFront: SCNVector3(0, 1, 0))
        return node
    }

    private func makeLabelNode(text: String, color: UIColor, points: [SCNVector3]) -> SCNNode {
        let textGeometry = SCNText(string: text, extrusionDepth: 0.004)
        textGeometry.font = .systemFont(ofSize: 0.13, weight: .bold)
        textGeometry.flatness = 0.2
        textGeometry.firstMaterial?.diffuse.contents = UIColor.white
        textGeometry.firstMaterial?.lightingModel = .constant

        let textNode = SCNNode(geometry: textGeometry)
        let bounds = textGeometry.boundingBox
        let width = bounds.max.x - bounds.min.x
        textNode.pivot = SCNMatrix4MakeTranslation(width / 2, bounds.min.y, 0)

        let billboard = SCNBillboardConstraint()
        billboard.freeAxes = .Y
        textNode.constraints = [billboard]
        let center = averagePoint(points)
        textNode.position = SCNVector3(center.x, center.y + 0.08, center.z)
        textNode.scale = SCNVector3(0.55, 0.55, 0.55)

        let bubble = SCNPlane(width: CGFloat(max(width * 0.6, 0.24)), height: 0.10)
        bubble.cornerRadius = 0.045
        bubble.firstMaterial?.diffuse.contents = color.withAlphaComponent(0.92)
        bubble.firstMaterial?.lightingModel = .constant
        let bubbleNode = SCNNode(geometry: bubble)
        bubbleNode.position = SCNVector3(0, 0.035, -0.008)
        textNode.addChildNode(bubbleNode)
        return textNode
    }

    private func averagePoint(_ points: [SCNVector3]) -> SCNVector3 {
        let count = Float(points.count)
        return SCNVector3(
            points.map(\.x).reduce(0, +) / count,
            points.map(\.y).reduce(0, +) / count,
            points.map(\.z).reduce(0, +) / count
        )
    }

    private func finishAnalysisWithError(_ message: String) {
        isAnalyzing = false
        scanButton.isEnabled = true
        scanButton.setTitle("分析地面風險", for: .normal)
        showMessage("分析失敗", detail: message)
    }

    private func showMessage(_ title: String, detail: String) {
        let alert = UIAlertController(title: title, message: detail, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }

    func renderer(_ renderer: SCNSceneRenderer, didAdd node: SCNNode, for anchor: ARAnchor) {
        guard let plane = anchor as? ARPlaneAnchor, plane.alignment == .horizontal else { return }
        DispatchQueue.main.async {
            self.horizontalPlaneAnchors[plane.identifier] = plane
            self.detectedHorizontalPlanes = self.horizontalPlaneAnchors.count
            self.statusLabel.text = "已找到地板，可以開始分析"
        }
    }

    func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
        guard let plane = anchor as? ARPlaneAnchor, plane.alignment == .horizontal else { return }
        DispatchQueue.main.async {
            self.horizontalPlaneAnchors[plane.identifier] = plane
            self.detectedHorizontalPlanes = self.horizontalPlaneAnchors.count
        }
    }

    func renderer(_ renderer: SCNSceneRenderer, didRemove node: SCNNode, for anchor: ARAnchor) {
        guard let plane = anchor as? ARPlaneAnchor else { return }
        DispatchQueue.main.async {
            self.horizontalPlaneAnchors.removeValue(forKey: plane.identifier)
            self.detectedHorizontalPlanes = self.horizontalPlaneAnchors.count
        }
    }
}

private enum ARRiskError: LocalizedError {
    case server(String)

    var errorDescription: String? {
        switch self {
        case .server(let message): return message
        }
    }
}

private extension Data {
    mutating func appendMultipart(_ string: String) {
        if let data = string.data(using: .utf8) {
            append(data)
        }
    }
}

private extension UIColor {
    static let coralRed = UIColor(red: 1.0, green: 0.40, blue: 0.44, alpha: 1)
    static let honeyYellow = UIColor(red: 1.0, green: 0.75, blue: 0.30, alpha: 1)
    static let mintGreen = UIColor(red: 0.29, green: 0.83, blue: 0.65, alpha: 1)
}
