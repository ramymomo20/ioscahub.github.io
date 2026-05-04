(function () {
  const FALLBACK_API_BASE = 'https://iosca-api.sparked.network/api';
  const STORAGE_PREFIX = 'IOSCA_HUB_CACHE:';
  const responseCache = new Map();
  const inflightRequests = new Map();

  function readStoredCache(key) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || parsed.expiresAt <= Date.now()) {
        localStorage.removeItem(STORAGE_PREFIX + key);
        return null;
      }
      return parsed.payload;
    } catch (_) {
      return null;
    }
  }

  function writeStoredCache(key, payload, ttlMs) {
    if (!ttlMs || ttlMs <= 0) return;
    try {
      localStorage.setItem(
        STORAGE_PREFIX + key,
        JSON.stringify({
          expiresAt: Date.now() + ttlMs,
          payload,
        })
      );
    } catch (_) {}
  }

  function readCache(key) {
    const cached = responseCache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      responseCache.delete(key);
      return null;
    }
    return cached.payload;
  }

  function writeCache(key, payload, ttlMs) {
    if (!ttlMs || ttlMs <= 0) return payload;
    responseCache.set(key, {
      expiresAt: Date.now() + ttlMs,
      payload,
    });
    writeStoredCache(key, payload, ttlMs);
    return payload;
  }

  function ttlForPath(path) {
    if (path === '/health') return 0;
    if (path === '/servers') return 300000;
    if (path === '/summary') return 120000;
    if (path === '/matches' || path === '/match') return 600000;
    if (path === '/discord') return 300000;
    if (path === '/players' || path === '/player' || path === '/hall-of-fame') return 900000;
    if (path === '/teams' || path === '/team' || path === '/team-h2h') return 900000;
    if (path === '/rankings' || path === '/tournaments') return 900000;
    return 300000;
  }

  async function fetchJson(url, ttlMs, fetchOptions) {
    const cached = readCache(url) || readStoredCache(url);
    if (cached) return cached;

    const inflight = inflightRequests.get(url);
    if (inflight) return inflight;

    const requestPromise = fetch(url, fetchOptions)
      .then(async (response) => {
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Request failed (${response.status})`);
        }
        const payload = await response.json();
        return writeCache(url, payload, ttlMs);
      })
      .finally(() => {
        inflightRequests.delete(url);
      });

    inflightRequests.set(url, requestPromise);
    return requestPromise;
  }

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
    let base = resolveApiBase();
    if (!isUsableApiBase(base)) {
      base = normalizeApiBase(FALLBACK_API_BASE);
      if (!window.HUB_CONFIG) window.HUB_CONFIG = {};
      window.HUB_CONFIG.API_BASE_URL = base;
      try {
        localStorage.setItem('IOSCA_HUB_API_BASE_URL', base);
      } catch (_) {}
    }
    return base;
  }

  function staticUrl(fileName) {
    const safeFile = String(fileName || '').replace(/^\/+/, '');
    return new URL(`../data/${safeFile}`, window.location.href).toString();
  }

  function toQuery(params) {
    const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (!entries.length) return '';
    return '?' + new URLSearchParams(entries).toString();
  }

  async function request(path, params) {
    const base = assertApiConfigured();
    const url = base + path + toQuery(params);
    return fetchJson(url, ttlForPath(path), {
      headers: { 'Accept': 'application/json' }
    });
  }

  async function staticRequest(fileName) {
    const url = staticUrl(fileName);
    return fetchJson(url, 3600000, {
      cache: 'force-cache',
      headers: { 'Accept': 'application/json' }
    });
  }

  window.HubApi = {
    health: () => request('/health'),
    summary: () => request('/summary'),
    rankings: (limit) => request('/rankings', { limit }),
    hallOfFame: (limit) => request('/hall-of-fame', { limit }),
    players: (params) => request('/players', typeof params === 'object' ? params : { limit: params }),
    player: (steamId) => request('/player', { steam_id: steamId }),
    matches: (params) => request('/matches', typeof params === 'object' ? params : { limit: params }),
    match: (id) => request('/match', { id }),
    tournaments: () => request('/tournaments'),
    tournament: (id) => request(`/tournaments/${encodeURIComponent(id)}`),
    teams: (params) => request('/teams', typeof params === 'object' ? params : undefined),
    team: (guildId) => request('/team', { guild_id: guildId }),
    teamH2H: (team1, team2, limit) => request('/team-h2h', { team1, team2, limit }),
    servers: () => request('/servers'),
    discord: () => request('/discord')
  };

  window.HubStatic = {
    home: () => staticRequest('home.json'),
    hallOfFame: () => staticRequest('hall-of-fame.json'),
    rankings: () => staticRequest('rankings.json'),
    players: () => staticRequest('players.json'),
    matches: () => staticRequest('matches.json'),
    teams: () => staticRequest('teams.json'),
    tournaments: () => staticRequest('tournaments.json'),
  };
})();
