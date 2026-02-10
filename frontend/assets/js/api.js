(function () {
  function assertApiConfigured() {
    const base = String(window.HUB_CONFIG?.API_BASE_URL || '');
    if (!base || base.includes('YOUR-BACKEND-DOMAIN')) {
      throw new Error(
        'Hub API URL is not configured. Set frontend/assets/js/config.js or open once with ?hub_api=https://your-api-domain/api'
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
    player: (steamId) => request(`/players/${encodeURIComponent(steamId)}`),
    matches: (limit) => request('/matches', { limit }),
    match: (id) => request(`/matches/${encodeURIComponent(id)}`),
    tournaments: () => request('/tournaments'),
    tournament: (id) => request(`/tournaments/${encodeURIComponent(id)}`),
    teams: () => request('/teams'),
    team: (guildId) => request(`/teams/${encodeURIComponent(guildId)}`),
    servers: () => request('/servers'),
    discord: () => request('/discord')
  };
})();
