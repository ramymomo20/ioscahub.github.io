(async function () {
  const { renderLayout, byId, esc, fmtDate, showError } = window.HubUI;
  renderLayout('players.html', 'Players');
  const page = byId('page');

  try {
    const data = await window.HubApi.players(1000);
    const players = data.players || [];
    const fallbackAvatar = 'https://cdn.discordapp.com/embed/avatars/0.png';

    function fmtRating(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(2) : 'N/A';
    }

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
                    <img class="avatar" src="${esc(p.display_avatar_url || p.steam_avatar_url || p.avatar_url || p.avatar_fallback_url || fallbackAvatar)}" alt="avatar" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
                    <a href="player.html?steam_id=${encodeURIComponent(p.steam_id)}">${esc(p.discord_name || p.steam_name || 'Unknown')}</a>
                  </span>
                </td>
                <td>${esc(p.position)}</td>
                <td>${esc(fmtRating(p.rating))}</td>
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
