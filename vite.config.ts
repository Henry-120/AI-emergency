import fs from "fs";
import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 本機自簽憑證。手機用區網 IP 連進來時，純 HTTP 不算「安全環境」，
 * 瀏覽器會拿掉 crypto.subtle，密碼雜湊因此失敗、無法登入。
 * 開了 HTTPS 就有安全環境。憑證不存在時自動退回 HTTP。
 */
const certDir = path.resolve(__dirname, ".certs");
const keyPath = path.join(certDir, "dev-key.pem");
const certPath = path.join(certDir, "dev-cert.pem");
const httpsOptions =
  fs.existsSync(keyPath) && fs.existsSync(certPath)
    ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
    : undefined;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    server: {
      port: 3000,
      host: "0.0.0.0",
      https: httpsOptions,
      /**
       * 把 /api 代理到後端，讓前端與 API 同源。
       * 手機用區網連進來時，這樣只需要信任 3000 埠這一張自簽憑證，
       * 不必再單獨去信任 8000 埠——漏掉那步就會出現 Safari 的 "Load failed"。
       * secure:false 是讓 Vite 自己去接後端的自簽憑證。
       */
      proxy: {
        "/api": {
          target: "https://localhost:8000",
          changeOrigin: true,
          secure: false,
        },
      },
    },
    plugins: [react()],
    // define: {
    //   "process.env.API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    //   "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    //   "process.env.OPENAI_API_KEY": JSON.stringify(env.OPENAI_API_KEY),
    // },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
