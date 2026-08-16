// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.2.0"),
        .package(name: "CapacitorCommunityBluetoothLe", path: "..\..\..\node_modules\@capacitor-community\bluetooth-le"),
        .package(name: "CapacitorCommunitySqlite", path: "..\..\..\node_modules\@capacitor-community\sqlite"),
        .package(name: "CapacitorCamera", path: "..\..\..\node_modules\@capacitor\camera"),
        .package(name: "CapacitorDevice", path: "..\..\..\node_modules\@capacitor\device"),
        .package(name: "CapacitorLocalNotifications", path: "..\..\..\node_modules\@capacitor\local-notifications"),
        .package(name: "CapacitorPreferences", path: "..\..\..\node_modules\@capacitor\preferences"),
        .package(name: "LlamaCppCapacitor", path: "..\..\..\node_modules\llama-cpp-capacitor"),
        .package(name: "CordovaPluginHealth", path: "../../capacitor-cordova-ios-plugins/sources/CordovaPluginHealth")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCommunityBluetoothLe", package: "CapacitorCommunityBluetoothLe"),
                .product(name: "CapacitorCommunitySqlite", package: "CapacitorCommunitySqlite"),
                .product(name: "CapacitorCamera", package: "CapacitorCamera"),
                .product(name: "CapacitorDevice", package: "CapacitorDevice"),
                .product(name: "CapacitorLocalNotifications", package: "CapacitorLocalNotifications"),
                .product(name: "CapacitorPreferences", package: "CapacitorPreferences"),
                .product(name: "LlamaCppCapacitor", package: "LlamaCppCapacitor"),
                .product(name: "CordovaPluginHealth", package: "CordovaPluginHealth")
            ]
        )
    ]
)
