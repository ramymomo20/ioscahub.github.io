(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout('teams.html', 'Teams');
  const page = byId('page');

  try {
    const data = await window.HubApi.teams();
    const rows = (data.teams || []).filter((t) => String(t.guild_icon || '').trim());

    page.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Team</th><th>Captain</th><th>Players</th><th>Rating</th><th>Updated</th></tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((t) => `
              <tr>
                <td>
                  <span class="cell-inline">
                    ${t.guild_icon ? `<img class="logo" src="${esc(t.guild_icon)}" alt="logo">` : ''}
                    <a href="team.html?id=${esc(t.guild_id)}">${esc(t.guild_name)}</a>
                  </span>
                </td>
                <td>${esc(t.captain_name || 'N/A')}</td>
                <td>${esc(t.player_count || 0)}</td>
                <td>${esc(t.average_rating || 0)}</td>
                <td>${fmtDateTime(t.updated_at)}</td>
              </tr>
            `).join('') : '<tr><td colspan="5">No teams with logos available yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load teams: ${err.message}`);
  }
})();
