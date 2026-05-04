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
    const honors = [
      ...(Array.isArray(data.trophies) ? data.trophies : []),
      ...(Array.isArray(data.awards) ? data.awards.map((item) => ({
        trophy_type: item.award_key || item.award_scope || 'award',
        title: item.title,
        subtitle: item.subtitle || item.period_end,
        awarded_at: item.period_end || item.period_start
      })) : [])
    ];
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

    function v2Stat(label, value) {
      return `<div class="v2-stat-tile"><span class="v2-label">${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    }

    function v2Form(values) {
      const rows = Array.isArray(values) ? values : [];
      if (!rows.length) return '<span class="meta">No form data</span>';
      return `<div class="v2-form-line">${rows.map((value) => `<span class="v2-form-dot ${esc(String(value).toLowerCase())}">${esc(value)}</span>`).join('')}</div>`;
    }

    function v2PlayerRail(rows) {
      const items = Array.isArray(rows) ? rows : [];
      if (!items.length) return '<div class="meta">No top player data yet.</div>';
      return `
        <div class="v2-carousel">
          ${items.map((item) => {
            const name = item.name || item.discord_name || 'Unknown';
            return `
              <a class="v2-player-pill" href="${item.steam_id ? `player.html?steam_id=${encodeURIComponent(item.steam_id)}` : '#'}">
                <img src="${esc(item.display_avatar_url || item.steam_avatar_url || item.avatar_url || item.avatar_fallback_url || fallbackAvatar)}" alt="" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
                <span><strong>${esc(name)}</strong><span class="v2-subtitle">${esc(item.position || 'N/A')} | ${esc(fmtRating(item.rating))}</span></span>
              </a>
            `;
          }).join('')}
        </div>
      `;
    }

    function v2Strength(rows) {
      const labels = { defense: 'Defense', midfield: 'Midfield', attack: 'Attack', goalkeeping: 'Goalkeeping' };
      return `
        <div class="v2-attribute-list">
          ${Object.keys(labels).map((key) => {
            const value = rows && rows[key] !== undefined && rows[key] !== null ? Number(rows[key]) : 0;
            const width = Math.max(0, Math.min(100, value * 10));
            return `
              <div class="v2-attribute">
                <span class="v2-label">${esc(labels[key])}</span>
                <span class="v2-bar"><span style="width:${esc(width)}%"></span></span>
                <strong>${value ? esc(value.toFixed(2)) : 'N/A'}</strong>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    function v2Honors(items) {
      const rows = Array.isArray(items) ? items : [];
      if (!rows.length) return '<div class="meta">No honors recorded yet.</div>';
      return `<div class="v2-trophy-row">${rows.map((item) => `<article class="v2-trophy"><div class="v2-label">${esc(item.trophy_type || item.award_key || 'Honor')}</div><strong>${esc(item.title || 'Honor')}</strong><div class="v2-subtitle">${esc(item.subtitle || fmtDateTime(item.awarded_at))}</div></article>`).join('')}</div>`;
    }

    function v2RecentCards(matches) {
      const rows = Array.isArray(matches) ? matches : [];
      if (!rows.length) return '<div class="meta">No matches yet.</div>';
      return `
        <div class="v2-match-card-list">
          ${rows.slice(0, 8).map((m) => {
            const result = String(m.result || recentResult(m) || '-').toLowerCase();
            const matchInner = `${esc(m.home_team_name)} ${esc(m.home_score)} - ${esc(m.away_score)} ${esc(m.away_team_name)}`;
            return `
              <article class="v2-match-card">
                <span class="v2-result ${esc(result)}">${esc(result.toUpperCase())}</span>
                <div>
                  ${m.is_forfeit ? `<strong>${matchInner}</strong>` : `<strong><a href="match.html?id=${esc(m.id)}">${matchInner}</a></strong>`}
                  <div class="v2-subtitle">${esc(fmtDateTime(m.datetime))} | ${esc(competitionLabel(m))} | ${esc(m.game_type || '-')}</div>
                </div>
                <div>${m.extratime ? '<span class="v2-chip">ET</span>' : ''}${m.penalties ? '<span class="v2-chip">PEN</span>' : ''}${m.is_forfeit ? '<span class="v2-chip">FORFEIT</span>' : ''}</div>
              </article>
            `;
          }).join('')}
        </div>
      `;
    }

    page.innerHTML = `
      <div class="hub-v2">
        <section class="v2-card tier-a">
          <div class="v2-hero">
            <div class="v2-crest-ring">
              ${team.guild_icon ? `<img src="${esc(team.guild_icon)}" alt="${esc(team.guild_name || 'Team')}">` : '<img src="assets/icons/iosca-icon.png" alt="">'}
            </div>
            <div>
              <div class="v2-kicker">Club Identity</div>
              <h2 class="v2-display">${esc(team.guild_name || 'Unknown Team')}</h2>
              <div class="v2-badge-row">
                <span class="v2-chip">Captain: ${esc(team.captain_name || 'N/A')}</span>
                <span class="v2-chip">${esc(data.team_identity || 'Team Identity Pending')}</span>
                <a class="v2-chip" href="h2h.html?team1=${encodeURIComponent(String(id || ''))}">Compare H2H</a>
              </div>
              <p class="v2-subtitle">Founded ${esc(fmtDateTime(team.created_at))}. ${esc(players.length)} roster members tracked.</p>
            </div>
            <div class="v2-snapshot">
              ${v2Stat('Avg Rating', fmtRating(team.average_rating))}
              ${v2Stat('Win Rate', `${Number(summary.win_rate || 0).toFixed(1)}%`)}
              ${v2Stat('Record', `${stats.wins || 0}-${stats.draws || 0}-${stats.losses || 0}`)}
              ${v2Stat('GF / GA', `${stats.goals_for || 0}/${stats.goals_against || 0}`)}
            </div>
          </div>
        </section>

        <section class="v2-grid two">
          <article class="v2-card tier-b">
            <div class="v2-section-head"><div><span class="v2-kicker">Top Players</span><h3>Squad Leaders</h3></div></div>
            ${v2PlayerRail(data.top_players || [])}
          </article>
          <article class="v2-card tier-b">
            <div class="v2-section-head"><div><span class="v2-kicker">Strength Map</span><h3>By Position</h3></div></div>
            ${v2Strength(data.strength_by_position || {})}
          </article>
        </section>

        <section class="v2-grid three">
          <article class="v2-card tier-c">
            <div class="v2-section-head"><div><span class="v2-kicker">Chemistry</span><h3>Squad Sync</h3></div></div>
            <div class="v2-rating"><strong>${esc(data.chemistry_score || 0)}</strong><span>Chemistry</span></div>
          </article>
          <article class="v2-card tier-c">
            <div class="v2-section-head"><div><span class="v2-kicker">Form</span><h3>Last 20</h3></div></div>
            ${v2Form(summary.form_last20 || summary.form_last5 || [])}
          </article>
          <article class="v2-card tier-c">
            <div class="v2-section-head"><div><span class="v2-kicker">Cabinet</span><h3>Honors</h3></div></div>
            ${v2Honors(honors)}
          </article>
        </section>

        <section class="v2-grid two">
          <article class="v2-card tier-b">
            <div class="v2-section-head"><div><span class="v2-kicker">Rivalries</span><h3>History</h3></div></div>
            <div class="v2-mini-card-list">
              ${(data.rivalries || []).length ? data.rivalries.map((r) => `<div class="v2-mini-card"><span class="v2-label">${esc(r.team_name)}</span><strong>${esc(r.wins)}-${esc(r.draws)}-${esc(r.losses)}</strong><div class="v2-subtitle">${esc(r.matches)} recent meetings</div></div>`).join('') : '<div class="meta">No rivalry data yet.</div>'}
            </div>
          </article>
          <article class="v2-card tier-b">
            <div class="v2-section-head"><div><span class="v2-kicker">Recent Match Cards</span><h3>Form Log</h3></div></div>
            ${v2RecentCards(recent)}
          </article>
        </section>

        <section class="v2-card tier-c">
          <div class="v2-section-head"><div><span class="v2-kicker">Roster</span><h3>Players By Position</h3></div></div>
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
        </section>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load team profile: ${err.message}`);
  }
})();
