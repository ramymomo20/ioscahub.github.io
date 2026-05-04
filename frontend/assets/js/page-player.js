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
    const activity = data.activity || {};
    const records = Array.isArray(data.records) ? data.records : [];
    const team = data.team || {};
    const honors = [
      ...(Array.isArray(data.trophies) ? data.trophies : []),
      ...(Array.isArray(data.awards) ? data.awards.map((item) => ({
        trophy_type: item.award_key || item.award_scope || 'award',
        title: item.title,
        subtitle: item.subtitle || item.period_end,
        awarded_at: item.period_end || item.period_start
      })) : [])
    ];
    const careerEvents = Array.isArray(data.career_events) ? data.career_events : [];
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

    function matchesCount() {
      return intNum(summary.matches_played || totals.matches_played);
    }

    function distanceKmText(rawMeters) {
      const km = num(rawMeters) / 1000;
      return `${km.toFixed(km >= 100 ? 1 : 2)} km`;
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
      const matches = matchesCount();
      if (matches <= 0) return '0.0';
      return (num(totals.possession) / matches).toFixed(1);
    }

    function formatActivityDate(isoDate) {
      const raw = String(isoDate || '').slice(0, 10);
      const parts = raw.split('-').map((part) => Number(part));
      if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return raw || 'Unknown date';
      const [year, month, day] = parts;
      const date = new Date(Date.UTC(year, month - 1, day));
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(date);
    }

    function formatActivityLabel(isoDate, count) {
      const total = intNum(count);
      return `${formatActivityDate(isoDate)} - ${total} ${total === 1 ? 'game' : 'games'}`;
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

    function activityHeatmap() {
      const dailyCounts = activity.daily_counts || {};
      const end = new Date();
      end.setHours(0, 0, 0, 0);
      const start = new Date(end);
      start.setDate(start.getDate() - 364);
      const alignedStart = new Date(start);
      alignedStart.setDate(alignedStart.getDate() - alignedStart.getDay());

      const counts = Object.values(dailyCounts).map((value) => intNum(value));
      const maxCount = counts.length ? Math.max(...counts) : 0;
      const cells = [];
      const defaultReadout = counts.length
        ? 'Hover a day to see when this player was active.'
        : 'No activity logged yet.';

      for (const cursor = new Date(alignedStart); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        const iso = cursor.toISOString().slice(0, 10);
        const count = intNum(dailyCounts[iso] || 0);
        const inRange = cursor >= start;
        let level = 0;
        if (count > 0 && maxCount > 0) {
          const ratio = count / maxCount;
          level = ratio >= 0.85 ? 4 : ratio >= 0.55 ? 3 : ratio >= 0.25 ? 2 : 1;
        }
        if (!inRange) {
          cells.push('<span class="activity-cell is-pad" aria-hidden="true"></span>');
          continue;
        }
        const label = formatActivityLabel(iso, count);
        cells.push(
          `<button type="button" class="activity-cell level-${level}" data-activity-label="${esc(label)}" title="${esc(label)}" aria-label="${esc(label)}"></button>`
        );
      }

      return `
        <div class="player-activity-panel">
          <div class="player-activity-meta">
            <span><strong>${esc(intNum(activity.active_days || 0))}</strong> active days</span>
            <span><strong>${esc(matchesCount())}</strong> matches</span>
          </div>
          <div class="activity-grid-wrap">
            <div class="activity-grid">${cells.join('')}</div>
          </div>
          <div class="activity-hover-readout" data-default="${esc(defaultReadout)}">${esc(defaultReadout)}</div>
          <div class="activity-legend">
            <span>Less</span>
            <span class="activity-cell level-0"></span>
            <span class="activity-cell level-1"></span>
            <span class="activity-cell level-2"></span>
            <span class="activity-cell level-3"></span>
            <span class="activity-cell level-4"></span>
            <span>More</span>
          </div>
        </div>
      `;
    }

    function recordsScroller() {
      if (!records.length) {
        return '<div class="meta">No personal records available yet.</div>';
      }
      return `
        <div class="player-records-row">
          ${records.map((record) => `
            <article class="player-record-card">
              <div class="record-label">${esc(record.label || record.key || 'Record')}</div>
              <div class="record-value">${esc(intNum(record.value))}</div>
              <div class="record-match">
                <a href="match.html?id=${esc(record.match_id || record.match_stats_id || '')}">
                  ${esc(record.home_team_name || 'Home')} ${esc(record.home_score ?? 0)} - ${esc(record.away_score ?? 0)} ${esc(record.away_team_name || 'Away')}
                </a>
              </div>
              <div class="record-meta">
                <span>${esc(record.is_tournament ? `Tournament${record.tournament_name ? `: ${record.tournament_name}` : ''}` : 'Official Mix')}</span>
                <span>${esc(fmtDateTime(record.datetime))}</span>
              </div>
            </article>
          `).join('')}
        </div>
      `;
    }

    function v2Stat(label, value) {
      return `<div class="v2-stat-tile"><span class="v2-label">${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    }

    function v2AttributeList(attrs) {
      const rows = Object.entries(attrs || {});
      if (!rows.length) return '<div class="meta">No attribute data yet.</div>';
      return `
        <div class="v2-attribute-list">
          ${rows.map(([key, value]) => `
            <div class="v2-attribute">
              <span class="v2-label">${esc(key)}</span>
              <span class="v2-bar"><span style="width:${esc(Math.max(0, Math.min(100, Number(value) || 0)))}%"></span></span>
              <strong>${esc(value)}</strong>
            </div>
          `).join('')}
        </div>
      `;
    }

    function v2Trend(items) {
      const rows = Array.isArray(items) ? items : [];
      if (!rows.length) return '<div class="meta">No trend data yet.</div>';
      return `
        <div class="v2-trend">
          ${rows.map((item) => {
            const rating = Number(item.rating || 0);
            const height = Math.max(18, Math.min(100, rating * 10));
            return `<span class="v2-trend-bar" title="${esc(item.opponent || 'Opponent')} - ${esc(rating ? rating.toFixed(1) : 'N/A')}" style="height:${esc(height)}%;"></span>`;
          }).join('')}
        </div>
      `;
    }

    function v2RecentMatchCards(matches) {
      const rows = Array.isArray(matches) ? matches : [];
      if (!rows.length) return '<div class="meta">No recent matches.</div>';
      return `
        <div class="v2-match-card-list">
          ${rows.slice(0, 8).map((m) => {
            const result = String(m.result || '-').toLowerCase();
            return `
              <article class="v2-match-card">
                <span class="v2-result ${esc(result)}">${esc(String(m.result || '-').toUpperCase())}</span>
                <div>
                  <strong><a href="match.html?id=${esc(m.match_id)}">${esc(m.home_team_name)} ${esc(m.home_score)} - ${esc(m.away_score)} ${esc(m.away_team_name)}</a></strong>
                  <div class="v2-subtitle">${esc(fmtDateTime(m.datetime))} | ${esc(m.position || 'N/A')} | ${esc(competitionLabel(m))}</div>
                </div>
                <div class="v2-label">R ${esc(m.match_rating ? Number(m.match_rating).toFixed(1) : 'N/A')} | G ${esc(m.goals || 0)} | A ${esc(m.assists || 0)}</div>
              </article>
            `;
          }).join('')}
        </div>
      `;
    }

    function v2Honors(items) {
      const rows = Array.isArray(items) ? items : [];
      if (!rows.length) return '<div class="meta">No honors recorded yet.</div>';
      return `
        <div class="v2-trophy-row">
          ${rows.map((item) => `
            <article class="v2-trophy">
              <div class="v2-label">${esc(item.trophy_type || item.award_key || 'Honor')}</div>
              <strong>${esc(item.title || 'Honor')}</strong>
              <div class="v2-subtitle">${esc(item.subtitle || fmtDateTime(item.awarded_at))}</div>
            </article>
          `).join('')}
        </div>
      `;
    }

    function v2Timeline(items) {
      const rows = Array.isArray(items) ? items : [];
      if (!rows.length) return '<div class="meta">No career events recorded yet.</div>';
      return `
        <div class="v2-mini-card-list">
          ${rows.slice(0, 10).map((item) => `
            <div class="v2-mini-card">
              <span class="v2-label">${esc(item.event_type || 'event')}</span>
              <strong>${esc(item.title || 'Career Event')}</strong>
              <div class="v2-subtitle">${esc(item.details || fmtDateTime(item.event_at))}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    const trendRatings = (data.form_trend || [])
      .map((item) => Number(item.rating))
      .filter((value) => Number.isFinite(value));
    const avgRecentRating = trendRatings.length
      ? (trendRatings.reduce((sum, value) => sum + value, 0) / trendRatings.length).toFixed(1)
      : 'N/A';

    page.innerHTML = `
      <div class="hub-v2">
        <section class="v2-card tier-a">
          <div class="v2-hero">
            <div class="v2-avatar-ring">
              <img src="${esc(p.display_avatar_url || p.steam_avatar_url || p.avatar_url || p.avatar_fallback_url || fallbackAvatar)}" alt="avatar" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
            </div>
            <div>
              <div class="v2-kicker">Player Universe</div>
              <h2 class="v2-display">${esc(p.discord_name || p.steam_name || 'Unknown')}</h2>
              <div class="v2-badge-row">
                <span class="v2-chip">${esc(p.position || 'N/A')}</span>
                <span class="v2-chip">${esc(data.signature_role || 'Signature Role Pending')}</span>
                ${team.guild_id ? `<a class="v2-chip" href="team.html?id=${esc(team.guild_id)}"><img src="${esc(team.guild_icon || teamLogoFallback)}" alt="">${esc(team.guild_name || 'Team')}</a>` : '<span class="v2-chip">Free Agent</span>'}
                ${p.steam_profile_url ? `<a class="v2-chip" target="_blank" rel="noreferrer" href="${esc(p.steam_profile_url)}">Steam Profile</a>` : ''}
              </div>
              <p class="v2-subtitle">Registered ${esc(fmtDateTime(p.registered_at))}. Last active ${esc(fmtDateTime(p.last_active))}.</p>
              ${rolesSection()}
            </div>
            <div>
              <div class="v2-rating"><strong>${esc(fmtRating(p.rating))}</strong><span>Rating</span></div>
              <div class="v2-snapshot" style="margin-top:16px;">
                ${v2Stat('Avg Rating', avgRecentRating)}
                ${v2Stat('Win Rate', `${Number(summary.win_rate || 0).toFixed(1)}%`)}
                ${v2Stat('Goals', totalInt(['goals']))}
                ${v2Stat('Assists', totalInt(['assists']))}
                ${v2Stat('MOTM', recent.filter((m) => m.is_match_mvp).length)}
              </div>
            </div>
          </div>
        </section>

        <section class="v2-grid two">
          <article class="v2-card tier-b">
            <div class="v2-section-head"><div><span class="v2-kicker">FIFA Attribute Card</span><h3>Core Profile</h3></div></div>
            ${v2AttributeList(data.attributes || {})}
          </article>
          <article class="v2-card tier-b">
            <div class="v2-section-head"><div><span class="v2-kicker">Last 10</span><h3>Form Trend</h3></div></div>
            ${v2Trend(data.form_trend || [])}
          </article>
        </section>

        <section class="v2-grid three">
          <article class="v2-card tier-c">
            <div class="v2-section-head"><div><span class="v2-kicker">Heat</span><h3>Streaks</h3></div></div>
            <div class="v2-mini-card-list">
              ${(data.streaks || []).length ? data.streaks.map((s) => `<div class="v2-mini-card"><span class="v2-label">${esc(s.label)}</span><strong>${esc(s.value)} ${esc(s.unit || '')}</strong></div>`).join('') : '<div class="meta">No active streak yet.</div>'}
            </div>
          </article>
          <article class="v2-card tier-c">
            <div class="v2-section-head"><div><span class="v2-kicker">Rival Victim</span><h3>Favorite Opponent</h3></div></div>
            ${data.rival_victim ? `<div class="v2-mini-card"><span class="v2-label">${esc(data.rival_victim.team_name)}</span><strong>${esc(data.rival_victim.goals)} goals</strong><div class="v2-subtitle">${esc(data.rival_victim.assists)} assists in ${esc(data.rival_victim.matches)} matches</div></div>` : '<div class="meta">No opponent trend yet.</div>'}
          </article>
          <article class="v2-card tier-c">
            <div class="v2-section-head"><div><span class="v2-kicker">Cabinet</span><h3>Honors</h3></div></div>
            ${v2Honors(honors)}
          </article>
        </section>

        <section class="v2-card tier-b">
          <div class="v2-section-head"><div><span class="v2-kicker">Recent Match Cards</span><h3>Match Log</h3></div></div>
          ${v2RecentMatchCards(recent)}
        </section>

        <section class="v2-grid three">
          <article class="v2-card tier-c">
            <div class="v2-section-head"><div><span class="v2-kicker">Activity</span><h3>365-Day Heat</h3></div></div>
            ${activityHeatmap()}
          </article>
          <article class="v2-card tier-c">
            <div class="v2-section-head"><div><span class="v2-kicker">Personal Records</span><h3>Bests</h3></div></div>
            ${recordsScroller()}
          </article>
          <article class="v2-card tier-c">
            <div class="v2-section-head"><div><span class="v2-kicker">Career</span><h3>Timeline</h3></div></div>
            ${v2Timeline(careerEvents)}
          </article>
        </section>
      </div>
    `;

    const activityReadout = page.querySelector('.activity-hover-readout');
    const activityCells = page.querySelectorAll('.activity-cell[data-activity-label]');
    if (activityReadout && activityCells.length) {
      const defaultReadout = activityReadout.getAttribute('data-default') || activityReadout.textContent || '';
      const setReadout = (text) => {
        activityReadout.textContent = text;
      };
      activityCells.forEach((cell) => {
        const label = cell.getAttribute('data-activity-label') || defaultReadout;
        cell.addEventListener('mouseenter', () => setReadout(label));
        cell.addEventListener('focus', () => setReadout(label));
        cell.addEventListener('mouseleave', () => setReadout(defaultReadout));
        cell.addEventListener('blur', () => setReadout(defaultReadout));
      });
    }
  } catch (err) {
    showError(`Failed to load player profile: ${err.message}`);
  }
})();
