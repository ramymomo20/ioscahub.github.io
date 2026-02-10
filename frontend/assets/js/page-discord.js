(async function () {
  const { renderLayout, byId, esc, showError } = window.HubUI;
  renderLayout('discord.html', 'Discord');
  const page = byId('page');

  try {
    const data = await window.HubApi.discord();

    page.innerHTML = `
      <div class="card" style="margin:0;">
        <h3>Community</h3>
        <div class="list">
          <div class="item">Invite: ${data.discord_invite_url ? `<a target="_blank" rel="noreferrer" href="${esc(data.discord_invite_url)}">Join Discord</a>` : '<span class="meta">Not configured</span>'}</div>
          <div class="item">Rules: ${data.discord_rules_url ? `<a target="_blank" rel="noreferrer" href="${esc(data.discord_rules_url)}">View rules</a>` : '<span class="meta">Not configured</span>'}</div>
          <div class="item">Tutorial: ${data.discord_tutorial_url ? `<a target="_blank" rel="noreferrer" href="${esc(data.discord_tutorial_url)}">View tutorial</a>` : '<span class="meta">Not configured</span>'}</div>
        </div>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load discord page: ${err.message}`);
  }
})();
