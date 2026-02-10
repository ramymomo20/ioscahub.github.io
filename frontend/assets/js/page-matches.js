(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout('matches.html', 'Matches');
  const page = byId('page');

  try {
    const data = await window.HubApi.matches(3000);
    const matches = data.matches || [];

    page.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Tournament</th><th>Match</th><th>Format</th><th>Flags</th>
            </tr>
          </thead>
          <tbody>
            ${matches.map((m) => `
              <tr>
                <td>${fmtDateTime(m.datetime)}</td>
                <td>${esc(m.tournament_name || '-')}</td>
                <td>
                  <a href="match.html?id=${esc(m.id)}">${esc(m.home_team_name)} ${esc(m.home_score)} - ${esc(m.away_score)} ${esc(m.away_team_name)}</a>
                </td>
                <td>${esc(m.game_type)}</td>
                <td>${m.extratime ? '<span class="badge">ET</span>' : ''} ${m.penalties ? '<span class="badge">PEN</span>' : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load matches: ${err.message}`);
  }
})();
