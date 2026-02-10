(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout('tournaments.html', 'Tournaments');
  const page = byId('page');

  try {
    const data = await window.HubApi.tournaments();
    const rows = data.tournaments || [];

    page.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Status</th><th>Format</th><th>Teams</th><th>Fixtures</th><th>Updated</th></tr></thead>
          <tbody>
            ${rows.map((t) => `
              <tr>
                <td><a href="tournament.html?id=${esc(t.id)}">${esc(t.name)}</a></td>
                <td>${esc(t.status)}</td>
                <td>${esc(t.format)}</td>
                <td>${esc(t.num_teams)}</td>
                <td>${esc(t.fixtures_played || 0)}/${esc(t.fixtures_total || 0)}</td>
                <td>${fmtDateTime(t.updated_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load tournaments: ${err.message}`);
  }
})();
