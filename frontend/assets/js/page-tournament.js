(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout("tournament.html", "Tournament detail", {
    layout: "standard",
    eyebrow: "League Hub",
  });
  const page = byId("page");

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) {
    showError("Missing tournament id in URL.");
    return;
  }

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
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

  function normalizeLeagueKey(value) {
    return String(value || "").trim().toUpperCase() === "B" ? "B" : "A";
  }

  function leagueLabel(value) {
    return `League ${normalizeLeagueKey(value)}`;
  }

  function formDot(result) {
    const key = String(result || "").toUpperCase();
    if (!["W", "D", "L"].includes(key)) return "";
    return `<span class="v2-form-dot ${esc(key.toLowerCase())}">${esc(key)}</span>`;
  }

  function renderForm(teamForms, guildId) {
    const form = teamForms[String(guildId)] || [];
    if (!Array.isArray(form) || !form.length) return '<span class="v2-subtitle">No form</span>';
    return `<span class="v2-form-line">${form.map(formDot).join("")}</span>`;
  }

  function leaderCard(title, rows, unitLabel) {
    const list = Array.isArray(rows) ? rows.slice(0, 5) : [];
    return `
      <article class="v2-card tier-c">
        <div class="v2-kicker">${esc(title)}</div>
        <div class="v2-mini-card-list">
          ${list.length ? list.map((row, idx) => `
            <div class="v2-mini-card">
              <span class="v2-rank">${idx + 1}</span>
              <span>
                <strong>${playerLink(row)}</strong>
                <span class="v2-subtitle">${esc(fmtTotal(row.total))}${unitLabel ? ` ${esc(unitLabel)}` : ""}</span>
              </span>
            </div>
          `).join("") : '<div class="v2-mini-card">No data yet.</div>'}
        </div>
      </article>
    `;
  }

  function leagueLeaderGrid(league) {
    const leaders = league && league.leaders || {};
    return `
      <section class="v2-grid three">
        ${leaderCard(`${league.league_name || leagueLabel(league.league_key)} Top Scorers`, leaders.goals, "goals")}
        ${leaderCard(`${league.league_name || leagueLabel(league.league_key)} Top Assists`, leaders.assists, "assists")}
        ${leaderCard(`${league.league_name || leagueLabel(league.league_key)} Most MVPs`, leaders.mvps, "MVP")}
      </section>
      <section class="v2-grid three">
        ${leaderCard(`${league.league_name || leagueLabel(league.league_key)} Most Passes`, leaders.passes, "passes")}
        ${leaderCard(`${league.league_name || leagueLabel(league.league_key)} Best Defenders`, leaders.defenders, "actions")}
        ${leaderCard(`${league.league_name || leagueLabel(league.league_key)} Best Goalkeepers`, leaders.goalkeepers, "saves")}
      </section>
    `;
  }

  function standingTable(league, teamForms) {
    const standings = Array.isArray(league.standings) ? league.standings : [];
    if (!standings.length) {
      return '<div class="v2-mini-card">No standings yet.</div>';
    }
    return `
      <div class="v2-table-shell">
        ${standings.map((row, index) => `
          <a class="v2-standing-row table ${index === 0 ? "is-leader" : index >= Math.max(standings.length - 2, 1) ? "is-danger" : ""}" href="team.html?id=${encodeURIComponent(row.guild_id || "")}">
            <span class="v2-standing-rank">${index + 1}</span>
            <span class="v2-standing-team">
              ${row.team_icon ? `<img src="${esc(row.team_icon)}" alt="${esc(row.team_name || "Team")}">` : ""}
              <strong>${esc(row.team_name || "Unknown Team")}</strong>
            </span>
            <span class="v2-standing-meta">${renderForm(teamForms, row.guild_id)}</span>
            <span class="v2-standing-meta">${esc(String(row.matches_played || 0))} MP</span>
            <span class="v2-standing-meta">${esc(String(row.goal_diff || 0))} GD</span>
            <span class="v2-standing-points">${esc(String(row.points || 0))}</span>
          </a>
        `).join("")}
      </div>
    `;
  }

  function computeHighlights(fixtures, leaders, standings) {
    const played = (fixtures || []).filter((fixture) => fixture.home_score !== null && fixture.home_score !== undefined && fixture.away_score !== null && fixture.away_score !== undefined);
    const biggestWin = played.slice().sort((left, right) => Math.abs(num(right.home_score) - num(right.away_score)) - Math.abs(num(left.home_score) - num(left.away_score)))[0] || null;
    const goalFest = played.slice().sort((left, right) => (num(right.home_score) + num(right.away_score)) - (num(left.home_score) + num(left.away_score)))[0] || null;
    const topMvp = Array.isArray(leaders && leaders.mvps) && leaders.mvps.length ? leaders.mvps[0] : null;
    const topScorer = Array.isArray(leaders && leaders.goals) && leaders.goals.length ? leaders.goals[0] : null;
    const topTeam = Array.isArray(standings) && standings.length ? standings[0] : null;
    return [
      {
        label: "Leader",
        title: topTeam ? String(topTeam.team_name || "Unknown Team") : "Awaiting table",
        detail: topTeam ? `${topTeam.points || 0} pts • ${topTeam.goal_diff || 0} GD` : "No standings yet"
      },
      {
        label: "Biggest Win",
        title: biggestWin ? `${biggestWin.home_team_name || "Home"} ${num(biggestWin.home_score)}-${num(biggestWin.away_score)} ${biggestWin.away_team_name || "Away"}` : "No completed fixture",
        detail: biggestWin ? `${Math.abs(num(biggestWin.home_score) - num(biggestWin.away_score))} goal margin` : "Play matches to unlock"
      },
      {
        label: "Goal Fest",
        title: goalFest ? `${goalFest.home_team_name || "Home"} ${num(goalFest.home_score)}-${num(goalFest.away_score)} ${goalFest.away_team_name || "Away"}` : "No completed fixture",
        detail: goalFest ? `${num(goalFest.home_score) + num(goalFest.away_score)} total goals` : "Play matches to unlock"
      },
      {
        label: "MVP King",
        title: topMvp ? String(topMvp.display_name || topMvp.player_name || "Unknown") : "No MVP leader",
        detail: topMvp ? `${topMvp.total || 0} match MVPs` : "No data yet"
      },
      {
        label: "Golden Boot Race",
        title: topScorer ? String(topScorer.display_name || topScorer.player_name || "Unknown") : "No scorer leader",
        detail: topScorer ? `${topScorer.total || 0} goals` : "No data yet"
      }
    ];
  }

  function highlightCards(items) {
    return items.map((item) => `
      <article class="v2-card tier-b tournament-highlight-card">
        <div class="v2-kicker">${esc(item.label || "Highlight")}</div>
        <h3>${esc(item.title || "Unavailable")}</h3>
        <div class="v2-subtitle">${esc(item.detail || "No detail available.")}</div>
      </article>
    `).join("");
  }

  function fixtureCard(fixture) {
    const hasLinkedMatch = Boolean(fixture.played_match_stats_id);
    const isDraw = Boolean(fixture.is_draw_home || fixture.is_draw_away);
    const isForfeit = Boolean(fixture.is_forfeit);
    const isPlayed = Boolean(fixture.is_played || hasLinkedMatch || isDraw || isForfeit);
    const status = isPlayed ? "Played" : (fixture.is_active ? "Pending" : "Closed");
    const homeScore = num(fixture.home_score);
    const awayScore = num(fixture.away_score);
    const scoreText = isPlayed ? `${homeScore}-${awayScore}` : "TBD";
    return `
      <article class="v2-match-card">
        <span class="v2-result ${isPlayed ? (homeScore > awayScore ? "w" : homeScore < awayScore ? "l" : "d") : "d"}">${esc(String(fixture.week_number || "-"))}</span>
        <span>
          <strong>${esc(fixture.home_team_name || "Home")} vs ${esc(fixture.away_team_name || "Away")}</strong>
          <span class="v2-subtitle">${esc(status)} - ${esc(scoreText)}${fixture.is_forfeit ? " - Forfeit" : ""}</span>
          <span class="v2-subtitle">${fixture.played_at || fixture.match_datetime ? esc(fmtDateTime(fixture.played_at || fixture.match_datetime)) : "Awaiting kickoff"}</span>
        </span>
        <span>${hasLinkedMatch ? `<a class="home-action-btn" href="match.html?id=${encodeURIComponent(fixture.played_match_stats_id)}">Match</a>` : `<span class="v2-chip">${esc(status)}</span>`}</span>
      </article>
    `;
  }

  try {
    const data = await window.HubApi.tournament(id);
    const t = data.tournament || {};
    const standings = Array.isArray(data.standings) ? data.standings : [];
    const fixtures = Array.isArray(data.fixtures) ? data.fixtures : [];
    const teams = Array.isArray(data.teams) ? data.teams : [];
    const teamForms = data.team_forms || {};
    const leaders = data.leaders || {};
    const leagues = Array.isArray(data.leagues) && data.leagues.length
      ? data.leagues
      : [{
          league_key: "A",
          league_name: "League A",
          standings,
          fixtures,
          teams,
        }];

    const playedFixtures = fixtures.filter((fixture) => fixture.is_played || fixture.played_match_stats_id || fixture.is_forfeit);
    const totalGoals = playedFixtures.reduce((sum, fixture) => sum + num(fixture.home_score) + num(fixture.away_score), 0);
    const upcoming = fixtures.filter((fixture) => !fixture.is_played && !fixture.played_match_stats_id).slice(0, 8);
    const highlights = computeHighlights(fixtures, leaders, standings);

    page.innerHTML = `
      <div class="hub-v2">
        <section class="v2-card tier-a">
          <div class="v2-section-head">
            <div>
              <div class="v2-kicker">Competition Hub</div>
              <h3>${esc(t.name || "Tournament")}</h3>
            </div>
            <div class="v2-chip-row">
              <span class="v2-chip">${esc(String(t.status || "Unknown").toUpperCase())}</span>
              <span class="v2-chip">${esc(t.format || "Unknown")}</span>
              <span class="v2-chip">${esc(String(t.league_count || leagues.length || 1))} leagues</span>
            </div>
          </div>
          <div class="v2-grid four">
            <article class="v2-stat-tile"><span class="v2-label">Teams</span><strong>${esc(String(t.num_teams || 0))}</strong></article>
            <article class="v2-stat-tile"><span class="v2-label">Fixtures</span><strong>${esc(String(playedFixtures.length))}/${esc(String(fixtures.length))}</strong></article>
            <article class="v2-stat-tile"><span class="v2-label">Goals</span><strong>${esc(String(totalGoals))}</strong></article>
            <article class="v2-stat-tile"><span class="v2-label">Updated</span><strong>${esc(t.updated_at ? fmtDateTime(t.updated_at) : "N/A")}</strong></article>
          </div>
        </section>

        <section class="v2-grid three">
          ${highlightCards(highlights.slice(0, 3))}
        </section>

        <section class="v2-grid three">
          ${leaderCard("Top Scorers", leaders.goals, "goals")}
          ${leaderCard("Top Assists", leaders.assists, "assists")}
          ${leaderCard("Most MVPs", leaders.mvps, "MVP")}
        </section>

        <section class="v2-grid four">
          ${leaderCard("Most Passes", leaders.passes, "passes")}
          ${highlightCards(highlights.slice(3, 5))}
          ${leaderCard("Best Goalkeepers", leaders.goalkeepers, "saves")}
        </section>

        ${leagues.map((league) => `
          <section class="v2-card tier-a">
            <div class="v2-section-head">
              <div>
                <div class="v2-kicker">League Breakdown</div>
                <h3>${esc(league.league_name || leagueLabel(league.league_key))}</h3>
              </div>
            </div>
            <div class="v2-grid two">
              <article class="v2-card tier-b">
                <div class="v2-section-head">
                  <div>
                    <div class="v2-kicker">${esc(league.league_name || leagueLabel(league.league_key))}</div>
                    <h3>League Table</h3>
                  </div>
                </div>
                ${standingTable(league, teamForms)}
              </article>

              <article class="v2-card tier-b">
                <div class="v2-section-head">
                  <div>
                    <div class="v2-kicker">${esc(league.league_name || leagueLabel(league.league_key))}</div>
                    <h3>Fixture Feed</h3>
                  </div>
                </div>
                <div class="v2-match-card-list">
                  ${(Array.isArray(league.fixtures) ? league.fixtures : []).length
                    ? league.fixtures.slice(0, 10).map(fixtureCard).join("")
                    : '<div class="v2-mini-card">No fixtures available.</div>'}
                </div>
              </article>
            </div>
            ${leagueLeaderGrid(league)}
          </section>
        `).join("")}

        <section class="v2-grid two">
          <article class="v2-card tier-b">
            <div class="v2-section-head">
              <div>
                <div class="v2-kicker">Upcoming</div>
                <h3>Next Fixtures</h3>
              </div>
            </div>
            <div class="v2-match-card-list">
              ${upcoming.length ? upcoming.map(fixtureCard).join("") : '<div class="v2-mini-card">No pending fixtures.</div>'}
            </div>
          </article>

          <article class="v2-card tier-b">
            <div class="v2-section-head">
              <div>
                <div class="v2-kicker">Entrants</div>
                <h3>Teams In Tournament</h3>
              </div>
            </div>
            <div class="v2-mini-card-list">
              ${teams.length ? teams.map((team) => `
                <a class="v2-mini-card" href="team.html?id=${encodeURIComponent(team.guild_id || "")}">
                  <strong>${esc(team.team_name || "Unknown Team")}</strong>
                  <span class="v2-subtitle">Captain: ${esc(team.captain_name || "N/A")}</span>
                  <span class="v2-subtitle">${renderForm(teamForms, team.guild_id)}</span>
                </a>
              `).join("") : '<div class="v2-mini-card">No teams linked.</div>'}
            </div>
          </article>
        </section>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load tournament detail: ${err.message}`);
  }
})();
