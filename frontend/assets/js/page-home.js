(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout('index.html', 'Dashboard');
  const page = byId('page');

  try {
    const [summary, matches, tournaments] = await Promise.all([
      window.HubApi.summary(),
      window.HubApi.matches(8),
      window.HubApi.tournaments()
    ]);

    const cards = [
      ['Players', summary.players_total || 0],
      ['Teams', summary.teams_total || 0],
      ['Matches', summary.matches_total || 0],
      ['Active Tournaments', summary.active_tournaments_total || 0],
      ['Active Servers', summary.active_servers_total || 0]
    ];

    const recentMatches = (matches.matches || []).slice(0, 6);
    const activeTournaments = (tournaments.tournaments || []).filter(t => String(t.status).toLowerCase() === 'active').slice(0, 6);

    page.innerHTML = `
      <div class="grid cols-4">
        ${cards.map(([label, value]) => `<div class="stat"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`).join('')}
      </div>
      <div class="grid cols-2" style="margin-top:10px;">
        <div class="card" style="margin:0;">
          <h2>Recent matches</h2>
          <div class="list">
            ${recentMatches.length ? recentMatches.map(m => `
              <div class="item">
                <div class="meta">${fmtDateTime(m.datetime)} ${m.tournament_name ? `| ${esc(m.tournament_name)}` : ''}</div>
                <div><a href="match.html?id=${esc(m.id)}">${esc(m.home_team_name)} ${esc(m.home_score)} - ${esc(m.away_score)} ${esc(m.away_team_name)}</a></div>
              </div>
            `).join('') : '<div class="empty">No matches yet.</div>'}
          </div>
        </div>
        <div class="card" style="margin:0;">
          <h2>Active tournaments</h2>
          <div class="list">
            ${activeTournaments.length ? activeTournaments.map(t => `
              <div class="item">
                <div><a href="tournament.html?id=${esc(t.id)}">${esc(t.name)}</a></div>
                <div class="meta">Format: ${esc(t.format)} | Fixtures: ${esc(t.fixtures_played)}/${esc(t.fixtures_total)}</div>
              </div>
            `).join('') : '<div class="empty">No active tournaments.</div>'}
          </div>
        </div>
      </div>
      <div class="card" style="margin:10px 0 0;">
        <h2>Live feed</h2>
        <div id="liveFeed" class="list"><div class="empty">Waiting for websocket events...</div></div>
        <div class="footer-note" style="margin-top:8px;">Send POST /api/webhooks/events to broadcast updates here.</div>
      </div>
    `;

    const feed = byId('liveFeed');
    if (feed) {
      const ws = new WebSocket(window.HUB_CONFIG.WS_URL);
      ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { data = { event: 'message', payload: event.data }; }
        const row = document.createElement('div');
        row.className = 'item';
        row.innerHTML = `<div class="meta">${fmtDateTime(data.ts || new Date().toISOString())}</div><div>${esc(data.event || 'event')}</div>`;
        feed.prepend(row);
        const empty = feed.querySelector('.empty');
        if (empty) empty.remove();
        while (feed.children.length > 12) feed.removeChild(feed.lastChild);
      };
    }
  } catch (err) {
    showError(`Failed to load dashboard: ${err.message}`);
  }
})();
