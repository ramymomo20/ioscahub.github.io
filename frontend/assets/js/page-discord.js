(async function () {
  const { renderLayout, byId, esc, showError } = window.HubUI;
  renderLayout('discord.html', 'Discord');
  const page = byId('page');

  try {
    const data = await window.HubApi.discord();
    const main = data.main_discord || {};

    page.innerHTML = `
      <div class="grid cols-2">
        <div class="card" style="margin:0;">
          <h3>Community</h3>
          <div class="list">
            <div class="item">Invite: ${data.discord_invite_url ? `<a target="_blank" rel="noreferrer" href="${esc(data.discord_invite_url)}">Join Discord</a>` : '<span class="meta">Not configured</span>'}</div>
            <div class="item">Rules: ${data.discord_rules_url ? `<a target="_blank" rel="noreferrer" href="${esc(data.discord_rules_url)}">View rules</a>` : '<span class="meta">Not configured</span>'}</div>
            <div class="item">Tutorial: ${data.discord_tutorial_url ? `<a target="_blank" rel="noreferrer" href="${esc(data.discord_tutorial_url)}">View tutorial</a>` : '<span class="meta">Not configured</span>'}</div>
          </div>
        </div>
        <div class="card" style="margin:0;">
          <h3>Main Discord config</h3>
          <div class="list">
            <div class="item"><div>Guild</div><div class="meta">${esc(main.guild_name || 'N/A')} (${esc(main.guild_id || 'N/A')})</div></div>
            <div class="item"><div>Results channel</div><div class="meta">${esc(main.results_channel || 'N/A')}</div></div>
            <div class="item"><div>Fixtures channel</div><div class="meta">${esc(JSON.stringify(main.fixtures_channel || []))}</div></div>
            <div class="item"><div>Confirmed channel</div><div class="meta">${esc(JSON.stringify(main.confirmed_channel || []))}</div></div>
            <div class="item"><div>Captains channel</div><div class="meta">${esc(JSON.stringify(main.captains_channel || []))}</div></div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load discord page: ${err.message}`);
  }
})();
