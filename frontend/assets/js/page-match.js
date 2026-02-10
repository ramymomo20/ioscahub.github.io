(function () {
  const { renderLayout, byId, esc, fmtDateTime, showError, parseLineupEntries, statIcons } = window.HubUI;
  renderLayout('match.html', 'Match detail');
  const page = byId('page');

  const params = new URLSearchParams(window.location.search);
  const matchId = params.get('id');
  if (!matchId) {
    showError('Missing match id in URL.');
    return;
  }

  function normName(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function computeAwards(allStats) {
    const scored = allStats.map((p) => {
      const goals = Number(p.goals || 0);
      const assists = Number(p.assists || 0);
      const saves = Number(p.keeper_saves || 0);
      const tackles = Number(p.tackles || 0);
      const interceptions = Number(p.interceptions || 0);
      const reds = Number(p.red_cards || 0);
      const score = goals * 1.4 + assists * 1.0 + saves * 0.5 + tackles * 0.3 + interceptions * 0.3 - reds * 1.6;
      return { ...p, _score: score };
    }).sort((a, b) => b._score - a._score);

    const mvp = scored[0] || null;
    const bestDef = scored.find((p) => ['LB', 'RB', 'CB', 'DEF'].includes(String(p.position || '').toUpperCase())) || null;
    const bestGk = scored.find((p) => String(p.position || '').toUpperCase() === 'GK') || null;
    return { mvp, bestDef, bestGk };
  }

  function groupStatsByIdentity(stats) {
    const map = new Map();
    for (const p of stats) {
      const keys = [];
      if (p.steam_id) keys.push(`s:${String(p.steam_id)}`);
      if (p.player_name) keys.push(`n:${normName(p.player_name)}`);
      for (const key of keys) {
        if (!map.has(key)) map.set(key, p);
      }
    }
    return map;
  }

  function lineupHtml(teamName, lineup, statsMap, highlightNames) {
    const rows = [];
    for (const entry of lineup) {
      if (entry.started === false) continue;
      const keyBySteam = entry.steamId ? `s:${String(entry.steamId)}` : '';
      const keyByName = `n:${normName(entry.name)}`;
      const stats = (keyBySteam && statsMap.get(keyBySteam)) || statsMap.get(keyByName) || {};
      const nameNorm = normName(entry.name);
      const isAward = highlightNames.has(nameNorm);
      const reds = Number(stats.red_cards || 0);
      const cls = isAward ? 'plus' : (reds > 0 ? 'minus' : '');
      const prefix = isAward ? '+' : (reds > 0 ? '-' : '');
      rows.push(`
        <div class="lineup-row ${cls}">
          <div>${esc(prefix + entry.pos)}: ${isAward && highlightNames.get(nameNorm) === 'MVP' ? 'T ' : ''}${esc(entry.name)}</div>
          <div>${statIcons(stats)}</div>
        </div>
      `);
    }
    return `
      <div class="lineup-box">
        <h3>${esc(teamName)} lineup</h3>
        ${rows.length ? rows.join('') : '<div class="empty">No lineup data.</div>'}
      </div>
    `;
  }

  function substitutionHtml(subs) {
    if (!Array.isArray(subs) || !subs.length) return '<div class="empty">No substitutions</div>';
    return `
      <div class="list">
        ${subs.map((s, i) => {
          const team = String(s.team || '').toUpperCase() || 'TEAM';
          const outName = s.player_out?.name || 'Unknown';
          const inName = s.player_in?.name || 'Unknown';
          return `<div class="item"><div class="meta">#${i + 1} ${esc(team)}</div><div>${esc(outName)} -> ${esc(inName)}</div></div>`;
        }).join('')}
      </div>
    `;
  }

  function playerTable(rows) {
    if (!rows.length) return '<div class="empty">No player stats.</div>';
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Player</th><th>Pos</th><th>G</th><th>A</th><th>S</th><th>T</th><th>I</th><th>YC</th><th>RC</th></tr></thead>
          <tbody>
            ${rows.map((p) => `
              <tr>
                <td>${esc(p.player_name || p.steam_id)}</td>
                <td>${esc(p.position || '-')}</td>
                <td>${esc(p.goals || 0)}</td>
                <td>${esc(p.assists || 0)}</td>
                <td>${esc(p.keeper_saves || 0)}</td>
                <td>${esc(p.tackles || 0)}</td>
                <td>${esc(p.interceptions || 0)}</td>
                <td>${esc(p.yellow_cards || 0)}</td>
                <td>${esc(p.red_cards || 0)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  (async function init() {
    try {
      const data = await window.HubApi.match(matchId);
      const match = data.match || {};
      const homeStats = data.player_stats?.home || [];
      const awayStats = data.player_stats?.away || [];
      const allStats = [...homeStats, ...awayStats, ...(data.player_stats?.neutral || [])];
      const awards = computeAwards(allStats);
      const highlight = new Map();
      if (awards.mvp?.player_name) highlight.set(normName(awards.mvp.player_name), 'MVP');
      if (awards.bestDef?.player_name) highlight.set(normName(awards.bestDef.player_name), 'DEF');
      if (awards.bestGk?.player_name) highlight.set(normName(awards.bestGk.player_name), 'GK');

      const homeLineup = parseLineupEntries(match.home_lineup || []);
      const awayLineup = parseLineupEntries(match.away_lineup || []);
      const homeStatsMap = groupStatsByIdentity(homeStats);
      const awayStatsMap = groupStatsByIdentity(awayStats);

      page.innerHTML = `
        <div class="hero-score card" style="margin:0;">
          <div class="hero-team">
            ${match.home_team_icon ? `<img class="logo" src="${esc(match.home_team_icon)}" alt="home">` : ''}
            <div>${esc(match.home_team_name)}</div>
          </div>
          <div class="score">${esc(match.home_score)} - ${esc(match.away_score)}</div>
          <div class="hero-team right">
            <div>${esc(match.away_team_name)}</div>
            ${match.away_team_icon ? `<img class="logo" src="${esc(match.away_team_icon)}" alt="away">` : ''}
          </div>
        </div>

        <div class="meta" style="margin-top:8px;">${fmtDateTime(match.datetime)} | ${esc(match.game_type)} ${match.tournament_name ? '| ' + esc(match.tournament_name) : ''}</div>

        <div class="grid cols-3" style="margin-top:10px;">
          <div class="stat"><div class="label">MVP</div><div class="value" style="font-size:1.05rem;">${esc(awards.mvp?.player_name || 'N/A')}</div></div>
          <div class="stat"><div class="label">Best Defender</div><div class="value" style="font-size:1.05rem;">${esc(awards.bestDef?.player_name || 'N/A')}</div></div>
          <div class="stat"><div class="label">Best Goalkeeper</div><div class="value" style="font-size:1.05rem;">${esc(awards.bestGk?.player_name || 'N/A')}</div></div>
        </div>

        <div class="lineup-grid" style="margin-top:10px;">
          ${lineupHtml(match.home_team_name || 'Home', homeLineup, homeStatsMap, highlight)}
          ${lineupHtml(match.away_team_name || 'Away', awayLineup, awayStatsMap, highlight)}
        </div>

        <div class="card" style="margin-top:10px;">
          <h3>Substitutions</h3>
          ${substitutionHtml(match.substitutions || [])}
        </div>

        <div class="grid cols-2" style="margin-top:10px;">
          <div class="card" style="margin:0;">
            <h3>${esc(match.home_team_name)} player stats</h3>
            ${playerTable(homeStats)}
          </div>
          <div class="card" style="margin:0;">
            <h3>${esc(match.away_team_name)} player stats</h3>
            ${playerTable(awayStats)}
          </div>
        </div>
      `;
    } catch (err) {
      showError(`Failed to load match detail: ${err.message}`);
    }
  })();
})();
