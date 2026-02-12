(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout("index.html", "Welcome to the Official Hub of IOSoccer CA.");
  const page = byId("page");

  try {
    const [summary, matches, tournaments] = await Promise.all([
      window.HubApi.summary(),
      window.HubApi.matches(16),
      window.HubApi.tournaments(),
    ]);

    const cards = [
      ["Players", summary.players_total || 0],
      ["Teams", summary.teams_total || 0],
      ["Matches", summary.matches_total || 0],
      ["Active Tournaments", summary.active_tournaments_total || 0],
      ["Active Servers", summary.active_servers_total || 0],
    ];

    const quickActions = [
      ["Rankings", "Top players and position leaders.", "rankings.html", "Open"],
      ["Players", "Player database and profiles.", "players.html", "Open"],
      ["Matches", "Scores, lineups, and details.", "matches.html", "Open"],
      ["Tournaments", "Standings and fixtures.", "tournaments.html", "Open"],
      ["Teams", "Rosters, captains, and trends.", "teams.html", "Open"],
      ["Servers", "Status, map, and connect links.", "servers.html", "Open"],
      ["Discord", "Community links and guides.", "discord.html", "Open"],
    ];

    const recentMatches = (matches.matches || []).slice(0, 10);
    const activeTournaments = (tournaments.tournaments || [])
      .filter((t) => String(t.status || "").toLowerCase() === "active")
      .slice(0, 8);

    function teamCell(name, icon, side) {
      const fallback = /iosca/i.test(String(name || "")) ? "assets/icons/iosca-icon.png" : "";
      const finalIcon = String(icon || "").trim() || fallback;
      return `
        <span class="mini-team">
          ${finalIcon ? `<img class="mini-team-logo" src="${esc(finalIcon)}" alt="${esc(name || "Team")}">` : ""}
          <span class="mini-team-name ${side === "home" ? "is-home" : "is-away"}">${esc(name || "Team")}</span>
        </span>
      `;
    }

    function flags(m) {
      const bits = [];
      if (m.extratime) bits.push('<span class="badge">ET</span>');
      if (m.penalties) bits.push('<span class="badge">PEN</span>');
      return bits.length ? bits.join(" ") : "-";
    }

    page.innerHTML = `
      <div class="home-top-note">Your one-stop destination for all IOSoccer CA data.</div>

      <div class="home-stats-grid">
        ${cards
          .map(
            ([label, value]) => `
              <div class="stat home-stat-card">
                <div class="label">${esc(label)}</div>
                <div class="value">${esc(value)}</div>
              </div>
            `
          )
          .join("")}
      </div>

      <div class="home-action-grid one-row">
        ${quickActions
          .map(
            ([title, desc, href, cta], idx) => `
              <article class="home-action-card tint-${(idx % 7) + 1}">
                <h3>${esc(title)}</h3>
                <p>${esc(desc)}</p>
                <a class="home-action-btn" href="${esc(href)}">${esc(cta)}</a>
              </article>
            `
          )
          .join("")}
      </div>

      <div class="card" style="margin-top:10px;">
        <h2>Recent matches</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Tournament</th><th>Match</th><th>Format</th><th>Flags</th></tr></thead>
            <tbody>
              ${
                recentMatches.length
                  ? recentMatches
                      .map(
                        (m) => `
                    <tr>
                      <td>${fmtDateTime(m.datetime)}</td>
                      <td>${esc(m.tournament_name || "-")}</td>
                      <td>
                        <a href="match.html?id=${esc(m.id)}" class="mini-match-link">
                          ${teamCell(m.home_team_name, m.home_team_icon, "home")}
                          <strong>${esc(m.home_score)} - ${esc(m.away_score)}</strong>
                          ${teamCell(m.away_team_name, m.away_team_icon, "away")}
                        </a>
                      </td>
                      <td>${esc(m.game_type || "-")}</td>
                      <td>${flags(m)}</td>
                    </tr>
                  `
                      )
                      .join("")
                  : '<tr><td colspan="5">No matches yet.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" style="margin-top:10px;">
        <h2>Active tournaments</h2>
        <div class="home-tournament-grid">
          ${
            activeTournaments.length
              ? activeTournaments
                  .map(
                    (t) => `
                  <a class="home-tour-item" href="tournament.html?id=${esc(t.id)}">
                    <strong>${esc(t.name)}</strong>
                    <span>Format: ${esc(t.format || "-")}</span>
                    <span>Fixtures: ${esc(t.fixtures_played || 0)}/${esc(t.fixtures_total || 0)}</span>
                  </a>
                `
                  )
                  .join("")
              : '<div class="empty">No active tournaments.</div>'
          }
        </div>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load dashboard: ${err.message}`);
  }
})();
