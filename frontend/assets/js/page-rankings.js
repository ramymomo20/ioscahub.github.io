(async function () {
  const { renderLayout, byId, esc, showError } = window.HubUI;
  renderLayout('rankings.html', 'Rankings');
  const page = byId('page');

  try {
    const data = await window.HubApi.rankings(500);
    const widgets = data.widgets || {};
    const players = data.players || [];

    function widgetCard(label, item) {
      if (!item) return `<div class="stat"><div class="label">${esc(label)}</div><div class="value">N/A</div></div>`;
      return `
        <div class="stat">
          <div class="label">${esc(label)}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <img class="avatar" src="${esc(item.avatar_url)}" alt="avatar">
            <div>
              <div><a href="player.html?steam_id=${encodeURIComponent(item.steam_id)}">${esc(item.discord_name)}</a></div>
              <div class="meta">${esc(item.position)} | Rating ${esc(item.rating)}</div>
            </div>
          </div>
        </div>
      `;
    }

    page.innerHTML = `
      <div class="grid cols-4">
        ${widgetCard('Best Goalkeeper', widgets.best_goalkeeper)}
        ${widgetCard('Best Defender', widgets.best_defender)}
        ${widgetCard('Best Midfielder', widgets.best_midfielder)}
        ${widgetCard('Best Attacker', widgets.best_attacker)}
      </div>
      <div class="table-wrap" style="margin-top:10px;">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Player</th><th>Position</th><th>Rating</th>
            </tr>
          </thead>
          <tbody>
            ${players.map((p, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>
                  <span class="cell-inline">
                    <img class="avatar" src="${esc(p.avatar_url)}" alt="avatar">
                    <a href="player.html?steam_id=${encodeURIComponent(p.steam_id)}">${esc(p.discord_name)}</a>
                  </span>
                </td>
                <td>${esc(p.position)}</td>
                <td>${esc(p.rating)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load rankings: ${err.message}`);
  }
})();
