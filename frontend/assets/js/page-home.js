(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout("index.html", "Welcome to the Official Hub of IOSoccer CA.", {
    eyebrow: "IOSCA Community Hub",
  });

  const page = byId("page");
  const fallbackAvatar = "https://cdn.discordapp.com/embed/avatars/0.png";

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function fmtCount(value) {
    return num(value).toLocaleString();
  }

  function fmtRating(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "N/A";
  }

  function avatarFor(player) {
    return esc(player.display_avatar_url || player.steam_avatar_url || player.avatar_url || player.avatar_fallback_url || fallbackAvatar);
  }

  function matchFlags(match) {
    const parts = [];
    if (match.extratime) parts.push('<span class="badge">ET</span>');
    if (match.penalties) parts.push('<span class="badge">PEN</span>');
    return parts.length ? parts.join(" ") : "-";
  }

  function topPlayerCard(player, index) {
    if (!player) {
      return '<article class="home-player-podium"><div class="empty">No player data</div></article>';
    }
    const medalClass = index === 0 ? "gold" : index === 1 ? "silver" : "bronze";
    return `
      <a class="home-player-podium ${medalClass}" href="player.html?steam_id=${encodeURIComponent(player.steam_id || "")}">
        <span class="home-player-rank">#${index + 1}</span>
        <img src="${avatarFor(player)}" alt="${esc(player.discord_name || player.steam_name || "Player")}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
        <strong>${esc(player.discord_name || player.steam_name || "Unknown")}</strong>
        <span>${esc(player.position || "N/A")}</span>
        <em>${esc(fmtRating(player.rating))}</em>
      </a>
    `;
  }

  try {
    const [summary, matchesRes, tournamentsRes, rankingsRes, teamsRes] = await Promise.all([
      window.HubApi.summary(),
      window.HubApi.matches(12),
      window.HubApi.tournaments(),
      window.HubApi.rankings(8),
      window.HubApi.teams(),
    ]);

    const widgets = [
      ["Players", fmtCount(summary.players_total)],
      ["Teams", fmtCount(summary.teams_total)],
      ["Matches", fmtCount(summary.matches_total)],
      ["Active Tournaments", fmtCount(summary.active_tournaments_total)],
      ["Active Servers", fmtCount(summary.active_servers_total)],
    ];

    const players = Array.isArray(rankingsRes.players) ? rankingsRes.players.slice(0, 3) : [];
    const recentMatches = Array.isArray(matchesRes.matches) ? matchesRes.matches.slice(0, 8) : [];
    const activeTournaments = (Array.isArray(tournamentsRes.tournaments) ? tournamentsRes.tournaments : [])
      .filter((item) => String(item.status || "").toLowerCase() === "active")
      .slice(0, 6);
    const topTeams = (Array.isArray(teamsRes.teams) ? teamsRes.teams : [])
      .map((team) => ({
        id: team.guild_id,
        name: String(team.guild_name || "Unknown Team").trim() || "Unknown Team",
        rating: Number.isFinite(Number(team.average_rating)) ? Number(team.average_rating) : null,
      }))
      .filter((team) => Number.isFinite(team.rating))
      .sort((left, right) => right.rating - left.rating || left.name.localeCompare(right.name))
      .slice(0, 6);

    page.innerHTML = `
      <section class="home-actions-row">
        <a class="home-action-btn" href="rankings.html">View Leaderboards</a>
        <a class="player-browser-action" href="teams.html">Browse Teams</a>
      </section>

      <section class="home-micro-grid compact">
        ${widgets.map(([label, value]) => `
          <article class="home-stat-card">
            <span class="label">${esc(label)}</span>
            <strong class="value">${esc(value)}</strong>
          </article>
        `).join("")}
      </section>

      <section class="home-dashboard-grid">
        <div class="card">
          <div class="home-section-head">
            <h2>Recent Matches</h2>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Tournament</th>
                  <th>Match</th>
                  <th>Format</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                ${recentMatches.length ? recentMatches.map((match) => `
                  <tr>
                    <td>${esc(fmtDateTime(match.datetime))}</td>
                    <td>${esc(match.tournament_name || "-")}</td>
                    <td>
                      <a class="mini-match-link" href="match.html?id=${encodeURIComponent(match.id)}">
                        <span>${esc(match.home_team_name || "Home")}</span>
                        <strong>${esc(`${match.home_score ?? 0} - ${match.away_score ?? 0}`)}</strong>
                        <span>${esc(match.away_team_name || "Away")}</span>
                      </a>
                    </td>
                    <td>${esc(match.game_type || "-")}</td>
                    <td>${matchFlags(match)}</td>
                  </tr>
                `).join("") : '<tr><td colspan="5">No matches yet.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <div class="home-side-stack">
          <div class="card">
            <div class="home-section-head">
              <h2>Top Players</h2>
            </div>
            <div class="home-player-podium-grid">
              ${[0, 1, 2].map((index) => topPlayerCard(players[index], index)).join("")}
            </div>
          </div>

          <div class="card">
            <div class="home-section-head">
              <h2>Highest Rated Clubs</h2>
            </div>
            <div class="home-simple-list">
              ${topTeams.length ? topTeams.map((team, index) => `
                <a class="home-simple-row" href="team.html?id=${encodeURIComponent(team.id || "")}">
                  <span>#${index + 1} ${esc(team.name)}</span>
                  <strong>${esc(fmtRating(team.rating))}</strong>
                </a>
              `).join("") : '<div class="empty">No team ratings available.</div>'}
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="home-section-head">
          <h2>Active Tournaments</h2>
        </div>
        <div class="home-tournament-grid">
          ${activeTournaments.length ? activeTournaments.map((tournament) => `
            <a class="home-tour-item" href="tournament.html?id=${encodeURIComponent(tournament.id)}">
              <strong>${esc(tournament.name || "Tournament")}</strong>
              <span>${esc(tournament.format || "-")}</span>
              <span>${esc(String(num(tournament.fixtures_played)))} / ${esc(String(num(tournament.fixtures_total)))} fixtures</span>
            </a>
          `).join("") : '<div class="empty">No active tournaments.</div>'}
        </div>
      </section>
    `;
  } catch (err) {
    showError(`Failed to load dashboard: ${err.message}`);
  }
})();
