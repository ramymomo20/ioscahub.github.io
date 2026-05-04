(async function () {
  const { renderLayout, byId, esc, fmtDate, showError } = window.HubUI;
  renderLayout("rankings.html", "Player Leaderboards", {
    layout: "wide",
    eyebrow: "Prestige And Form"
  });

  const page = byId("page");
  const fallbackAvatar = "https://cdn.discordapp.com/embed/avatars/0.png";

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function fmtRating(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "N/A";
  }

  function fmtCount(value) {
    return num(value).toLocaleString();
  }

  function avatarFor(player) {
    return esc(player.display_avatar_url || player.steam_avatar_url || player.avatar_url || player.avatar_fallback_url || fallbackAvatar);
  }

  function playerName(player) {
    return esc(player.discord_name || player.steam_name || "Unknown");
  }

  function playerLink(player) {
    return `player.html?steam_id=${encodeURIComponent(player.steam_id || "")}`;
  }

  function teamName(player) {
    return esc(player.current_team_name || "Free Agent");
  }

  function broadRole(position) {
    const pos = String(position || "").toUpperCase();
    if (["GK"].includes(pos)) return "GK";
    if (["LB", "RB", "CB", "LWB", "RWB", "DEF"].includes(pos)) return "DEF";
    if (["CDM", "CM", "CAM", "LM", "RM", "MID"].includes(pos)) return "MID";
    if (["LW", "RW", "CF", "ST", "ATT"].includes(pos)) return "ATT";
    return "FLEX";
  }

  function roleLabel(role) {
    if (role === "GK") return "Goalkeepers";
    if (role === "DEF") return "Defenders";
    if (role === "MID") return "Midfielders";
    if (role === "ATT") return "Attackers";
    return "Flex";
  }

  function activityClass(player) {
    const raw = player.last_match_at || player.last_active || player.rating_updated_at;
    if (!raw) return "quiet";
    const diffMs = Date.now() - new Date(raw).getTime();
    const diffDays = diffMs / 86400000;
    if (!Number.isFinite(diffDays)) return "quiet";
    if (diffDays <= 3) return "hot";
    if (diffDays <= 14) return "active";
    if (diffDays <= 35) return "quiet";
    return "cold";
  }

  function activityLabel(player) {
    const cls = activityClass(player);
    if (cls === "hot") return "Hot";
    if (cls === "active") return "Active";
    if (cls === "cold") return "Cooling";
    return "Quiet";
  }

  function mergePlayers(rankingsPlayers, detailedPlayers) {
    const detailMap = new Map((detailedPlayers || []).map((player) => [String(player.steam_id || ""), player]));
    return (rankingsPlayers || []).map((player) => {
      const detail = detailMap.get(String(player.steam_id || "")) || {};
      return { ...detail, ...player, ...detail };
    });
  }

  function groupTopPlayers(players) {
    const buckets = { GK: [], DEF: [], MID: [], ATT: [] };
    for (const player of players) {
      const key = broadRole(player.position);
      if (!buckets[key]) continue;
      if (buckets[key].length < 3) buckets[key].push(player);
    }
    return buckets;
  }

  function topUniqueTeams(players, limit) {
    const seen = new Set();
    const out = [];
    for (const player of players) {
      const team = String(player.current_team_name || "").trim();
      if (!team || seen.has(team.toLowerCase())) continue;
      seen.add(team.toLowerCase());
      out.push(team);
      if (out.length >= limit) break;
    }
    return out;
  }

  function heroCard(player) {
    if (!player) {
      return `
        <section class="v2-card tier-a rankings-hero">
          <div class="rankings-hero-copy">
            <div class="v2-kicker">No Leader</div>
            <h2 class="v2-display">Ranking data is not available yet.</h2>
          </div>
        </section>
      `;
    }

    const representedTeams = topUniqueTeams([player], 1);
    return `
      <section class="v2-card tier-a rankings-hero">
        <div class="rankings-hero-copy">
          <div class="v2-kicker">Current Number One</div>
          <h2 class="v2-display">${playerName(player)}</h2>
          <p class="v2-subtitle">The current top-ranked player in the IOSCA universe. This card should feel like prestige, not just a row in a table.</p>
          <div class="rankings-story-row">
            <span class="rankings-story-chip">${esc(player.position || "N/A")}</span>
            <span class="rankings-story-chip">${teamName(player)}</span>
            <span class="rankings-story-chip">${esc(activityLabel(player))} form</span>
            ${representedTeams.length ? `<span class="rankings-story-chip">${esc(representedTeams[0])}</span>` : ""}
          </div>
          <div class="community-cta-row">
            <a class="home-action-btn" href="${playerLink(player)}">Open Profile</a>
            <a class="home-action-btn" href="players.html">Browse All Players</a>
            <a class="home-action-btn" href="hall-of-fame.html">Hall Of Fame</a>
          </div>
        </div>
        <div class="rankings-spotlight-card">
          <img class="rankings-spotlight-avatar" src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
          <div class="v2-rating">
            <strong>${esc(fmtRating(player.rating))}</strong>
            <span>Rating</span>
          </div>
          <div class="rankings-spotlight-meta">
            <span><strong>Team</strong>${teamName(player)}</span>
            <span><strong>Appearances</strong>${esc(fmtCount(player.total_appearances))}</span>
            <span><strong>Updated</strong>${esc(fmtDate(player.rating_updated_at || player.last_match_at || player.last_active))}</span>
            <span><strong>Status</strong>${esc(activityLabel(player))}</span>
          </div>
        </div>
      </section>
    `;
  }

  function podiumCard(player, rank) {
    if (!player) return "";
    const tier = rank === 1 ? "gold" : rank === 2 ? "silver" : "bronze";
    return `
      <a class="v2-card tier-b rankings-podium-card ${tier}" href="${playerLink(player)}">
        <span class="v2-rank">#${rank}</span>
        <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
        <div class="v2-kicker">${esc(player.position || "N/A")}</div>
        <h3>${playerName(player)}</h3>
        <div class="v2-subtitle">${teamName(player)}</div>
        <div class="v2-rating compact">
          <strong>${esc(fmtRating(player.rating))}</strong>
          <span>RTG</span>
        </div>
      </a>
    `;
  }

  function stripCard(player, rank) {
    if (!player) return "";
    return `
      <a class="v2-mini-card rankings-strip-card" href="${playerLink(player)}">
        <span class="v2-rank">#${rank}</span>
        <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
        <span>
          <strong>${playerName(player)}</strong>
          <span class="v2-subtitle">${esc(player.position || "N/A")} &middot; ${teamName(player)}</span>
        </span>
        <span class="v2-rating compact"><strong>${esc(fmtRating(player.rating))}</strong><span>RTG</span></span>
      </a>
    `;
  }

  function roleBoard(title, players) {
    return `
      <article class="v2-card tier-b rankings-role-board">
        <div class="v2-section-head">
          <div>
            <div class="v2-kicker">${esc(title)}</div>
            <h3>Position Power</h3>
          </div>
        </div>
        <div class="rankings-role-list">
          ${players.length ? players.map((player, index) => stripCard(player, index + 1)).join("") : '<div class="v2-mini-card">No players in this band.</div>'}
        </div>
      </article>
    `;
  }

  function prestigeBand(title, subtitle, players, formatter) {
    return `
      <article class="v2-card tier-b rankings-story-card">
        <div class="v2-section-head">
          <div>
            <div class="v2-kicker">${esc(title)}</div>
            <h3>${esc(subtitle)}</h3>
          </div>
        </div>
        <div class="rankings-story-list">
          ${players.length ? players.map((player, index) => `
            <a class="v2-mini-card rankings-strip-card" href="${playerLink(player)}">
              <span class="v2-rank">#${index + 1}</span>
              <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
              <span>
                <strong>${playerName(player)}</strong>
                <span class="v2-subtitle">${esc(player.position || "N/A")} &middot; ${esc(teamName(player))}</span>
              </span>
              <span class="v2-rating compact"><strong>${esc(formatter(player))}</strong><span>${title === "Hall Of Fame" ? "PRS" : "UP"}</span></span>
            </a>
          `).join("") : '<div class="v2-mini-card">No players matched this cut.</div>'}
        </div>
      </article>
    `;
  }

  function tableRow(player, rank) {
    return `
      <a class="rankings-table-row" href="${playerLink(player)}">
        <span class="rankings-table-rank">#${rank}</span>
        <span class="rankings-table-player">
          <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
          <span>
            <strong>${playerName(player)}</strong>
            <span class="v2-subtitle">${esc(player.position || "N/A")} &middot; ${teamName(player)}</span>
          </span>
        </span>
        <span class="rankings-table-meta">${esc(fmtCount(player.total_appearances))}</span>
        <span class="rankings-table-meta">
          <span class="rankings-activity ${activityClass(player)}">${esc(activityLabel(player))}</span>
        </span>
        <span class="rankings-table-rating">${esc(fmtRating(player.rating))}</span>
      </a>
    `;
  }

  try {
    const [rankingsResult, playersResult, summaryResult] = await Promise.allSettled([
      window.HubApi.rankings(120),
      window.HubApi.players({ limit: 350 }),
      window.HubApi.summary()
    ]);

    let fallbackRankings = null;
    if (rankingsResult.status !== "fulfilled") {
      try {
        fallbackRankings = await window.HubStatic.rankings();
      } catch (_) {
        fallbackRankings = null;
      }
    }

    const rankingsPayload = rankingsResult.status === "fulfilled" ? rankingsResult.value : (fallbackRankings || {});
    const rankingsPlayers = Array.isArray(rankingsPayload.players) ? rankingsPayload.players : [];
    const detailedPlayers = playersResult.status === "fulfilled" && Array.isArray(playersResult.value.players)
      ? playersResult.value.players
      : [];
    const summaryPayload = summaryResult.status === "fulfilled" ? summaryResult.value : {};
    const storyboards = summaryPayload.storyboards || {};
    const players = mergePlayers(rankingsPlayers, detailedPlayers);

    const topThree = players.slice(0, 3);
    const topTen = players.slice(0, 10);
    const elites = players.filter((player) => num(player.rating) >= 90).length;
    const activePlayers = players.filter((player) => activityClass(player) === "hot" || activityClass(player) === "active").length;
    const teamCount = new Set(players.map((player) => String(player.current_team_name || "").trim()).filter(Boolean)).size;
    const grouped = groupTopPlayers(players);
    const hallOfFame = mergePlayers(Array.isArray(storyboards.hall_of_fame) ? storyboards.hall_of_fame : [], detailedPlayers).slice(0, 5);
    const risingStars = mergePlayers(Array.isArray(storyboards.rising_stars) ? storyboards.rising_stars : [], detailedPlayers).slice(0, 5);

    page.innerHTML = `
      <div class="hub-v2 rankings-page">
        ${heroCard(players[0])}

        <section class="v2-grid four">
          <article class="v2-stat-tile"><span class="v2-label">Tracked Players</span><strong>${esc(fmtCount(players.length))}</strong></article>
          <article class="v2-stat-tile"><span class="v2-label">Elite 90+</span><strong>${esc(fmtCount(elites))}</strong></article>
          <article class="v2-stat-tile"><span class="v2-label">In Current Form</span><strong>${esc(fmtCount(activePlayers))}</strong></article>
          <article class="v2-stat-tile"><span class="v2-label">Teams Represented</span><strong>${esc(fmtCount(teamCount))}</strong></article>
        </section>

        <section class="v2-card tier-b">
          <div class="v2-section-head">
            <div>
              <div class="v2-kicker">Podium</div>
              <h3>Top Three Right Now</h3>
            </div>
          </div>
          <div class="rankings-podium-grid">
            ${podiumCard(topThree[1], 2)}
            ${podiumCard(topThree[0], 1)}
            ${podiumCard(topThree[2], 3)}
          </div>
          <div class="rankings-strip-grid">
            ${topTen.slice(3).map((player, index) => stripCard(player, index + 4)).join("")}
          </div>
        </section>

        <section class="v2-grid two">
          ${roleBoard(roleLabel("GK"), grouped.GK)}
          ${roleBoard(roleLabel("DEF"), grouped.DEF)}
          ${roleBoard(roleLabel("MID"), grouped.MID)}
          ${roleBoard(roleLabel("ATT"), grouped.ATT)}
        </section>

        <section class="v2-grid two">
          ${prestigeBand("Rising Stars", "New wave players forcing their way into the spotlight", risingStars, (player) => String(player.rise_score || "0"))}
          ${prestigeBand("Hall Of Fame", "Prestige table built from rating, awards, trophies, and longevity", hallOfFame, (player) => String(player.prestige_score || "0"))}
        </section>

        <section class="v2-card tier-c rankings-table-shell">
          <div class="v2-section-head">
            <div>
              <div class="v2-kicker">Full Table</div>
              <h3>Top 100 Players</h3>
            </div>
          </div>
          <div class="rankings-table-head">
            <span>Rank</span>
            <span>Player</span>
            <span>Apps</span>
            <span>Status</span>
            <span>Rating</span>
          </div>
          <div class="rankings-table-list">
            ${players.length ? players.slice(0, 100).map((player, index) => tableRow(player, index + 1)).join("") : '<div class="v2-mini-card">No ranking data was returned.</div>'}
          </div>
        </section>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load rankings: ${err.message}`);
  }
})();
