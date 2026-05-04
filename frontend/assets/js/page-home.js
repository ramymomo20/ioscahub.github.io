(async function () {
  const { renderLayout, byId, esc, fmtDate, fmtDateTime, showError } = window.HubUI;
  renderLayout("index.html", "Welcome to the IOS Central America Community", {
    eyebrow: "IOSCA Community Hub",
  });

  const page = byId("page");
  const fallbackAvatar = "https://cdn.discordapp.com/embed/avatars/0.png";
  const fallbackLogo = "assets/icons/iosca-icon.png";

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

  function playerName(player) {
    return esc(player.discord_name || player.steam_name || "Unknown");
  }

  function logoFor(value) {
    const logo = String(value || "").trim();
    return esc(logo || fallbackLogo);
  }

  function matchFlags(match) {
    const parts = [];
    if (match.extratime) parts.push('<span class="v2-chip">ET</span>');
    if (match.penalties) parts.push('<span class="v2-chip">PEN</span>');
    return parts.join("");
  }

  function resultTickerItem(match) {
    return `
      <a class="v2-ticker-item" href="match.html?id=${encodeURIComponent(match.id)}">
        <span>${esc(match.home_team_name || "Home")}</span>
        <strong>${esc(`${match.home_score ?? 0} - ${match.away_score ?? 0}`)}</strong>
        <span>${esc(match.away_team_name || "Away")}</span>
      </a>
    `;
  }

  function podiumCard(player, index) {
    if (!player) {
      return `
        <article class="v2-card tier-b v2-podium-card">
          <span class="v2-label">Unavailable</span>
          <strong>No player data</strong>
        </article>
      `;
    }
    const tier = index === 0 ? "gold" : index === 1 ? "silver" : "bronze";
    const name = player.discord_name || player.steam_name || "Unknown";
    return `
      <a class="v2-card tier-b v2-podium-card ${tier}" href="player.html?steam_id=${encodeURIComponent(player.steam_id || "")}">
        <span class="v2-rank">#${index + 1}</span>
        <img src="${avatarFor(player)}" alt="${esc(name)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
        <div>
          <div class="v2-kicker">${esc(player.position || "N/A")}</div>
          <h3>${esc(name)}</h3>
          <div class="v2-subtitle">${esc(fmtRating(player.rating))} rating</div>
        </div>
      </a>
    `;
  }

  function playerRailCard(player, index) {
    if (!player) return "";
    const name = player.discord_name || player.steam_name || "Unknown";
    return `
      <a class="v2-player-pill" href="player.html?steam_id=${encodeURIComponent(player.steam_id || "")}">
        <img src="${avatarFor(player)}" alt="${esc(name)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
        <span>
          <strong>#${index + 4} ${esc(name)}</strong>
          <span class="v2-subtitle">${esc(player.position || "N/A")} - ${esc(fmtRating(player.rating))}</span>
        </span>
      </a>
    `;
  }

  function heroMatch(match) {
    if (!match) {
      return `
        <section class="v2-card tier-a">
          <div class="v2-section-head">
            <div>
              <div class="v2-kicker">Match Of The Feed</div>
              <h3>No Featured Match</h3>
            </div>
          </div>
          <div class="v2-subtitle">No recent match data is available yet.</div>
        </section>
      `;
    }

    return `
      <section class="v2-card tier-a">
        <div class="v2-home-hero">
          <div class="v2-home-hero-copy">
            <div class="v2-kicker">Mercado Bold</div>
            <h1 class="v2-display">EL HUB</h1>
            <p class="v2-subtitle">Matchdays, rivalries, ratings, and tournament pressure across the IOS Central America community.</p>
            <div class="v2-pill-list">
              <a class="home-action-btn" href="matches.html">Explore Matches</a>
              <a class="home-action-btn" href="rankings.html">See Rankings</a>
              <a class="home-action-btn" href="tournaments.html">Browse Tournaments</a>
            </div>
          </div>

          <a class="v2-feature-match" href="match.html?id=${encodeURIComponent(match.id)}">
            <div class="v2-kicker">Featured Match</div>
            <div class="v2-scoreboard">
              <div class="v2-score-team">
                <img src="${logoFor(match.home_team_icon)}" alt="${esc(match.home_team_name || "Home")}">
                <strong>${esc(match.home_team_name || "Home")}</strong>
              </div>
              <div class="v2-match-center">
                <div class="v2-scoreline">${esc(`${match.home_score ?? 0}-${match.away_score ?? 0}`)}</div>
                <div class="v2-chip-row">
                  <span class="v2-chip">${esc(match.tournament_name || "Independent Match")}</span>
                  <span class="v2-chip">${esc(match.game_type || "Unknown")}</span>
                  ${matchFlags(match)}
                </div>
                <div class="v2-subtitle">${esc(fmtDateTime(match.datetime))}</div>
              </div>
              <div class="v2-score-team">
                <img src="${logoFor(match.away_team_icon)}" alt="${esc(match.away_team_name || "Away")}">
                <strong>${esc(match.away_team_name || "Away")}</strong>
              </div>
            </div>
          </a>
        </div>
      </section>
    `;
  }

  function standingRows(standings, teamForms) {
    if (!Array.isArray(standings) || !standings.length) {
      return '<div class="v2-mini-card">No live table available.</div>';
    }
    return standings.slice(0, 6).map((row, index) => `
      <a class="v2-standing-row" href="team.html?id=${encodeURIComponent(row.guild_id || "")}">
        <span class="v2-standing-rank">${index + 1}</span>
        <span class="v2-standing-team">
          ${row.team_icon ? `<img src="${esc(row.team_icon)}" alt="${esc(row.team_name || "Team")}">` : ""}
          <strong>${esc(row.team_name || "Unknown Team")}</strong>
        </span>
        <span class="v2-form-line">${((teamForms && teamForms[String(row.guild_id)]) || []).map((item) => `<span class="v2-form-dot ${esc(String(item || "").toLowerCase())}">${esc(item)}</span>`).join("")}</span>
        <span class="v2-standing-points">${esc(String(row.points || 0))}</span>
      </a>
    `).join("");
  }

  function fixtureRail(fixtures) {
    if (!Array.isArray(fixtures) || !fixtures.length) {
      return '<div class="v2-mini-card">No upcoming fixtures queued.</div>';
    }
    return fixtures.slice(0, 8).map((fixture) => `
      <article class="v2-trophy v2-fixture-stub">
        <span class="v2-label">${esc(fixture.week_label || `Week ${fixture.week_number || ""}`)}</span>
        <strong>${esc(fixture.home_team_name || "Home")} vs ${esc(fixture.away_team_name || "Away")}</strong>
        <span class="v2-subtitle">${fixture.match_datetime ? esc(fmtDateTime(fixture.match_datetime)) : "Awaiting kickoff"}</span>
      </article>
    `).join("");
  }

  function teamRail(teams) {
    if (!teams.length) return '<div class="v2-mini-card">No team rating data available.</div>';
    return teams.map((team, index) => `
      <a class="v2-mini-card v2-team-rank-row" href="team.html?id=${encodeURIComponent(team.id || "")}">
        <span class="v2-rank">${index + 1}</span>
        <span>
          <strong>${esc(team.name)}</strong>
          <span class="v2-subtitle">Average rating</span>
        </span>
        <span class="v2-rating compact"><strong>${esc(fmtRating(team.rating))}</strong><span>RTG</span></span>
      </a>
    `).join("");
  }

  function tournamentCards(rows) {
    if (!rows.length) return '<div class="v2-mini-card">No tournaments are active right now.</div>';
    return rows.map((tournament) => `
      <a class="v2-card tier-b v2-tournament-poster" href="tournament.html?id=${encodeURIComponent(tournament.id)}">
        <div class="v2-kicker">${esc(String(tournament.status || "active").toUpperCase())}</div>
        <h3>${esc(tournament.name || "Tournament")}</h3>
        <div class="v2-chip-row">
          <span class="v2-chip">${esc(tournament.format || "Unknown")}</span>
          <span class="v2-chip">${esc(String(tournament.num_teams || 0))} teams</span>
        </div>
        <div class="v2-subtitle">${esc(String(tournament.fixtures_played || 0))} / ${esc(String(tournament.fixtures_total || 0))} fixtures played</div>
      </a>
    `).join("");
  }

  function serverCards(servers, invite) {
    const serverMarkup = servers.length ? servers.map((server) => `
      <div class="v2-mini-card">
        <span class="v2-label">${esc(server.is_active ? "Online Server" : "Server")}</span>
        <strong>${esc(server.name || "IOS Server")}</strong>
        <span class="v2-subtitle">${server.current_players !== undefined && server.current_players !== null ? `${server.current_players} players connected` : "Player count unavailable"}</span>
        ${server.connect_link ? `<a class="home-action-btn" href="${esc(server.connect_link)}">Connect</a>` : ""}
      </div>
    `).join("") : '<div class="v2-mini-card">Server information is unavailable right now.</div>';

    const discordMarkup = `
      <div class="v2-mini-card">
        <span class="v2-label">Discord</span>
        <strong>Community Lobby</strong>
        <span class="v2-subtitle">Join the community, fixtures, and announcements.</span>
        ${invite ? `<a class="home-action-btn" target="_blank" rel="noreferrer" href="${esc(invite)}">Join Discord</a>` : '<span class="v2-subtitle">Invite unavailable</span>'}
      </div>
    `;

    return serverMarkup + discordMarkup;
  }

  function broadRole(position) {
    const pos = String(position || "").toUpperCase();
    if (["GK"].includes(pos)) return "GK";
    if (["LB", "RB", "CB", "LWB", "RWB", "DEF"].includes(pos)) return "DEF";
    if (["CDM", "CM", "CAM", "LM", "RM", "MID"].includes(pos)) return "MID";
    if (["LW", "RW", "CF", "ST", "ATT"].includes(pos)) return "ATT";
    return "FLEX";
  }

  function pickTeamOfWeek(players) {
    const used = new Set();
    const groups = [
      { line: "ATT", target: 3 },
      { line: "MID", target: 3 },
      { line: "DEF", target: 4 },
      { line: "GK", target: 1 },
    ];

    const lineup = [];
    for (const group of groups) {
      const picks = (players || [])
        .filter((player) => !used.has(String(player.steam_id || "")) && broadRole(player.position) === group.line)
        .slice(0, group.target);
      for (const player of picks) {
        used.add(String(player.steam_id || ""));
        lineup.push({ ...player, line: group.line });
      }
    }

    const teamCount = new Set(lineup.map((player) => String(player.current_team_name || "").trim()).filter(Boolean)).size;
    const mvp = lineup.slice().sort((left, right) => num(right.rating) - num(left.rating))[0] || null;
    return { lineup, teamCount, mvp };
  }

  function teamOfWeekCard(selection) {
    const lineup = selection && Array.isArray(selection.lineup) ? selection.lineup : [];
    if (!lineup.length) {
      return `
        <article class="v2-card tier-b home-totw">
          <div class="v2-section-head">
            <div>
              <div class="v2-kicker">Featured XI</div>
              <h3>Team Of The Week</h3>
            </div>
          </div>
          <div class="v2-mini-card">Not enough ranked players were available to build a featured XI.</div>
        </article>
      `;
    }

    const rows = [
      { label: "Attack", line: "ATT" },
      { label: "Midfield", line: "MID" },
      { label: "Defense", line: "DEF" },
      { label: "Goalkeeper", line: "GK" },
    ];

    return `
      <article class="v2-card tier-b home-totw">
        <div class="v2-section-head">
          <div>
            <div class="v2-kicker">Featured XI</div>
            <h3>Team Of The Week</h3>
          </div>
          <div class="v2-subtitle">4-3-3 shape &middot; ${esc(String(selection.teamCount || 0))} clubs represented</div>
        </div>

        <div class="home-totw-pitch">
          ${rows.map((row) => `
            <div class="home-totw-row">
              <span class="home-totw-label">${esc(row.label)}</span>
              <div class="home-totw-slots">
                ${lineup.filter((player) => player.line === row.line).map((player) => `
                  <a class="home-totw-slot ${selection.mvp && String(selection.mvp.steam_id || "") === String(player.steam_id || "") ? "is-mvp" : ""}" href="player.html?steam_id=${encodeURIComponent(player.steam_id || "")}">
                    <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
                    <strong>${playerName(player)}</strong>
                    <span>${esc(player.position || row.line)} &middot; ${esc(fmtRating(player.rating))}</span>
                  </a>
                `).join("")}
              </div>
            </div>
          `).join("")}
        </div>

        <div class="v2-mini-card">
          <span class="v2-label">MVP Spotlight</span>
          <strong>${selection.mvp ? playerName(selection.mvp) : "Unavailable"}</strong>
          <span class="v2-subtitle">${selection.mvp ? `${esc(selection.mvp.position || "N/A")} &middot; ${esc(fmtRating(selection.mvp.rating))} rating` : "No standout available."}</span>
        </div>
      </article>
    `;
  }

  function hallOfFameCards(players) {
    if (!Array.isArray(players) || !players.length) {
      return '<div class="v2-mini-card">No hall of fame players are available yet.</div>';
    }
    return players.slice(0, 3).map((player, index) => `
      <a class="v2-card tier-b home-legend-card" href="player.html?steam_id=${encodeURIComponent(player.steam_id || "")}">
        <span class="v2-rank">#${index + 1}</span>
        <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
        <div class="v2-kicker">${esc(player.position || "N/A")}</div>
        <h3>${playerName(player)}</h3>
        <div class="v2-subtitle">${esc(teamName(player))}</div>
        <div class="home-legend-meta">
          <span><strong>${esc(String(player.trophy_count || 0))}</strong><span>Trophies</span></span>
          <span><strong>${esc(String(player.award_count || 0))}</strong><span>Awards</span></span>
          <span><strong>${esc(fmtRating(player.rating))}</strong><span>Rating</span></span>
        </div>
      </a>
    `).join("");
  }

  function risingStarsCards(players) {
    if (!Array.isArray(players) || !players.length) {
      return '<div class="v2-mini-card">No rising stars have been identified yet.</div>';
    }
    return players.slice(0, 4).map((player) => `
      <a class="v2-mini-card home-rising-card" href="player.html?steam_id=${encodeURIComponent(player.steam_id || "")}">
        <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
        <span>
          <strong>${playerName(player)}</strong>
          <span class="v2-subtitle">${esc(player.position || "N/A")} &middot; ${esc(String(player.recent5_goals || 0))} goals in last 5</span>
        </span>
        <span class="v2-rating compact"><strong>${esc(fmtRating(player.rating))}</strong><span>RTG</span></span>
      </a>
    `).join("");
  }

  function streakCenter(players, teams) {
    const playerMarkup = Array.isArray(players) && players.length
      ? players.slice(0, 4).map((player) => `
          <a class="v2-mini-card home-streak-row" href="player.html?steam_id=${encodeURIComponent(player.steam_id || "")}">
            <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
            <span>
              <strong>${playerName(player)}</strong>
              <span class="v2-subtitle">${esc(player.position || "N/A")} &middot; ${esc(String(player.current_win_streak || 0))} straight wins</span>
            </span>
          </a>
        `).join("")
      : '<div class="v2-mini-card">No hot players detected.</div>';

    const teamMarkup = Array.isArray(teams) && teams.length
      ? teams.slice(0, 4).map((team) => `
          <a class="v2-mini-card home-streak-row" href="team.html?id=${encodeURIComponent(team.guild_id || "")}">
            ${team.guild_icon ? `<img src="${esc(team.guild_icon)}" alt="${esc(team.guild_name || "Team")}">` : `<img src="${fallbackLogo}" alt="Team">`}
            <span>
              <strong>${esc(team.guild_name || "Unknown Team")}</strong>
              <span class="v2-subtitle">${esc(String(team.current_win_streak || 0))} straight wins &middot; ${esc(String(team.recent5_points || 0))} points in last 5</span>
            </span>
          </a>
        `).join("")
      : '<div class="v2-mini-card">No hot teams detected.</div>';

    return `
      <article class="v2-card tier-b">
        <div class="v2-section-head">
          <div>
            <div class="v2-kicker">Streak Center</div>
            <h3>Who is running hot</h3>
          </div>
        </div>
        <div class="v2-grid two">
          <div class="home-story-stack">
            <div class="v2-label">Players</div>
            ${playerMarkup}
          </div>
          <div class="home-story-stack">
            <div class="v2-label">Teams</div>
            ${teamMarkup}
          </div>
        </div>
      </article>
    `;
  }

  try {
    let homePayload;
    try {
      homePayload = await window.HubStatic.home();
    } catch (_) {
      const [summary, matchesRes, tournamentsRes, rankingsRes, teamsRes] = await Promise.all([
        window.HubApi.summary(),
        window.HubApi.matches(16),
        window.HubApi.tournaments(),
        window.HubApi.rankings(40),
        window.HubApi.teams(),
      ]);
      homePayload = {
        summary,
        matches: matchesRes,
        tournaments: tournamentsRes,
        rankings: rankingsRes,
        teams: teamsRes,
      };
    }

    const summary = homePayload.summary || {};
    const storyboards = summary.storyboards || {};
    const matchesRes = homePayload.matches || {};
    const tournamentsRes = homePayload.tournaments || {};
    const rankingsRes = homePayload.rankings || {};
    const teamsRes = homePayload.teams || {};
    const [serversResult, discordResult] = await Promise.allSettled([
      window.HubApi.servers(),
      window.HubApi.discord(),
    ]);
    const serversData = serversResult.status === "fulfilled" ? serversResult.value : {};
    const discordData = discordResult.status === "fulfilled" ? discordResult.value : {};

    const rankedPlayers = Array.isArray(rankingsRes.players) ? rankingsRes.players : [];
    const players = rankedPlayers.slice(0, 10);
    const totw = pickTeamOfWeek(rankedPlayers);
    const recentMatches = Array.isArray(matchesRes.matches) ? matchesRes.matches.slice(0, 12) : [];
    const tournaments = Array.isArray(tournamentsRes.tournaments) ? tournamentsRes.tournaments : [];
    const activeTournaments = tournaments
      .filter((item) => String(item.status || "").toLowerCase() === "active")
      .slice(0, 4);
    const topTeams = (Array.isArray(teamsRes.teams) ? teamsRes.teams : [])
      .map((team) => ({
        id: team.guild_id,
        name: String(team.guild_name || "Unknown Team").trim() || "Unknown Team",
        rating: Number.isFinite(Number(team.average_rating)) ? Number(team.average_rating) : null,
      }))
      .filter((team) => Number.isFinite(team.rating))
      .sort((left, right) => right.rating - left.rating || left.name.localeCompare(right.name))
      .slice(0, 5);
    const servers = (Array.isArray(serversData.servers) ? serversData.servers : [])
      .slice()
      .sort((left, right) => Number(Boolean(right.is_active)) - Number(Boolean(left.is_active)))
      .slice(0, 2);
    const discordInvite = String(discordData.discord_invite_url || "").trim();
    const featuredTournament = activeTournaments[0] || tournaments[0] || null;

    let featuredTournamentDetail = null;
    if (featuredTournament && featuredTournament.id) {
      try {
        featuredTournamentDetail = await window.HubApi.tournament(featuredTournament.id);
      } catch (_) {
        featuredTournamentDetail = null;
      }
    }

    const standings = featuredTournamentDetail && Array.isArray(featuredTournamentDetail.standings)
      ? featuredTournamentDetail.standings
      : [];
    const featuredForms = featuredTournamentDetail && featuredTournamentDetail.team_forms
      ? featuredTournamentDetail.team_forms
      : {};
    const upcomingFixtures = featuredTournamentDetail && Array.isArray(featuredTournamentDetail.fixtures)
      ? featuredTournamentDetail.fixtures.filter((fixture) => !fixture.is_played && !fixture.played_match_stats_id)
      : [];

    page.innerHTML = `
      <div class="hub-v2">
        ${heroMatch(recentMatches[0])}

        <section class="v2-card tier-c">
          <div class="v2-section-head">
            <div>
              <div class="v2-kicker">Live Feed</div>
              <h3>Results Ticker</h3>
            </div>
          </div>
          <div class="v2-carousel">
            ${recentMatches.length ? recentMatches.map(resultTickerItem).join("") : '<div class="v2-mini-card">No recent results yet.</div>'}
          </div>
        </section>

        <section class="v2-grid four">
          <article class="v2-stat-tile"><span class="v2-label">Players</span><strong>${esc(fmtCount(summary.players_total))}</strong></article>
          <article class="v2-stat-tile"><span class="v2-label">Teams</span><strong>${esc(fmtCount(summary.teams_total))}</strong></article>
          <article class="v2-stat-tile"><span class="v2-label">Matches</span><strong>${esc(fmtCount(summary.matches_total))}</strong></article>
          <article class="v2-stat-tile"><span class="v2-label">Active Tournaments</span><strong>${esc(fmtCount(summary.active_tournaments_total))}</strong></article>
        </section>

        <section class="v2-grid two">
          <article class="v2-card tier-b">
            <div class="v2-section-head">
              <div>
                <div class="v2-kicker">Podium</div>
                <h3>Top 10 Players</h3>
              </div>
            </div>
            <div class="v2-podium-grid">
              ${[0, 1, 2].map((index) => podiumCard(players[index], index)).join("")}
            </div>
            <div class="v2-trophy-row">
              ${players.slice(3, 10).map((player, index) => playerRailCard(player, index)).join("") || '<div class="v2-mini-card">No extended player rankings yet.</div>'}
            </div>
          </article>

          <article class="v2-card tier-b">
            <div class="v2-section-head">
              <div>
                <div class="v2-kicker">Featured Competition</div>
                <h3>${esc(featuredTournament ? featuredTournament.name || "Standings Preview" : "Standings Preview")}</h3>
              </div>
            </div>
            <div class="v2-mini-card-list">
              ${standingRows(standings, featuredForms)}
            </div>
          </article>
        </section>

        <section class="v2-grid three">
          <article class="v2-card tier-b">
            <div class="v2-section-head">
              <div>
                <div class="v2-kicker">Upcoming</div>
                <h3>Fixture Rail</h3>
              </div>
            </div>
            <div class="v2-trophy-row">
              ${fixtureRail(upcomingFixtures)}
            </div>
          </article>

          <article class="v2-card tier-b">
            <div class="v2-section-head">
              <div>
                <div class="v2-kicker">Power Index</div>
                <h3>Highest Rated Clubs</h3>
              </div>
            </div>
            <div class="v2-mini-card-list">
              ${teamRail(topTeams)}
            </div>
          </article>

          <article class="v2-card tier-b">
            <div class="v2-section-head">
              <div>
                <div class="v2-kicker">Community</div>
                <h3>Join The Matchday Loop</h3>
              </div>
            </div>
            <div class="v2-mini-card-list">
              ${serverCards(servers, discordInvite)}
            </div>
          </article>
        </section>

        <section class="v2-grid two">
          ${teamOfWeekCard(totw)}

          <article class="v2-card tier-b">
            <div class="v2-section-head">
              <div>
                <div class="v2-kicker">Archive</div>
                <h3>Latest Scoreboards</h3>
              </div>
            </div>
            <div class="v2-match-card-list">
              ${recentMatches.slice(0, 6).map((match) => `
                <a class="v2-match-card" href="match.html?id=${encodeURIComponent(match.id)}">
                  <span class="v2-result ${match.home_score > match.away_score ? "w" : match.home_score < match.away_score ? "l" : "d"}">${esc(String(match.home_score ?? 0))}</span>
                  <span>
                    <strong>${esc(match.home_team_name || "Home")} vs ${esc(match.away_team_name || "Away")}</strong>
                    <span class="v2-subtitle">${esc(match.tournament_name || "Independent Match")} - ${esc(fmtDate(match.datetime))}</span>
                  </span>
                  <span class="v2-rating compact"><strong>${esc(String(match.away_score ?? 0))}</strong><span>AWY</span></span>
                </a>
              `).join("") || '<div class="v2-mini-card">No recent matches yet.</div>'}
            </div>
          </article>

          <article class="v2-card tier-b">
            <div class="v2-section-head">
              <div>
                <div class="v2-kicker">Competitions</div>
                <h3>Active Tournaments</h3>
              </div>
            </div>
            <div class="v2-grid two">
              ${tournamentCards(activeTournaments)}
            </div>
          </article>
        </section>

        <section class="v2-grid two">
          ${streakCenter(storyboards.streak_center && storyboards.streak_center.players, storyboards.streak_center && storyboards.streak_center.teams)}

          <article class="v2-card tier-b">
            <div class="v2-section-head">
              <div>
                <div class="v2-kicker">Prestige</div>
                <h3>Hall Of Fame</h3>
              </div>
              <a class="home-action-btn" href="hall-of-fame.html">Open Full Table</a>
            </div>
            <div class="v2-grid three">
              ${hallOfFameCards(storyboards.hall_of_fame)}
            </div>
          </article>
        </section>

        <section class="v2-card tier-b">
          <div class="v2-section-head">
            <div>
              <div class="v2-kicker">New Wave</div>
              <h3>Rising Stars</h3>
            </div>
          </div>
          <div class="v2-mini-card-list">
            ${risingStarsCards(storyboards.rising_stars)}
          </div>
        </section>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load dashboard: ${err.message}`);
  }
})();
