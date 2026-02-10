(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout('servers.html', 'Servers');
  const page = byId('page');

  function cleanMap(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return 'N/A';
    return raw.replace(/\s+at:\s+.*$/i, '').trim() || 'N/A';
  }

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
                <td>${esc(cleanMap(s.map_name))}</td>
                <td>${s.connect_link ? `<a href="${esc(s.connect_link)}">Connect</a>` : '-'}</td>
                <td>${fmtDateTime(s.updated_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="footer-note" style="margin-top:10px;">Live status now attempts RCON first, with DB values as fallback.</div>
    `;
  } catch (err) {
    showError(`Failed to load servers: ${err.message}`);
  }
})();
