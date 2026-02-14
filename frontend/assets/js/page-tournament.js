(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout("tournament.html", "Tournament detail");
  const page = byId("page");

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) {
    showError("Missing tournament id in URL.");
    return;
  }

  function formIcon(result) {
    const key = String(result || "").toUpperCase();
    if (!["W", "D", "L"].includes(key)) return "";
    const iconName = key === "W" ? "form-w.svg" : key === "D" ? "form-d.svg" : "form-l.svg";
    return `<img class="form-icon" src="assets/icons/${iconName}" alt="${key}" title="${key}">`;
  }

  function renderForm(teamForms, guildId) {
    const form = teamForms[String(guildId)] || [];
    if (!Array.isArray(form) || !form.length) {
      return `<span class="meta">No form</span>`;
    }
    return `<span class="form-strip">${form.map(formIcon).join("")}</span>`;
  }

  function fmtTotal(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  function playerLink(row) {
    const steamId = String(row && row.steam_id || "").trim();
    const displayName = String(row && (row.display_name || row.discord_name || row.player_name || row.steam_id) || "Unknown");
    if (!steamId) return esc(displayName);
    return `<a href="player.html?steam_id=${encodeURIComponent(steamId)}">${esc(displayName)}</a>`;
  }

  function leaderCard(title, rows, unitLabel) {
    const list = Array.isArray(rows) ? rows.slice(0, 3) : [];
    const body = list.length
      ? list.map((row, idx) => `
          <div class="leader-row">
            <span class="leader-rank">#${idx + 1}</span>
            <span class="leader-player">${playerLink(row)}</span>
            <span class="leader-total">${esc(fmtTotal(row.total))}${unitLabel ? ` <small>${esc(unitLabel)}</small>` : ""}</span>
          </div>
        `).join("")
      : `<div class="meta">No data yet</div>`;

    return `
      <article class="leader-card">
        <h3>${esc(title)}</h3>
        ${body}
      </article>
    `;
  }

  try {
    const data = await window.HubApi.tournament(id);
    const t = data.tournament || {};
    const standings = data.standings || [];
    const fixtures = data.fixtures || [];
    const teams = data.teams || [];
    const teamForms = data.team_forms || {};
    const leaders = data.leaders || {};

    page.innerHTML = `
      <div class="grid cols-4">
        <div class="stat"><div class="label">Tournament</div><div class="value" style="font-size:1.2rem;">${esc(t.name || "")}</div></div>
        <div class="stat"><div class="label">Status</div><div class="value" style="font-size:1.2rem;">${esc(t.status || "")}</div></div>
        <div class="stat"><div class="label">Format</div><div class="value" style="font-size:1.2rem;">${esc(t.format || "")}</div></div>
        <div class="stat"><div class="label">Teams</div><div class="value" style="font-size:1.2rem;">${esc(t.num_teams || 0)}</div></div>
      </div>

      <div class="leader-grid" style="margin-top:10px;">
        ${leaderCard("Most Goals", leaders.goals, "goals")}
        ${leaderCard("Most Assists", leaders.assists, "contrib")}
        ${leaderCard("Most Completed Passes", leaders.passes, "passes")}
        ${leaderCard("Best Defender", leaders.defenders, "def")}
        ${leaderCard("Best Goalkeeper", leaders.goalkeepers, "saves")}
        ${leaderCard("Most MVPs", leaders.mvps, "MVP")}
      </div>

      <div class="grid tournament-detail-grid" style="margin-top:10px;">
        <div class="card tournament-standings-card" style="margin:0;">
          <h3>Standings</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Team</th><th>Form</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>PTS</th></tr></thead>
              <tbody>
                ${standings.map((s, idx) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td>
                      <span class="cell-inline">
                        ${s.team_icon ? `<img class="logo" src="${esc(s.team_icon)}" alt="logo">` : ""}
                        <a href="team.html?id=${esc(s.guild_id)}">${esc(s.team_name)}</a>
                      </span>
                    </td>
                    <td>${renderForm(teamForms, s.guild_id)}</td>
                    <td>${esc(s.matches_played)}</td>
                    <td>${esc(s.wins)}</td>
                    <td>${esc(s.draws)}</td>
                    <td>${esc(s.losses)}</td>
                    <td>${esc(s.goals_for)}</td>
                    <td>${esc(s.goals_against)}</td>
                    <td>${esc(s.goal_diff)}</td>
                    <td>${esc(s.points)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card tournament-teams-card" style="margin:0;">
          <h3>Teams in tournament</h3>
          <div class="list">
            ${teams.length ? teams.map((team) => `
              <div class="item">
                <div><a href="team.html?id=${esc(team.guild_id)}">${esc(team.team_name)}</a></div>
                <div class="meta">Captain: ${esc(team.captain_name || "N/A")}</div>
                <div class="meta">Last 5: ${renderForm(teamForms, team.guild_id)}</div>
              </div>
            `).join("") : '<div class="empty">No teams linked.</div>'}
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:10px;">
        <h3>Fixtures</h3>
        <div class="list">
          ${fixtures.length ? fixtures.map((f) => {
            const status = f.is_played ? "Played" : (f.is_active ? "Pending" : "Closed");
            const matchLink = f.played_match_stats_id ? `<a href="match.html?id=${esc(f.played_match_stats_id)}">View match</a>` : "";
            return `
              <div class="item">
                <div><strong>${esc(f.week_label || `Week ${f.week_number || ""}`)}</strong> | ${esc(status)}</div>
                <div>${esc(f.home_team_name)} vs ${esc(f.away_team_name)}</div>
                <div class="meta">${f.played_at ? fmtDateTime(f.played_at) : "Not played yet"} ${matchLink ? "| " + matchLink : ""}</div>
              </div>
            `;
          }).join("") : '<div class="empty">No fixtures</div>'}
        </div>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load tournament detail: ${err.message}`);
  }
})();
