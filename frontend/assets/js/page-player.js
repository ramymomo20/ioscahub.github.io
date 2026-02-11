(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout('player.html', 'Player profile');
  const page = byId('page');

  const params = new URLSearchParams(window.location.search);
  const steamId = params.get('steam_id');
  if (!steamId) {
    showError('Missing steam_id in URL.');
    return;
  }

  try {
    const data = await window.HubApi.player(steamId);
    const p = data.player || {};
    const totals = data.totals || {};
    const recent = data.recent_matches || [];
    const team = data.team || {};
    const fallbackAvatar = 'https://cdn.discordapp.com/embed/avatars/0.png';

    function fmtRating(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(2) : 'N/A';
    }

    function resultTag(result) {
      const value = String(result || '').toUpperCase();
      if (value === 'W') return '<span class="badge" style="background:#113d24;border-color:#1f8a4c;color:#9af0bd;">W</span>';
      if (value === 'D') return '<span class="badge" style="background:#3d3111;border-color:#8a6c1f;color:#f0df9a;">D</span>';
      if (value === 'L') return '<span class="badge" style="background:#3d1111;border-color:#8a1f1f;color:#f0a39a;">L</span>';
      return '<span class="badge">-</span>';
    }

    function competitionLabel(match) {
      if (match.is_tournament || match.tournament_name) {
        return `Tournament${match.tournament_name ? `: ${match.tournament_name}` : ''}`;
      }
      return 'Official Mix';
    }

    function statSummary(match) {
      return [
        `Goals: ${Number(match.goals || 0)}`,
        `Assists: ${Number(match.assists || 0)}`,
        `Saves: ${Number(match.keeper_saves || 0)}`,
        `Tackles: ${Number(match.tackles || 0)}`,
        `Interceptions: ${Number(match.interceptions || 0)}`
      ].join(' | ');
    }

    page.innerHTML = `
      <div class="grid cols-2">
        <div class="card profile-hero-card" style="margin:0;">
          <div class="profile-head">
            <img class="profile-avatar-lg" src="${esc(p.display_avatar_url || p.steam_avatar_url || p.avatar_url || p.avatar_fallback_url || fallbackAvatar)}" alt="avatar" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
            <div class="profile-details">
              <h2>${esc(p.discord_name || p.steam_name || 'Unknown')}</h2>
              <div class="player-role-rating">
                <div class="role-box">
                  <div class="k">Position</div>
                  <div class="v">${esc(p.position || 'N/A')}</div>
                </div>
                <div class="role-box">
                  <div class="k">Rating</div>
                  <div class="v">${esc(fmtRating(p.rating))}</div>
                </div>
              </div>
              <div class="meta">Steam: ${esc(p.steam_id)}${p.steam_name ? ` | ${esc(p.steam_name)}` : ''}</div>
              ${p.steam_profile_url ? `<div class="profile-link"><a target="_blank" rel="noreferrer" href="${esc(p.steam_profile_url)}">Open Steam profile</a></div>` : ''}
            </div>
          </div>
          <div class="footer-note">Registered: ${fmtDateTime(p.registered_at)} | Last active: ${fmtDateTime(p.last_active)}</div>
        </div>
        <div class="card" style="margin:0;">
          <h3>Profile totals</h3>
          <div class="grid cols-2">
            <div class="stat"><div class="label">Matches</div><div class="value">${esc(totals.matches_played || 0)}</div></div>
            <div class="stat"><div class="label">Goals</div><div class="value">${esc(totals.goals || 0)}</div></div>
            <div class="stat"><div class="label">Assists</div><div class="value">${esc(totals.assists || 0)}</div></div>
            <div class="stat"><div class="label">Saves</div><div class="value">${esc(totals.keeper_saves || 0)}</div></div>
            <div class="stat"><div class="label">Tackles</div><div class="value">${esc(totals.tackles || 0)}</div></div>
            <div class="stat"><div class="label">Interceptions</div><div class="value">${esc(totals.interceptions || 0)}</div></div>
          </div>
          ${team.guild_id ? `<div style="margin-top:10px;" class="meta">Current team: <a href="team.html?id=${esc(team.guild_id)}">${esc(team.guild_name)}</a></div>` : '<div style="margin-top:10px;" class="meta">Current team: N/A</div>'}
        </div>
      </div>
      <div class="card" style="margin-top:10px;">
        <h3>Recent matches</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th style="width:72px;">Result</th><th>Date</th><th>Match</th><th>Position</th><th>Stats</th><th>Competition</th></tr></thead>
            <tbody>
              ${recent.length ? recent.map((m) => `
                <tr>
                  <td style="width:72px;">${resultTag(m.result)}</td>
                  <td>${fmtDateTime(m.datetime)}</td>
                  <td><a href="match.html?id=${esc(m.match_id)}">${esc(m.home_team_name)} ${esc(m.home_score)} - ${esc(m.away_score)} ${esc(m.away_team_name)}</a></td>
                  <td>${esc(m.position || 'N/A')}</td>
                  <td>${esc(statSummary(m))}</td>
                  <td>${esc(competitionLabel(m))}</td>
                </tr>
              `).join('') : '<tr><td colspan="6">No matches</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load player profile: ${err.message}`);
  }
})();
