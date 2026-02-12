(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout("index.html", "Welcome to the Official Hub of IOSoccer CA.");
  const page = byId("page");

  try {
    const [summary, matches, tournaments] = await Promise.all([
      window.HubApi.summary(),
      window.HubApi.matches(12),
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
      ["Rankings", "See top-rated players and position leaders.", "rankings.html", "Open Rankings"],
      ["Players", "Browse all players and open detailed profiles.", "players.html", "Open Players"],
      ["Matches", "Review scores, lineups, and game details.", "matches.html", "Open Matches"],
      ["Tournaments", "Track standings, fixtures, and played games.", "tournaments.html", "Open Tournaments"],
      ["Teams", "Explore rosters, captains, and form.", "teams.html", "Open Teams"],
      ["Servers", "Check live server status, map, and connect links.", "servers.html", "Open Servers"],
      ["Discord", "Open community links, rules, and tutorials.", "discord.html", "Open Discord"],
    ];

    const recentMatches = (matches.matches || []).slice(0, 8);
    const activeTournaments = (tournaments.tournaments || [])
      .filter((t) => String(t.status || "").toLowerCase() === "active")
      .slice(0, 6);

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

      <div class="grid cols-4">
        ${cards
          .map(
            ([label, value]) => `<div class="stat"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`
          )
          .join("")}
      </div>

      <div class="home-action-grid">
        ${quickActions
          .map(
            ([title, desc, href, cta]) => `
              <article class="home-action-card">
                <h3>${esc(title)}</h3>
                <p>${esc(desc)}</p>
                <a class="home-action-btn" href="${esc(href)}">${esc(cta)}</a>
              </article>
            `
          )
          .join("")}
      </div>

      <div class="grid cols-2" style="margin-top:10px;">
        <div class="card" style="margin:0;">
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
        <div class="card" style="margin:0;">
          <h2>Active tournaments</h2>
          <div class="list">
            ${
              activeTournaments.length
                ? activeTournaments
                    .map(
                      (t) => `
                    <div class="item">
                      <div><a href="tournament.html?id=${esc(t.id)}">${esc(t.name)}</a></div>
                      <div class="meta">Format: ${esc(t.format)} | Fixtures: ${esc(t.fixtures_played)}/${esc(t.fixtures_total)}</div>
                    </div>
                  `
                    )
                    .join("")
                : '<div class="empty">No active tournaments.</div>'
            }
          </div>
        </div>
      </div>

      <div class="card" style="margin:10px 0 0;">
        <h2>Live feed</h2>
        <div id="liveFeed" class="list"><div class="empty">Waiting for websocket events...</div></div>
        <div class="footer-note" style="margin-top:8px;">Send POST /api/webhooks/events to broadcast updates here.</div>
      </div>
    `;

    const feed = byId("liveFeed");
    if (feed) {
      const ws = new WebSocket(window.HUB_CONFIG.WS_URL);
      ws.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          data = { event: "message", payload: event.data };
        }
        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML = `<div class="meta">${fmtDateTime(data.ts || new Date().toISOString())}</div><div>${esc(data.event || "event")}</div>`;
        feed.prepend(row);
        const empty = feed.querySelector(".empty");
        if (empty) empty.remove();
        while (feed.children.length > 12) feed.removeChild(feed.lastChild);
      };
    }
  } catch (err) {
    showError(`Failed to load dashboard: ${err.message}`);
  }
})();
