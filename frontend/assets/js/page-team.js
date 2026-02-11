(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout('team.html', 'Team profile');
  const page = byId('page');

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) {
    showError('Missing team id in URL.');
    return;
  }

  try {
    const data = await window.HubApi.team(id);
    const team = data.team || {};
    const stats = data.stats || {};
    const players = data.players || [];
    const recent = data.recent_matches || [];
    const fallbackAvatar = 'https://cdn.discordapp.com/embed/avatars/0.png';

    page.innerHTML = `
      <div class="grid cols-2">
        <div class="card team-hero-card" style="margin:0;">
          <div class="team-head">
            ${team.guild_icon ? `<img class="team-profile-logo" src="${esc(team.guild_icon)}" alt="team">` : ''}
            <div class="team-details">
              <h2>${esc(team.guild_name)}</h2>
              <div class="meta">Captain: ${esc(team.captain_name || 'N/A')}</div>
              <div class="meta">Average rating: ${esc(team.average_rating || 0)}</div>
              <div class="meta">Created: ${fmtDateTime(team.created_at)}</div>
            </div>
          </div>
        </div>
        <div class="card" style="margin:0;">
          <h3>Team stats</h3>
          <div class="grid cols-3">
            <div class="stat"><div class="label">Matches</div><div class="value">${esc(stats.matches_played || 0)}</div></div>
            <div class="stat"><div class="label">W/D/L</div><div class="value" style="font-size:1rem;">${esc(stats.wins || 0)}/${esc(stats.draws || 0)}/${esc(stats.losses || 0)}</div></div>
            <div class="stat"><div class="label">GF/GA</div><div class="value" style="font-size:1rem;">${esc(stats.goals_for || 0)}/${esc(stats.goals_against || 0)}</div></div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:10px;">
        <h3>Players</h3>
        <div class="list">
          ${players.length ? players.map((p) => `
            <div class="item">
              <span class="cell-inline">
                <img class="avatar" src="${esc(p.display_avatar_url || p.steam_avatar_url || p.avatar_url || p.avatar_fallback_url || fallbackAvatar)}" alt="avatar" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
                ${p.steam_id ? `<a href="player.html?steam_id=${encodeURIComponent(p.steam_id)}">${esc(p.name)}</a>` : esc(p.name)}
              </span>
              <div class="meta">Rating: ${esc(p.rating || 'N/A')} ${p.steam_id ? `| Steam: ${esc(p.steam_id)}` : ''}</div>
            </div>
          `).join('') : '<div class="empty">No players listed in team roster.</div>'}
        </div>
      </div>

      <div class="card" style="margin-top:10px;">
        <h3>Recent matches</h3>
        <div class="list">
          ${recent.length ? recent.map((m) => `
            <div class="item">
              <div class="meta">${fmtDateTime(m.datetime)}</div>
              <div><a href="match.html?id=${esc(m.id)}">${esc(m.home_team_name)} ${esc(m.home_score)} - ${esc(m.away_score)} ${esc(m.away_team_name)}</a></div>
            </div>
          `).join('') : '<div class="empty">No matches yet.</div>'}
        </div>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load team profile: ${err.message}`);
  }
})();
