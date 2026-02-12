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
    const summary = data.summary || {};
    const team = data.team || {};
    const roleBadge = p.role_badge || {};
    const memberRoles = Array.isArray(p.member_roles) ? p.member_roles : [];
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

    function totalNum(keys) {
      for (const key of keys || []) {
        if (totals[key] !== undefined && totals[key] !== null) return num(totals[key]);
      }
      return 0;
    }

    function totalInt(keys) {
      return Math.round(totalNum(keys));
    }

    function pct(value, places) {
      return `${num(value).toFixed(places || 1)}%`;
    }

    function passRateText() {
      const attempts = totalNum(['passes_attempted', 'passes']);
      const completed = totalNum(['passes_completed', 'passes_completed_total']);
      if (attempts <= 0) return '0%';
      return pct((completed / attempts) * 100, 1);
    }

    function saveRateText() {
      const saves = totalNum(['keeper_saves', 'keeperSaves']);
      const conceded = totalNum(['goals_conceded', 'goalsConceded']);
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

    function formIcon(result) {
      const value = String(result || '').toUpperCase();
      if (value === 'W') return '<img class="form-icon" src="assets/icons/form-w.svg" alt="W">';
      if (value === 'D') return '<img class="form-icon" src="assets/icons/form-d.svg" alt="D">';
      if (value === 'L') return '<img class="form-icon" src="assets/icons/form-l.svg" alt="L">';
      return '<span class="badge">-</span>';
    }

    function formStrip(values) {
      const rows = Array.isArray(values) ? values : [];
      if (!rows.length) return '<span class="meta">No form data</span>';
      return `<span class="form-strip">${rows.map(formIcon).join('')}</span>`;
    }

    function roleEmojiHtml(badge) {
      if (badge && badge.emoji_url) {
        return `<img class="player-role-emoji" src="${esc(badge.emoji_url)}" alt="role emoji">`;
      }
      const raw = String((badge && badge.emoji_raw_value) || '').trim();
      if (raw) return `<span class="player-role-emoji-text">${esc(raw)}</span>`;
      return '';
    }

    function roleChip(role) {
      const label = role && (role.role_name || role.role_key || role.role_raw_value || role.role_id);
      if (!label) return '';
      const emoji = roleEmojiHtml(role);
      return `
        <span class="player-role-chip">
          ${emoji}
          <span>${esc(String(label))}</span>
        </span>
      `;
    }

    function rolesSection() {
      const chips = memberRoles
        .map((role) => roleChip(role))
        .filter(Boolean)
        .join('');
      if (!chips) return '';
      return `
        <div class="player-member-roles">
          <div class="k">Discord Roles</div>
          <div class="player-role-chip-list">${chips}</div>
        </div>
      `;
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
      const finalLines = lines.length ? lines : [statLine('Data', 'No recorded data')];
      return `
        <article class="player-stat-widget">
          <h4>${esc(title)}</h4>
          <ul>
            ${finalLines.join('')}
          </ul>
        </article>
      `;
    }

    function buildNumericLines(defs) {
      const rows = [];
      for (const def of defs) {
        const value = totalInt(def.keys);
        if (value > 0 || def.keepWhenZero) {
          rows.push(statLine(def.label, value));
        }
      }
      return rows;
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
      <div class="grid cols-2 player-top-grid">
        <div class="player-left-stack">
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
                ${
                  (roleBadge && (roleBadge.role_name || roleBadge.role_key || roleBadge.emoji_raw_value || roleBadge.emoji_url))
                    ? `
                    <div class="player-role-asset-chip">
                      ${roleEmojiHtml(roleBadge)}
                      <span>
                        <strong>Role:</strong>
                        ${esc(roleBadge.role_name || roleBadge.role_key || 'N/A')}
                      </span>
                    </div>
                  `
                    : ''
                }
                ${rolesSection()}
              </div>
            </div>
            <div class="footer-note">Registered: ${fmtDateTime(p.registered_at)} | Last active: ${fmtDateTime(p.last_active)}</div>
          </div>

          <div class="card player-summary-card" style="margin:10px 0 0;">
            <h3>Form & Trends</h3>
            <div class="player-quick-summary">
              <div class="quick-box">
                <div class="k">W/D/L</div>
                <div class="v">${esc(summary.wins || 0)}/${esc(summary.draws || 0)}/${esc(summary.losses || 0)}</div>
              </div>
              <div class="quick-box">
                <div class="k">Win Rate</div>
                <div class="v">${esc(Number(summary.win_rate || 0).toFixed(1))}%</div>
              </div>
              <div class="quick-box">
                <div class="k">Avg Goals</div>
                <div class="v">${esc(Number(summary.avg_goals_per_match || 0).toFixed(2))}</div>
              </div>
              <div class="quick-box">
                <div class="k">Avg Assists</div>
                <div class="v">${esc(Number(summary.avg_assists_per_match || 0).toFixed(2))}</div>
              </div>
              <div class="quick-form">
                <div class="k">Last 5</div>
                ${formStrip(summary.form_last5 || [])}
              </div>
            </div>
          </div>
        </div>
        <div class="card" style="margin:0;">
          <h3>Performance Overview</h3>
          <div class="grid cols-2">
            <div class="stat"><div class="label">Matches</div><div class="value">${esc(totalInt(['matches_played']))}</div></div>
            <div class="stat"><div class="label">Pass Accuracy</div><div class="value">${esc(pct(totals.avg_pass_accuracy, 1))}</div></div>
          </div>
          <div class="player-stats-grid">
            ${categoryCard('Attacking', buildNumericLines([
              { label: 'Goals', keys: ['goals'] },
              { label: 'Assists', keys: ['assists'] },
              { label: '2nd Assists', keys: ['second_assists', 'secondAssists'] },
              { label: 'Shots', keys: ['shots'] },
              { label: 'Shots on Goal', keys: ['shots_on_goal', 'shotsOnGoal'] },
              { label: 'Offsides', keys: ['offsides'] }
            ]))}
            ${categoryCard('Playmaking', [
              ...buildNumericLines([
                { label: 'Chances Created', keys: ['chances_created', 'chancesCreated'] },
                { label: 'Key Passes', keys: ['key_passes', 'keyPasses'] },
                { label: 'Passes', keys: ['passes_attempted', 'passes'] },
                { label: 'Passes Completed', keys: ['passes_completed', 'passesCompleted'] },
                { label: 'Corners', keys: ['corners'] },
                { label: 'Free Kicks', keys: ['free_kicks', 'freeKicks'] }
              ]),
              statLine('Pass Rate', passRateText())
            ])}
            ${categoryCard('Defensive', buildNumericLines([
              { label: 'Interceptions', keys: ['interceptions'] },
              { label: 'Tackles', keys: ['sliding_tackles_completed', 'slidingTacklesCompleted', 'tackles'] },
              { label: 'Tackle Attempts', keys: ['tackles', 'sliding_tackles'] },
              { label: 'Fouls', keys: ['fouls'] },
              { label: 'Fouls Suffered', keys: ['fouls_suffered', 'foulsSuffered'] },
              { label: 'Own Goals', keys: ['own_goals', 'ownGoals'] }
            ]))}
            ${categoryCard('Goalkeeper', [
              ...buildNumericLines([
                { label: 'Saves', keys: ['keeper_saves', 'keeperSaves'] },
                { label: 'Saves Caught', keys: ['keeper_saves_caught', 'keeperSavesCaught'] },
                { label: 'Goals Conceded', keys: ['goals_conceded', 'goalsConceded'] }
              ]),
              statLine('Save Rate', saveRateText())
            ])}
            ${categoryCard('Discipline & Physical', [
              ...buildNumericLines([
                { label: 'Yellow Cards', keys: ['yellow_cards', 'yellowCards'] },
                { label: 'Red Cards', keys: ['red_cards', 'redCards'] },
                { label: 'Penalties', keys: ['penalties'] }
              ]),
              ...(totalInt(['distance_covered', 'distanceCovered']) > 0
                ? [statLine('Distance Covered', `${totalInt(['distance_covered', 'distanceCovered'])} m`)]
                : []),
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
