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
    const summary = data.summary || {};
    const fallbackAvatar = 'https://cdn.discordapp.com/embed/avatars/0.png';

    function posBucket(position) {
      const p = String(position || '').toUpperCase();
      if (p === 'GK') return 'gk';
      if (['LB', 'RB', 'CB', 'SW', 'LWB', 'RWB', 'DEF'].includes(p)) return 'def';
      if (['LM', 'RM', 'CM', 'CDM', 'CAM', 'MID'].includes(p)) return 'mid';
      if (['LW', 'RW', 'CF', 'ST', 'ATT'].includes(p)) return 'att';
      return 'other';
    }

    function fmtRating(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(2) : 'N/A';
    }

    function recentResult(match) {
      const homeScore = Number(match.home_score || 0);
      const awayScore = Number(match.away_score || 0);
      const teamId = String(id || '');
      const homeId = String(match.home_guild_id || '');
      const awayId = String(match.away_guild_id || '');

      if (homeScore === awayScore) return 'D';
      if (teamId && homeId === teamId) return homeScore > awayScore ? 'W' : 'L';
      if (teamId && awayId === teamId) return awayScore > homeScore ? 'W' : 'L';
      return '-';
    }

    function resultBadge(result) {
      const value = String(result || '-').toUpperCase();
      if (value === 'W') return '<span class="form-badge w">W</span>';
      if (value === 'D') return '<span class="form-badge d">D</span>';
      if (value === 'L') return '<span class="form-badge l">L</span>';
      return '<span class="form-badge">-</span>';
    }

    function resultIcon(result) {
      const value = String(result || '').toUpperCase();
      if (value === 'W') return '<img class="form-icon" src="assets/icons/form-w.svg" alt="W">';
      if (value === 'D') return '<img class="form-icon" src="assets/icons/form-d.svg" alt="D">';
      if (value === 'L') return '<img class="form-icon" src="assets/icons/form-l.svg" alt="L">';
      return '<span class="badge">-</span>';
    }

    function formStrip(values) {
      const rows = Array.isArray(values) ? values : [];
      if (!rows.length) return '<span class="meta">No form data</span>';
      return `<span class="form-strip">${rows.map(resultIcon).join('')}</span>`;
    }

    function competitionLabel(match) {
      if (match.tournament_name) return match.tournament_name;
      return '-';
    }

    function teamCell(name, icon, isHome) {
      const fallback = /iosca/i.test(String(name || '')) ? 'assets/icons/iosca-icon.png' : '';
      const finalIcon = String(icon || '').trim() || fallback;
      return `
        <span class="mini-team">
          ${finalIcon ? `<img class="mini-team-logo" src="${esc(finalIcon)}" alt="${esc(name || 'Team')}">` : ''}
          <span class="mini-team-name ${isHome ? 'is-home' : 'is-away'}">${esc(name || 'Team')}</span>
        </span>
      `;
    }

    const groups = {
      gk: { label: 'Goalkeepers', items: [] },
      def: { label: 'Defenders', items: [] },
      mid: { label: 'Midfielders', items: [] },
      att: { label: 'Attackers', items: [] },
      other: { label: 'Other roles', items: [] }
    };

    for (const p of players) {
      groups[posBucket(p.position)].items.push(p);
    }

    for (const key of Object.keys(groups)) {
      groups[key].items.sort((a, b) => {
        const ra = Number(a.rating || 0);
        const rb = Number(b.rating || 0);
        if (rb !== ra) return rb - ra;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
    }

    function playerCard(p, bucket) {
      const pos = String(p.position || 'N/A').toUpperCase();
      const name = esc(p.name || 'Unknown');
      const nameHtml = p.steam_id
        ? `<a href="player.html?steam_id=${encodeURIComponent(p.steam_id)}">${name}</a>`
        : name;

      return `
        <article class="roster-player roster-${bucket}">
          <img class="roster-avatar" src="${esc(p.display_avatar_url || p.steam_avatar_url || p.avatar_url || p.avatar_fallback_url || fallbackAvatar)}" alt="avatar" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
          <div class="roster-info">
            <div class="roster-name">${nameHtml}</div>
            <div class="roster-meta">
              <span class="pos-chip pos-${bucket}">${esc(pos)}</span>
              <span class="rating-chip">Rating ${esc(fmtRating(p.rating))}</span>
            </div>
            <div class="roster-sub">${p.steam_id ? `Steam: ${esc(p.steam_id)}` : 'Steam: N/A'}</div>
          </div>
        </article>
      `;
    }

    page.innerHTML = `
      <div class="grid cols-2">
        <div class="card team-hero-card" style="margin:0;">
          <div class="team-head">
            ${team.guild_icon ? `<img class="team-profile-logo" src="${esc(team.guild_icon)}" alt="team">` : ''}
            <div class="team-details">
              <h2>${esc(team.guild_name)}</h2>
              <div class="team-highlight-grid">
                <div class="team-highlight">
                  <div class="k">Captain</div>
                  <div class="v">${esc(team.captain_name || 'N/A')}</div>
                </div>
                <div class="team-highlight">
                  <div class="k">Average rating</div>
                  <div class="v">${esc(team.average_rating || 0)}</div>
                </div>
              </div>
              <div class="meta" style="margin-top:8px;">Created: ${fmtDateTime(team.created_at)}</div>
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
          <div class="team-summary-widgets">
            <div class="team-summary-widget">
              <div class="k">Last 5</div>
              <div class="v">${formStrip(summary.form_last5 || [])}</div>
            </div>
            <div class="team-summary-widget">
              <div class="k">Win rate</div>
              <div class="v">${esc(Number(summary.win_rate || 0).toFixed(1))}%</div>
            </div>
            <div class="team-summary-widget">
              <div class="k">Avg GF / Match</div>
              <div class="v">${esc(Number(summary.avg_goals_for || 0).toFixed(2))}</div>
            </div>
            <div class="team-summary-widget">
              <div class="k">Avg GA / Match</div>
              <div class="v">${esc(Number(summary.avg_goals_against || 0).toFixed(2))}</div>
            </div>
            <div class="team-summary-widget">
              <div class="k">Clean sheets</div>
              <div class="v">${esc(stats.clean_sheets || 0)}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:10px;">
        <h3>Players by position</h3>
        <div class="roster-groups">
          ${Object.keys(groups).map((key) => {
            const g = groups[key];
            if (!g.items.length) return '';
            return `
              <section class="roster-group roster-group-${key}">
                <header class="roster-group-head">${esc(g.label)} <span class="meta">(${g.items.length})</span></header>
                <div class="roster-grid">
                  ${g.items.map((p) => playerCard(p, key)).join('')}
                </div>
              </section>
            `;
          }).join('') || '<div class="empty">No players listed in team roster.</div>'}
        </div>
      </div>

      <div class="card" style="margin-top:10px;">
        <h3>Recent matches</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width:80px;">Result</th>
                <th>Date</th>
                <th>Tournament</th>
                <th>Match</th>
                <th>Format</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              ${recent.length ? recent.map((m) => {
                const result = m.result || recentResult(m);
                return `
                  <tr>
                    <td>${resultBadge(result)}</td>
                    <td>${fmtDateTime(m.datetime)}</td>
                    <td>${esc(competitionLabel(m))}</td>
                    <td>
                      <a href="match.html?id=${esc(m.id)}" class="mini-match-link">
                        ${teamCell(m.home_team_name, m.home_team_icon, true)}
                        <strong>${esc(m.home_score)} - ${esc(m.away_score)}</strong>
                        ${teamCell(m.away_team_name, m.away_team_icon, false)}
                      </a>
                    </td>
                    <td>${esc(m.game_type || '-')}</td>
                    <td>${m.extratime ? '<span class="badge">ET</span>' : ''} ${m.penalties ? '<span class="badge">PEN</span>' : ''}</td>
                  </tr>
                `;
              }).join('') : '<tr><td colspan="6">No matches yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load team profile: ${err.message}`);
  }
})();
