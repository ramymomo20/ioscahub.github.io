(function () {
  const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const isGithubPages = /\.github\.io$/i.test(window.location.hostname);

  // Optional quick override:
  // https://.../frontend/index.html?hub_api=https://api.example.com/api
  // This persists in localStorage.
  const params = new URLSearchParams(window.location.search);
  const qsApi = params.get("hub_api");
  if (qsApi) {
    localStorage.setItem("IOSCA_HUB_API_BASE_URL", qsApi);
  }

  const storedApi = localStorage.getItem("IOSCA_HUB_API_BASE_URL");
  const defaultApi = isLocal
    ? "http://127.0.0.1:8080/api"
    : (isGithubPages ? "https://YOUR-BACKEND-DOMAIN/api" : "/api");
  const apiBase = storedApi || defaultApi;

  function deriveWsUrl(apiUrl) {
    try {
      const parsed = new URL(apiUrl);
      const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      return `${wsProtocol}//${parsed.host}/ws/live`;
    } catch (_) {
      return isLocal
        ? "ws://127.0.0.1:8080/ws/live"
        : "wss://YOUR-BACKEND-DOMAIN/ws/live";
    }
  }

  window.HUB_CONFIG = {
    API_BASE_URL: apiBase,
    WS_URL: deriveWsUrl(apiBase),
  };
})();
