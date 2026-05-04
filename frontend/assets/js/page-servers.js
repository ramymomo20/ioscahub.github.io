(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout('servers.html', 'Servers And Matchday Access', {
    layout: 'wide',
    eyebrow: 'Game Servers'
  });

  const page = byId('page');

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function cleanMap(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return 'Unknown map';
    return raw.replace(/\s+at:\s+.*$/i, '').trim() || 'Unknown map';
  }

  function serverStatus(server) {
    if (server.live_online) return 'Live';
    if (server.is_active) return 'Configured';
    return 'Offline';
  }

  function serverBadgeClass(server) {
    if (server.live_online) return 'live';
    if (server.is_active) return 'queued';
    return 'offline';
  }

  function serverPlayers(server) {
    const current = server.current_players;
    const max = server.max_players;
    if (current === null || current === undefined || current === '') return 'Player count unavailable';
    if (max !== null && max !== undefined && max !== '') return `${current} / ${max} players`;
    return `${current} players`;
  }

  function connectHref(server) {
    return String(server.connect_link || '').trim();
  }

  function serverCard(server, index) {
    const connect = connectHref(server);
    return `
      <article class="v2-card tier-${index === 0 ? 'a' : 'b'} community-server-card ${serverBadgeClass(server)}">
        <div class="community-card-head">
          <span class="v2-kicker">Server ${index + 1}</span>
          <span class="community-status-pill ${serverBadgeClass(server)}">${esc(serverStatus(server))}</span>
        </div>
        <h3>${esc(server.live_name || server.name || 'IOSCA Server')}</h3>
        <div class="community-server-meta">
          <span><strong>Address</strong>${esc(server.address || 'Unavailable')}</span>
          <span><strong>Mode</strong>${esc(server.server_type || (server.is_mix ? 'Mix' : 'Community'))}</span>
          <span><strong>Map</strong>${esc(cleanMap(server.map_name))}</span>
          <span><strong>Players</strong>${esc(serverPlayers(server))}</span>
        </div>
        <p class="v2-subtitle">Use the Steam connect link for the fastest route in, or copy the server address directly if you are joining manually.</p>
        <div class="community-cta-row">
          ${connect ? `<a class="home-action-btn" href="${esc(connect)}">Connect Now</a>` : '<span class="community-muted">Connect link unavailable</span>'}
          <span class="community-muted">Updated ${esc(fmtDateTime(server.updated_at))}</span>
        </div>
      </article>
    `;
  }

  try {
    const [serversPayload, discordPayload] = await Promise.all([
      window.HubApi.servers(),
      window.HubApi.discord().catch(() => ({}))
    ]);

    const servers = Array.isArray(serversPayload.servers) ? serversPayload.servers.slice() : [];
    servers.sort((left, right) => {
      const liveDiff = num(Boolean(right.live_online)) - num(Boolean(left.live_online));
      if (liveDiff) return liveDiff;
      const activeDiff = num(Boolean(right.is_active)) - num(Boolean(left.is_active));
      if (activeDiff) return activeDiff;
      return String(left.name || '').localeCompare(String(right.name || ''));
    });

    const totalServers = servers.length;
    const liveServers = servers.filter((server) => server.live_online).length;
    const activeServers = servers.filter((server) => server.is_active).length;
    const totalPlayers = servers.reduce((sum, server) => sum + num(server.current_players), 0);
    const inviteUrl = String(discordPayload.discord_invite_url || '').trim();

    page.innerHTML = `
      <div class="hub-v2 community-page">
        <section class="v2-card tier-a community-hero">
          <div class="community-hero-copy">
            <div class="v2-kicker">Matchday Entry</div>
            <h2 class="v2-display">Find the live lobby, check the map rotation, and jump straight into the right server.</h2>
            <p class="v2-subtitle">This page now behaves like a control room instead of a raw server dump. Live status is pulled from the backend, with stored database values used as fallback.</p>
            <div class="community-cta-row">
              ${inviteUrl ? `<a class="home-action-btn" target="_blank" rel="noreferrer" href="${esc(inviteUrl)}">Join Discord</a>` : ''}
              <a class="home-action-btn" href="matches.html">See Latest Matches</a>
              <a class="home-action-btn" href="discord.html">Community Guide</a>
            </div>
          </div>
          <div class="v2-grid four community-stat-grid">
            <article class="v2-stat-tile"><span class="v2-label">Total Servers</span><strong>${esc(String(totalServers))}</strong></article>
            <article class="v2-stat-tile"><span class="v2-label">Live Right Now</span><strong>${esc(String(liveServers))}</strong></article>
            <article class="v2-stat-tile"><span class="v2-label">Configured</span><strong>${esc(String(activeServers))}</strong></article>
            <article class="v2-stat-tile"><span class="v2-label">Players Visible</span><strong>${esc(String(totalPlayers))}</strong></article>
          </div>
        </section>

        <section class="v2-grid two community-server-grid">
          ${servers.length ? servers.map(serverCard).join('') : '<div class="v2-mini-card">No server records are available.</div>'}
        </section>

        <section class="v2-grid three">
          <article class="v2-card tier-b community-guide-card">
            <div class="v2-kicker">How To Join</div>
            <h3>Quickest route into a match</h3>
            <div class="community-list">
              <div class="community-list-row"><strong>1</strong><span>Watch the live server cards and choose a lobby marked <em>Live</em> first.</span></div>
              <div class="community-list-row"><strong>2</strong><span>Use <em>Connect Now</em> to open Steam directly into the selected server.</span></div>
              <div class="community-list-row"><strong>3</strong><span>If a server is only configured, coordinate through Discord before queueing in.</span></div>
            </div>
          </article>
          <article class="v2-card tier-b community-guide-card">
            <div class="v2-kicker">What The Status Means</div>
            <h3>Reading the board</h3>
            <div class="community-list">
              <div class="community-list-row"><strong>Live</strong><span>RCON or A2S responded and the live server details were refreshed.</span></div>
              <div class="community-list-row"><strong>Configured</strong><span>The server is marked active in the database but did not answer the live probe.</span></div>
              <div class="community-list-row"><strong>Offline</strong><span>No active route is currently being served to the hub.</span></div>
            </div>
          </article>
          <article class="v2-card tier-b community-guide-card">
            <div class="v2-kicker">Community Links</div>
            <h3>Keep the matchday loop tight</h3>
            <div class="community-link-stack">
              ${inviteUrl ? `<a class="v2-mini-card" target="_blank" rel="noreferrer" href="${esc(inviteUrl)}"><strong>Discord Lobby</strong><span class="v2-subtitle">Announcements, signups, and queue coordination.</span></a>` : ''}
              <a class="v2-mini-card" href="tournaments.html"><strong>Tournaments</strong><span class="v2-subtitle">Check standings, fixtures, and pressure points.</span></a>
              <a class="v2-mini-card" href="rankings.html"><strong>Leaderboards</strong><span class="v2-subtitle">See who is arriving in form before kickoff.</span></a>
            </div>
          </article>
        </section>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load servers: ${err.message}`);
  }
})();
