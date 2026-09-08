import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const swiftFile = resolve(
  "node_modules",
  "llama-cpp-capacitor",
  "ios",
  "Sources",
  "LlamaCppCapacitor",
  "LlamaCpp.swift",
);

if (!existsSync(swiftFile)) {
  console.warn("llama-cpp-capacitor 尚未安裝，略過 iOS 修補。");
  process.exit(0);
}

const original = readFileSync(swiftFile, "utf8");
const broken = "LlamaNativeBridge.queryGpuInfo(nativeContextId)";
const fixed = "LlamaNativeBridge.queryGpuInfo(contextId: nativeContextId)";

if (original.includes(broken)) {
  writeFileSync(swiftFile, original.replaceAll(broken, fixed));
  console.log("已修補 llama-cpp-capacitor iOS queryGpuInfo 參數標籤。");
} else if (original.includes(fixed)) {
  console.log("llama-cpp-capacitor iOS 修補已存在。");
} else {
  throw new Error("找不到預期的 queryGpuInfo Swift 程式碼；套件版本可能已變更。");
}
