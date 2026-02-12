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
    const teamLogoFallback = 'assets/icons/iosca-icon.png';

    function fmtRating(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(2) : 'N/A';
    }

    function num(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }

    function intNum(value) {
      return Math.round(num(value));
    }

    function pct(value, places) {
      return `${num(value).toFixed(places || 1)}%`;
    }

    function passRateText() {
      const attempts = num(totals.passes_attempted);
      const completed = num(totals.passes_completed);
      if (attempts <= 0) return '0%';
      return pct((completed / attempts) * 100, 1);
    }

    function saveRateText() {
      const saves = num(totals.keeper_saves);
      const conceded = num(totals.goals_conceded);
      const faced = saves + conceded;
      if (faced <= 0) return '0%';
      return pct((saves / faced) * 100, 1);
    }

    function possessionText() {
      const matches = num(totals.matches_played);
      if (matches <= 0) return '0%';
      // Matches existing /view_player presentation style.
      return pct(num(totals.possession) / (matches * 10), 2);
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

    function statLine(label, value) {
      return `<li><span>${esc(label)}</span><strong>${esc(String(value))}</strong></li>`;
    }

    function categoryCard(title, lines) {
      return `
        <article class="player-stat-widget">
          <h4>${esc(title)}</h4>
          <ul>
            ${lines.join('')}
          </ul>
        </article>
      `;
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
              ${
                team.guild_id
                  ? `
                  <div class="player-team-chip">
                    <img src="${esc(team.guild_icon || teamLogoFallback)}" alt="${esc(team.guild_name || 'Team')}" onerror="this.onerror=null;this.src='${teamLogoFallback}';">
                    <span>Current team: <a href="team.html?id=${esc(team.guild_id)}">${esc(team.guild_name || 'Unknown Team')}</a></span>
                  </div>
                `
                  : `<div class="player-team-chip empty"><span>Current team: N/A</span></div>`
              }
            </div>
          </div>
          <div class="footer-note">Registered: ${fmtDateTime(p.registered_at)} | Last active: ${fmtDateTime(p.last_active)}</div>
        </div>
        <div class="card" style="margin:0;">
          <h3>Performance Overview</h3>
          <div class="grid cols-2">
            <div class="stat"><div class="label">Matches</div><div class="value">${esc(intNum(totals.matches_played))}</div></div>
            <div class="stat"><div class="label">Pass Accuracy</div><div class="value">${esc(pct(totals.avg_pass_accuracy, 1))}</div></div>
          </div>
          <div class="player-stats-grid">
            ${categoryCard('Attacking', [
              statLine('Goals', intNum(totals.goals)),
              statLine('Assists', intNum(totals.assists)),
              statLine('2nd Assists', intNum(totals.second_assists)),
              statLine('Shots', intNum(totals.shots)),
              statLine('Shots on Goal', intNum(totals.shots_on_goal)),
              statLine('Offsides', intNum(totals.offsides))
            ])}
            ${categoryCard('Playmaking', [
              statLine('Chances Created', intNum(totals.chances_created)),
              statLine('Key Passes', intNum(totals.key_passes)),
              statLine('Passes', intNum(totals.passes_attempted)),
              statLine('Passes Completed', intNum(totals.passes_completed)),
              statLine('Corners', intNum(totals.corners)),
              statLine('Free Kicks', intNum(totals.free_kicks)),
              statLine('Pass Rate', passRateText())
            ])}
            ${categoryCard('Defensive', [
              statLine('Interceptions', intNum(totals.interceptions)),
              statLine('Tackles', intNum(totals.sliding_tackles_completed)),
              statLine('Tackle Attempts', intNum(totals.tackles)),
              statLine('Fouls', intNum(totals.fouls)),
              statLine('Fouls Suffered', intNum(totals.fouls_suffered)),
              statLine('Own Goals', intNum(totals.own_goals))
            ])}
            ${categoryCard('Goalkeeper', [
              statLine('Saves', intNum(totals.keeper_saves)),
              statLine('Saves Caught', intNum(totals.keeper_saves_caught)),
              statLine('Goals Conceded', intNum(totals.goals_conceded)),
              statLine('Save Rate', saveRateText())
            ])}
            ${categoryCard('Discipline & Physical', [
              statLine('Yellow Cards', intNum(totals.yellow_cards)),
              statLine('Red Cards', intNum(totals.red_cards)),
              statLine('Penalties', intNum(totals.penalties)),
              statLine('Distance Covered', `${intNum(totals.distance_covered)} m`),
              statLine('Possession', possessionText())
            ])}
          </div>
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
