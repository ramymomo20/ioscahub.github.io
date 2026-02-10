(function () {
  function assertApiConfigured() {
    const base = String(window.HUB_CONFIG?.API_BASE_URL || '').trim();
    if (!base || base.includes('YOUR-BACKEND-DOMAIN')) {
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
    const url = window.HUB_CONFIG.API_BASE_URL + path + toQuery(params);
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
