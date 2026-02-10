(async function () {
  const { renderLayout, byId, esc, fmtDate, showError } = window.HubUI;
  renderLayout('players.html', 'Players');
  const page = byId('page');

  try {
    const data = await window.HubApi.players(2000);
    const players = data.players || [];

    page.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Player</th><th>Position</th><th>Rating</th><th>Registered</th><th>Last active</th>
            </tr>
          </thead>
          <tbody>
            ${players.map((p) => `
              <tr>
                <td>
                  <span class="cell-inline">
                    <img class="avatar" src="${esc(p.avatar_url)}" alt="avatar">
                    <a href="player.html?steam_id=${encodeURIComponent(p.steam_id)}">${esc(p.discord_name)}</a>
                  </span>
                </td>
                <td>${esc(p.position)}</td>
                <td>${esc(p.rating)}</td>
                <td>${fmtDate(p.registered_at)}</td>
                <td>${fmtDate(p.last_active)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load players: ${err.message}`);
  }
})();
