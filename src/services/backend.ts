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
