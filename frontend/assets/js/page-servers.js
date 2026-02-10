(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout('servers.html', 'Servers');
  const page = byId('page');

  try {
    const data = await window.HubApi.servers();
    const rows = data.servers || [];

    page.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Address</th><th>Status</th><th>Players</th><th>Map</th><th>Connect</th><th>Updated</th></tr></thead>
          <tbody>
            ${rows.map((s) => `
              <tr>
                <td>${esc(s.name)}</td>
                <td>${esc(s.address)}</td>
                <td>${s.is_active ? '<span class="badge">Active</span>' : '<span class="badge">Inactive</span>'}</td>
                <td>${esc(s.current_players ?? 'N/A')}</td>
                <td>${esc(s.map_name ?? 'N/A')}</td>
                <td>${s.connect_link ? `<a href="${esc(s.connect_link)}">Connect</a>` : '-'}</td>
                <td>${fmtDateTime(s.updated_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="footer-note" style="margin-top:10px;">Live players/map placeholders are ready. Attach RCON poller to fill them.</div>
    `;
  } catch (err) {
    showError(`Failed to load servers: ${err.message}`);
  }
})();
