(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout('tournament.html', 'Tournament detail');
  const page = byId('page');

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) {
    showError('Missing tournament id in URL.');
    return;
  }

  try {
    const data = await window.HubApi.tournament(id);
    const t = data.tournament || {};
    const standings = data.standings || [];
    const fixtures = data.fixtures || [];
    const teams = data.teams || [];

    page.innerHTML = `
      <div class="grid cols-4">
        <div class="stat"><div class="label">Tournament</div><div class="value" style="font-size:1.2rem;">${esc(t.name || '')}</div></div>
        <div class="stat"><div class="label">Status</div><div class="value" style="font-size:1.2rem;">${esc(t.status || '')}</div></div>
        <div class="stat"><div class="label">Format</div><div class="value" style="font-size:1.2rem;">${esc(t.format || '')}</div></div>
        <div class="stat"><div class="label">Teams</div><div class="value" style="font-size:1.2rem;">${esc(t.num_teams || 0)}</div></div>
      </div>

      <div class="grid cols-2" style="margin-top:10px;">
        <div class="card" style="margin:0;">
          <h3>Standings</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Team</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>PTS</th></tr></thead>
              <tbody>
                ${standings.map((s, idx) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td>
                      <span class="cell-inline">
                        ${s.team_icon ? `<img class="logo" src="${esc(s.team_icon)}" alt="logo">` : ''}
                        <a href="team.html?id=${esc(s.guild_id)}">${esc(s.team_name)}</a>
                      </span>
                    </td>
                    <td>${esc(s.matches_played)}</td>
                    <td>${esc(s.wins)}</td>
                    <td>${esc(s.draws)}</td>
                    <td>${esc(s.losses)}</td>
                    <td>${esc(s.goals_for)}</td>
                    <td>${esc(s.goals_against)}</td>
                    <td>${esc(s.goal_diff)}</td>
                    <td>${esc(s.points)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card" style="margin:0;">
          <h3>Teams in tournament</h3>
          <div class="list">
            ${teams.length ? teams.map((team) => `
              <div class="item">
                <div><a href="team.html?id=${esc(team.guild_id)}">${esc(team.team_name)}</a></div>
                <div class="meta">Captain: ${esc(team.captain_name || 'N/A')}</div>
              </div>
            `).join('') : '<div class="empty">No teams linked.</div>'}
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:10px;">
        <h3>Fixtures</h3>
        <div class="list">
          ${fixtures.length ? fixtures.map((f) => {
            const status = f.is_played ? 'Played' : (f.is_active ? 'Pending' : 'Closed');
            const matchLink = f.played_match_stats_id ? `<a href="match.html?id=${esc(f.played_match_stats_id)}">View match</a>` : '';
            return `
              <div class="item">
                <div><strong>${esc(f.week_label || `Week ${f.week_number || ''}`)}</strong> | ${esc(status)}</div>
                <div>${esc(f.home_team_name)} vs ${esc(f.away_team_name)}</div>
                <div class="meta">${f.played_at ? fmtDateTime(f.played_at) : 'Not played yet'} ${matchLink ? '| ' + matchLink : ''}</div>
              </div>
            `;
          }).join('') : '<div class="empty">No fixtures</div>'}
        </div>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load tournament detail: ${err.message}`);
  }
})();
