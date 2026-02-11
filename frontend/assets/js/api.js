(function () {
  const FALLBACK_API_BASE = 'https://iosca-api.sparked.network/api';

  function normalizeApiBase(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      let path = parsed.pathname.replace(/\/+$/, '');
      if (!path || path === '/') path = '/api';
      return `${parsed.origin}${path}`;
    } catch (_) {
      return raw;
    }
  }

  function isUsableApiBase(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.replace(/\/+$/, '');
      if (host.endsWith('github.io')) return false;
      if (path === '' || path === '/') return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function resolveApiBase() {
    const configured = normalizeApiBase(window.HUB_CONFIG?.API_BASE_URL);
    const stored = normalizeApiBase(localStorage.getItem('IOSCA_HUB_API_BASE_URL'));
    const fallback = normalizeApiBase(FALLBACK_API_BASE);
    const base = [configured, stored, fallback].find((candidate) => isUsableApiBase(candidate)) || fallback;
    if (!window.HUB_CONFIG) window.HUB_CONFIG = {};
    window.HUB_CONFIG.API_BASE_URL = base;
    if (isUsableApiBase(base)) {
      try {
        localStorage.setItem('IOSCA_HUB_API_BASE_URL', base);
      } catch (_) {}
    }
    return base;
  }

  function assertApiConfigured() {
    const base = resolveApiBase();
    if (!base) {
      throw new Error(
        'Hub API URL is not configured. Open once with ?hub_api=https://your-api-domain/api'
      );
    }

    try {
      const parsed = new URL(base);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.replace(/\/+$/, '');

      // Guard against accidental GitHub Pages/API misconfiguration.
      if (host.endsWith('github.io') || path === '' || path === '/') {
        throw new Error();
      }
    } catch (_) {
      throw new Error(
        'Invalid Hub API URL. Use full URL like https://your-api-domain/api (not a GitHub Pages URL).'
      );
    }
  }

  function toQuery(params) {
    const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (!entries.length) return '';
    return '?' + new URLSearchParams(entries).toString();
  }

  async function request(path, params) {
    assertApiConfigured();
    const url = resolveApiBase() + path + toQuery(params);
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed (${response.status})`);
    }
    return response.json();
  }

  window.HubApi = {
    health: () => request('/health'),
    summary: () => request('/summary'),
    rankings: (limit) => request('/rankings', { limit }),
    players: (limit) => request('/players', { limit }),
    player: (steamId) => request('/player', { steam_id: steamId }),
    matches: (limit) => request('/matches', { limit }),
    match: (id) => request('/match', { id }),
    tournaments: () => request('/tournaments'),
    tournament: (id) => request(`/tournaments/${encodeURIComponent(id)}`),
    teams: () => request('/teams'),
    team: (guildId) => request('/team', { guild_id: guildId }),
    servers: () => request('/servers'),
    discord: () => request('/discord')
  };
})();
