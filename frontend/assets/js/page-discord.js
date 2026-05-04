(async function () {
  const { renderLayout, byId, esc, showError } = window.HubUI;
  renderLayout('discord.html', 'Discord And Community Guide', {
    layout: 'wide',
    eyebrow: 'Community Lobby'
  });

  const page = byId('page');

  function linkCard(label, title, copy, href, external) {
    const target = String(href || '').trim();
    if (!target) {
      return `
        <article class="v2-card tier-b community-guide-card">
          <div class="v2-kicker">${esc(label)}</div>
          <h3>${esc(title)}</h3>
          <p class="v2-subtitle">${esc(copy)}</p>
          <span class="community-muted">Not configured yet</span>
        </article>
      `;
    }
    return `
      <a class="v2-card tier-b community-guide-card community-link-card" ${external ? 'target="_blank" rel="noreferrer"' : ''} href="${esc(target)}">
        <div class="v2-kicker">${esc(label)}</div>
        <h3>${esc(title)}</h3>
        <p class="v2-subtitle">${esc(copy)}</p>
        <span class="community-link-cta">${external ? 'Open link' : 'Open page'}</span>
      </a>
    `;
  }

  try {
    const [discordPayload, summaryPayload, serversPayload] = await Promise.all([
      window.HubApi.discord(),
      window.HubApi.summary().catch(() => ({})),
      window.HubApi.servers().catch(() => ({ servers: [] }))
    ]);

    const inviteUrl = String(discordPayload.discord_invite_url || '').trim();
    const rulesUrl = String(discordPayload.discord_rules_url || '').trim();
    const tutorialUrl = String(discordPayload.discord_tutorial_url || '').trim();
    const servers = Array.isArray(serversPayload.servers) ? serversPayload.servers : [];
    const liveServers = servers.filter((server) => server.live_online).length;
    const activeServers = servers.filter((server) => server.is_active).length;
    const playersTotal = Number(summaryPayload.players_total || 0);
    const teamsTotal = Number(summaryPayload.teams_total || 0);
    const matchesTotal = Number(summaryPayload.matches_total || 0);

    page.innerHTML = `
      <div class="hub-v2 community-page">
        <section class="v2-card tier-a community-hero community-discord-hero">
          <div class="community-hero-copy">
            <div class="v2-kicker">Community Entry Point</div>
            <h2 class="v2-display">The Discord should feel like the front desk to the whole IOSCA world, not a dead utility link.</h2>
            <p class="v2-subtitle">This page now frames the Discord as the central route for onboarding, fixture coordination, rules, and matchday communication.</p>
            <div class="community-cta-row">
              ${inviteUrl ? `<a class="home-action-btn" target="_blank" rel="noreferrer" href="${esc(inviteUrl)}">Join Discord</a>` : ''}
              ${rulesUrl ? `<a class="home-action-btn" target="_blank" rel="noreferrer" href="${esc(rulesUrl)}">Read Rules</a>` : ''}
              ${tutorialUrl ? `<a class="home-action-btn" target="_blank" rel="noreferrer" href="${esc(tutorialUrl)}">View Tutorial</a>` : ''}
            </div>
          </div>
          <div class="v2-grid four community-stat-grid">
            <article class="v2-stat-tile"><span class="v2-label">Registered Players</span><strong>${esc(String(playersTotal))}</strong></article>
            <article class="v2-stat-tile"><span class="v2-label">Tracked Teams</span><strong>${esc(String(teamsTotal))}</strong></article>
            <article class="v2-stat-tile"><span class="v2-label">Matches Logged</span><strong>${esc(String(matchesTotal))}</strong></article>
            <article class="v2-stat-tile"><span class="v2-label">Live Servers</span><strong>${esc(String(liveServers || activeServers))}</strong></article>
          </div>
        </section>

        <section class="v2-grid three">
          ${linkCard('Join', 'Discord Lobby', 'Enter the community hub for announcements, signups, and quick coordination before matches.', inviteUrl, true)}
          ${linkCard('Rules', 'League Rules', 'Keep moderation cleaner by making the rules page one click away from the community lobby.', rulesUrl, true)}
          ${linkCard('Guide', 'Tutorial And Onboarding', 'Direct new players into setup, format expectations, and how to get onto the field fast.', tutorialUrl, true)}
        </section>

        <section class="v2-grid two">
          <article class="v2-card tier-b community-guide-card">
            <div class="v2-kicker">Best Use Of The Discord</div>
            <h3>What should happen there</h3>
            <div class="community-list">
              <div class="community-list-row"><strong>Queues</strong><span>Use Discord as the place where active players see signups, server changes, and kickoff timing.</span></div>
              <div class="community-list-row"><strong>Moderation</strong><span>Rules and moderation links should be reachable without digging through old pinned messages.</span></div>
              <div class="community-list-row"><strong>Story</strong><span>Pair hub links with Discord announcements so players land on standings, match centers, and profile pages immediately.</span></div>
            </div>
          </article>
          <article class="v2-card tier-b community-guide-card">
            <div class="v2-kicker">Recommended Loop</div>
            <h3>How the hub and Discord should work together</h3>
            <div class="community-list">
              <div class="community-list-row"><strong>1</strong><span>Discord announces the fixture or server route.</span></div>
              <div class="community-list-row"><strong>2</strong><span>The hub provides the detail view, standings context, player profiles, and recent form.</span></div>
              <div class="community-list-row"><strong>3</strong><span>After daily refresh, the hub publishes new ratings, honors, and story widgets back into community discussion.</span></div>
            </div>
          </article>
        </section>

        <section class="v2-grid three">
          <a class="v2-mini-card community-link-card" href="servers.html">
            <strong>Server Board</strong>
            <span class="v2-subtitle">Check live lobbies and direct connect links.</span>
          </a>
          <a class="v2-mini-card community-link-card" href="tournaments.html">
            <strong>Tournaments</strong>
            <span class="v2-subtitle">Follow league tables, fixtures, and active competitions.</span>
          </a>
          <a class="v2-mini-card community-link-card" href="rankings.html">
            <strong>Leaderboards</strong>
            <span class="v2-subtitle">Track the players who will dominate the next conversation.</span>
          </a>
        </section>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load discord page: ${err.message}`);
  }
})();
