(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError, teamThemeStyle } = window.HubUI;
  renderLayout("index.html", "Competition Hub", {
    layout: "wide",
    eyebrow: "IOSCA Community Data",
  });

  const page = byId("page");
  const fallbackLogo = "assets/icons/iosca-icon.png";
  const fallbackAvatar = "https://cdn.discordapp.com/embed/avatars/0.png";

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function fmtRating(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "N/A";
  }

  function teamLogo(name, icon) {
    const src = String(icon || "").trim() || (/iosca/i.test(String(name || "")) ? fallbackLogo : fallbackLogo);
    return `<img src="${esc(src)}" alt="${esc(name || "Team")}" onerror="this.onerror=null;this.src='${fallbackLogo}';">`;
  }

  function playerAvatar(player) {
    return esc(player.display_avatar_url || player.steam_avatar_url || player.avatar_url || player.avatar_fallback_url || fallbackAvatar);
  }

  function matchFlags(match) {
    const flags = [];
    if (match.extratime) flags.push('<span class="badge">ET</span>');
    if (match.penalties) flags.push('<span class="badge">PEN</span>');
    if (match.is_forfeit) flags.push('<span class="badge">FF</span>');
    return flags.join(" ");
  }

  try {
    const [summary, matchesRes, tournamentsRes, rankingsRes, teamsRes] = await Promise.all([
      window.HubApi.summary(),
      window.HubApi.matches(10),
      window.HubApi.tournaments(),
      window.HubApi.rankings(12),
      window.HubApi.teams(),
    ]);

    const summaryCards = [
      ["Players", num(summary.players_total)],
      ["Teams", num(summary.teams_total)],
      ["Matches", num(summary.matches_total)],
      ["Live Tournaments", num(summary.active_tournaments_total)],
    ];

    const recentMatches = Array.isArray(matchesRes.matches) ? matchesRes.matches.slice(0, 6) : [];
    const tournaments = Array.isArray(tournamentsRes.tournaments) ? tournamentsRes.tournaments : [];
    const activeTournaments = tournaments
      .filter((item) => String(item.status || "").toLowerCase() === "active")
      .slice(0, 4);
    const players = Array.isArray(rankingsRes.players) ? rankingsRes.players.slice(0, 5) : [];
    const teams = (Array.isArray(teamsRes.teams) ? teamsRes.teams : [])
      .map((team) => ({
        ...team,
        guildName: String(team.guild_name || "Unknown Team").trim() || "Unknown Team",
        captainName: String(team.captain_name || "N/A").trim() || "N/A",
        playerCount: Math.max(0, Math.round(num(team.player_count))),
        averageRatingValue: Number.isFinite(Number(team.average_rating)) ? Number(team.average_rating) : null,
      }))
      .sort((left, right) => (num(right.averageRatingValue) - num(left.averageRatingValue)) || left.guildName.localeCompare(right.guildName))
      .slice(0, 4);

    page.innerHTML = `
      <section class="home-hero">
        <div class="home-surface">
          <div class="home-kicker">League Control Center</div>
          <h2 class="home-hero-title">Track players, teams, fixtures, and rankings from one place.</h2>
          <p class="home-hero-copy">The hub now leans into a compact sports-data layout: stronger hierarchy, faster scanning, and cleaner transitions between teams, matches, and leaderboards.</p>
          <div class="home-hero-actions">
            <a class="home-action-btn" href="matches.html">Open Match Archive</a>
            <a class="player-browser-action" href="rankings.html">View Leaderboards</a>
            <a class="player-browser-action" href="teams.html">Browse Teams</a>
          </div>
        </div>

        <aside class="home-hero-aside">
          <article class="home-surface">
            <div class="home-kicker">Quick Access</div>
            <div class="home-list">
              <a class="home-list-item" href="players.html">
                <strong>Players</strong>
                <span class="home-panel-copy">Search profiles, ratings, and position data.</span>
              </a>
              <a class="home-list-item" href="teams.html">
                <strong>Teams</strong>
                <span class="home-panel-copy">Color-accent cards, H2H links, and roster context.</span>
              </a>
              <a class="home-list-item" href="h2h.html">
                <strong>Head To Head</strong>
                <span class="home-panel-copy">Compare any two clubs with record and recent meetings.</span>
              </a>
            </div>
          </article>
        </aside>
      </section>

      <section class="home-micro-grid">
        ${summaryCards.map(([label, value]) => `
          <article class="home-stat-card">
            <span class="label">${esc(label)}</span>
            <strong class="value">${esc(String(value))}</strong>
          </article>
        `).join("")}
      </section>

      <section class="home-feed-grid">
        <div class="home-feed-card">
          <div class="home-kicker">Recent Matches</div>
          <h3>Latest results</h3>
          <div class="home-list">
            ${recentMatches.length ? recentMatches.map((match) => `
              <a class="home-match-card" href="match.html?id=${encodeURIComponent(match.id)}">
                <div class="match-summary-row">
                  <strong>${esc(match.home_team_name || "Home")} vs ${esc(match.away_team_name || "Away")}</strong>
                  <span>${esc(`${match.home_score ?? 0} - ${match.away_score ?? 0}`)}</span>
                </div>
                <div class="match-summary-row">
                  <span>${esc(match.tournament_name || "Independent Match")}</span>
                  <span>${esc(match.game_type || "Unknown")}</span>
                </div>
                <div class="match-summary-row">
                  <span>${esc(fmtDateTime(match.datetime))}</span>
                  <span>${matchFlags(match) || '<span class="meta">Standard</span>'}</span>
                </div>
              </a>
            `).join("") : '<div class="empty">No recent matches were returned.</div>'}
          </div>
        </div>

        <div class="home-feed-card">
          <div class="home-kicker">Tournaments</div>
          <h3>Active competitions</h3>
          <div class="home-list">
            ${activeTournaments.length ? activeTournaments.map((tournament) => `
              <a class="home-list-item" href="tournament.html?id=${encodeURIComponent(tournament.id)}">
                <strong>${esc(tournament.name || "Tournament")}</strong>
                <span class="home-panel-copy">${esc(tournament.format || "Unknown format")} &middot; ${esc(String(num(tournament.fixtures_played)))} / ${esc(String(num(tournament.fixtures_total)))} fixtures</span>
              </a>
            `).join("") : '<div class="empty">No active tournaments right now.</div>'}
          </div>
        </div>
      </section>

      <section class="home-leaders-grid">
        <div class="home-feed-card">
          <div class="home-kicker">Top Teams</div>
          <h3>Highest rated clubs</h3>
          <div class="home-list">
            ${teams.length ? teams.map((team) => `
              <a class="home-team-spotlight" href="team.html?id=${encodeURIComponent(team.guild_id)}" style="${esc(teamThemeStyle(team.guild_id || team.guildName))}">
                ${teamLogo(team.guildName, team.guild_icon)}
                <span>
                  <strong>${esc(team.guildName)}</strong>
                  <span class="home-panel-copy">Captain ${esc(team.captainName)} &middot; ${esc(String(team.playerCount))} players</span>
                </span>
                <span class="pill is-accent">${esc(fmtRating(team.averageRatingValue))}</span>
              </a>
            `).join("") : '<div class="empty">No team ratings available yet.</div>'}
          </div>
        </div>

        <div class="home-feed-card">
          <div class="home-kicker">Top Players</div>
          <h3>Current leaderboard</h3>
          <div class="home-list">
            ${players.length ? players.map((player, index) => `
              <a class="leaderboard-row" href="player.html?steam_id=${encodeURIComponent(player.steam_id || "")}">
                <div class="leaderboard-row-rank">
                  <strong>#${index + 1}</strong>
                </div>
                <div class="leaderboard-row-main">
                  <img src="${playerAvatar(player)}" alt="${esc(player.discord_name || player.steam_name || "Player")}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
                  <div>
                    <div class="leaderboard-row-name">${esc(player.discord_name || player.steam_name || "Unknown")}</div>
                    <div class="leaderboard-meta">${esc(player.position || "N/A")}</div>
                  </div>
                </div>
                <div class="leaderboard-kpi">
                  <span>Rating</span>
                  <strong>${esc(fmtRating(player.rating))}</strong>
                </div>
              </a>
            `).join("") : '<div class="empty">Leaderboard data is not available yet.</div>'}
          </div>
        </div>
      </section>
    `;
  } catch (err) {
    showError(`Failed to load dashboard: ${err.message}`);
  }
})();
