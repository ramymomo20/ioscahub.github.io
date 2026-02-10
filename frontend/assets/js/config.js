(function () {
  const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const productionDefaultApi = "https://iosca-api.sparked.network/api";
  const globalDefaultApi = String(window.IOSCA_HUB_API_BASE_URL || "").trim();

  function normalizeApiBase(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (isLocal) return raw;

    try {
      const parsed = new URL(raw);
      let path = parsed.pathname.replace(/\/+$/, "");
      if (!path || path === "/") {
        path = "/api";
      }
      return `${parsed.origin}${path}`;
    } catch (_) {
      return raw;
    }
  }

  // Optional quick override:
  // https://.../frontend/index.html?hub_api=https://api.example.com/api
  // This persists in localStorage.
  const params = new URLSearchParams(window.location.search);
  const qsApi = params.get("hub_api");
  if (qsApi) {
    localStorage.setItem("IOSCA_HUB_API_BASE_URL", normalizeApiBase(qsApi));
  }

  const storedApi = normalizeApiBase(localStorage.getItem("IOSCA_HUB_API_BASE_URL"));
  const apiBase = isLocal
    ? "http://127.0.0.1:8080/api"
    : (storedApi || normalizeApiBase(globalDefaultApi) || productionDefaultApi);

  function deriveWsUrl(apiUrl) {
    if (!apiUrl) {
      return "";
    }
    try {
      const parsed = new URL(apiUrl);
      const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      return `${wsProtocol}//${parsed.host}/ws/live`;
    } catch (_) {
      return "";
    }
  }

  window.HUB_CONFIG = {
    API_BASE_URL: apiBase,
    WS_URL: deriveWsUrl(apiBase),
  };
})();
