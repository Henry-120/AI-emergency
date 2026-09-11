const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const getBackendUrl = () => {
  const configured = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

  try {
    const url = new URL(configured);
    const pageHost = window.location.hostname;

    if (LOCAL_HOSTS.has(url.hostname) && !LOCAL_HOSTS.has(pageHost)) {
      url.hostname = pageHost;
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return configured.replace(/\/$/, "");
  }
};

export const BACKEND = getBackendUrl();

/**
 * 以 BACKEND 為前綴組出可用的 URL 物件。
 *
 * BACKEND 在同源模式下是空字串（走 Vite 的 /api 代理），
 * 這時 `new URL("/api/...")` 會因為沒有基底而拋錯，
 * 所以一律帶上目前頁面的 origin 當基底。
 */
export const buildBackendUrl = (path: string) =>
  new URL(`${BACKEND}${path}`, window.location.origin);
