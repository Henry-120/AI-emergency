import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

const modelName = "qwen2.5-0.5b-instruct-q4_k_m.gguf";
const source = resolve("models", modelName);

if (!existsSync(source)) {
  throw new Error(`找不到離線模型：${source}`);
}
if (statSync(source).size < 100 * 1024 * 1024) {
  throw new Error(`模型檔案大小異常：${source}`);
}

execFileSync("npx", ["cap", "sync", "ios"], { stdio: "inherit" });

const targetDirectory = resolve("ios", "App", "App", "public", "models");
mkdirSync(targetDirectory, { recursive: true });
const target = resolve(targetDirectory, basename(source));
copyFileSync(source, target);

execFileSync("node", ["scripts/patch-llama-ios.mjs"], { stdio: "inherit" });

console.log(`離線模型已加入 iOS App：${target}`);
