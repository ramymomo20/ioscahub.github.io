(async function () {
  const { renderLayout, byId, esc, showError } = window.HubUI;
  renderLayout('rankings.html', 'Rankings');
  const page = byId('page');

  try {
    const data = await window.HubApi.rankings(500);
    const widgets = data.widgets || {};
    const players = data.players || [];
    const fallbackAvatar = 'https://cdn.discordapp.com/embed/avatars/0.png';

    function fmtRating(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(2) : 'N/A';
    }

    function widgetCard(label, item) {
      if (!item) return `<div class="stat"><div class="label">${esc(label)}</div><div class="value">N/A</div></div>`;
      return `
        <div class="stat">
          <div class="label">${esc(label)}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <img class="avatar" src="${esc(item.display_avatar_url || item.steam_avatar_url || item.avatar_url || item.avatar_fallback_url || fallbackAvatar)}" alt="avatar" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
            <div>
              <div><a href="player.html?steam_id=${encodeURIComponent(item.steam_id)}">${esc(item.discord_name || item.steam_name || 'Unknown')}</a></div>
              <div class="meta">${esc(item.position)} | Rating ${esc(fmtRating(item.rating))}</div>
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
                    <img class="avatar" src="${esc(p.display_avatar_url || p.steam_avatar_url || p.avatar_url || p.avatar_fallback_url || fallbackAvatar)}" alt="avatar" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
                    <a href="player.html?steam_id=${encodeURIComponent(p.steam_id)}">${esc(p.discord_name || p.steam_name || 'Unknown')}</a>
                  </span>
                </td>
                <td>${esc(p.position)}</td>
                <td>${esc(fmtRating(p.rating))}</td>
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
