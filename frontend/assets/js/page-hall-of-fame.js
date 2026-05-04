(async function () {
  const { renderLayout, byId, esc, fmtDate, showError } = window.HubUI;
  renderLayout("hall-of-fame.html", "Hall Of Fame", {
    layout: "wide",
    eyebrow: "Legacy And Prestige",
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

  function fmtScore(value) {
    return num(value).toFixed(2);
  }

  function avatarFor(player) {
    return esc(player.display_avatar_url || player.steam_avatar_url || player.avatar_url || player.avatar_fallback_url || fallbackAvatar);
  }

  function playerName(player) {
    return esc(player.discord_name || player.steam_name || player.player_name || "Unknown");
  }

  function teamName(player) {
    return esc(player.current_team_name || "Legacy Pool");
  }

  function playerLink(player) {
    return `player.html?steam_id=${encodeURIComponent(player.steam_id || "")}`;
  }

  function daysSince(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  }

  function legendStatus(player) {
    const days = daysSince(player.last_match_at || player.last_active);
    if (days === null) return "Legacy archive";
    if (days <= 14) return "Active legend";
    if (days <= 45) return "Still in rotation";
    if (days <= 120) return "Recent era icon";
    return "Legacy archive";
  }

  function mergePlayers(primaryPlayers, detailedPlayers) {
    const detailMap = new Map((detailedPlayers || []).map((player) => [String(player.steam_id || ""), player]));
    return (primaryPlayers || []).map((player) => {
      const detail = detailMap.get(String(player.steam_id || "")) || {};
      return { ...detail, ...player, ...detail };
    });
  }

  async function loadHallOfFame() {
    try {
      return await window.HubApi.hallOfFame(80);
    } catch (_) {}
    try {
      return await window.HubStatic.hallOfFame();
    } catch (_) {}
    const summary = await loadSummary();
    return { players: Array.isArray(summary.storyboards && summary.storyboards.hall_of_fame) ? summary.storyboards.hall_of_fame : [] };
  }

  async function loadSummary() {
    try {
      return await window.HubApi.summary();
    } catch (_) {}
    const homePayload = await window.HubStatic.home();
    return homePayload.summary || {};
  }

  async function loadDetailedPlayers() {
    try {
      return await window.HubApi.players({ limit: 450 });
    } catch (_) {
      return await window.HubStatic.players();
    }
  }

  function heroSection(player) {
    if (!player) {
      return `
        <section class="v2-card tier-a hall-hero">
          <div class="hall-hero-copy">
            <div class="v2-kicker">Prestige Table</div>
            <h2 class="v2-display">Hall of Fame data is not available yet.</h2>
            <p class="v2-subtitle">Apply the hub refresh and export again if this should already be populated.</p>
          </div>
        </section>
      `;
    }

    return `
      <section class="v2-card tier-a hall-hero">
        <div class="hall-hero-copy">
          <div class="v2-kicker">Prestige Table</div>
          <h2 class="v2-display">${playerName(player)}</h2>
          <p class="v2-subtitle">Legacy is built from rating, awards, trophies, match volume, and big-match influence. This page turns the prestige model into a real destination instead of a small homepage widget.</p>
          <div class="hall-fact-row">
            <span class="hall-fact-chip">${esc(player.position || "N/A")}</span>
            <span class="hall-fact-chip">${teamName(player)}</span>
            <span class="hall-fact-chip">${esc(legendStatus(player))}</span>
            <span class="hall-fact-chip">Last match ${esc(fmtDate(player.last_match_at))}</span>
          </div>
          <div class="community-cta-row">
            <a class="home-action-btn" href="${playerLink(player)}">Open Profile</a>
            <a class="home-action-btn" href="rankings.html">Current Rankings</a>
            <a class="home-action-btn" href="players.html">Player Browser</a>
          </div>
        </div>

        <div class="hall-spotlight">
          <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
          <div class="hall-spotlight-score">
            <strong>${esc(fmtScore(player.prestige_score))}</strong>
            <span>Prestige Score</span>
          </div>
          <div class="hall-spotlight-grid">
            <span><strong>${esc(fmtCount(player.trophy_count))}</strong><span>Trophies</span></span>
            <span><strong>${esc(fmtCount(player.award_count))}</strong><span>Awards</span></span>
            <span><strong>${esc(fmtCount(player.matches_played))}</strong><span>Matches</span></span>
            <span><strong>${esc(fmtRating(player.rating))}</strong><span>Rating</span></span>
          </div>
        </div>
      </section>
    `;
  }

  function classCard(player, index) {
    if (!player) return "";
    const labels = ["Immortal Seat", "First Ballot", "All-Time Class"];
    return `
      <a class="v2-card tier-b hall-class-card" href="${playerLink(player)}">
        <span class="v2-rank">#${index + 1}</span>
        <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
        <div class="v2-kicker">${esc(labels[index] || "Hall Entry")}</div>
        <h3>${playerName(player)}</h3>
        <div class="v2-subtitle">${esc(player.position || "N/A")} &middot; ${teamName(player)}</div>
        <div class="hall-class-meta">
          <span><strong>${esc(fmtScore(player.prestige_score))}</strong><span>Prestige</span></span>
          <span><strong>${esc(fmtCount(player.trophy_count))}</strong><span>Trophies</span></span>
          <span><strong>${esc(fmtCount(player.award_count))}</strong><span>Awards</span></span>
        </div>
      </a>
    `;
  }

  function watchRow(player, label) {
    return `
      <a class="v2-mini-card hall-watch-row" href="${playerLink(player)}">
        <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
        <span>
          <strong>${playerName(player)}</strong>
          <span class="v2-subtitle">${esc(label)} &middot; ${esc(player.position || "N/A")} &middot; ${teamName(player)}</span>
        </span>
        <span class="v2-rating compact"><strong>${esc(fmtScore(player.prestige_score))}</strong><span>PRS</span></span>
      </a>
    `;
  }

  function tableRow(player, index) {
    return `
      <a class="hall-table-row" href="${playerLink(player)}">
        <span class="hall-table-rank">#${index + 1}</span>
        <span class="hall-table-player">
          <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
          <span>
            <strong>${playerName(player)}</strong>
            <span class="v2-subtitle">${esc(player.position || "N/A")} &middot; ${teamName(player)}</span>
          </span>
        </span>
        <span class="hall-table-score">${esc(fmtScore(player.prestige_score))}</span>
        <span class="hall-table-meta">${esc(fmtCount(player.trophy_count))}</span>
        <span class="hall-table-meta">${esc(fmtCount(player.award_count))}</span>
        <span class="hall-table-meta">${esc(fmtCount(player.matches_played))}</span>
        <span class="hall-table-score">${esc(fmtRating(player.rating))}</span>
      </a>
    `;
  }

  function risingCard(player, index) {
    return `
      <a class="v2-card tier-c hall-rising-card" href="${playerLink(player)}">
        <span class="v2-rank">#${index + 1}</span>
        <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
        <div>
          <div class="v2-kicker">Next Wave</div>
          <h3>${playerName(player)}</h3>
          <div class="v2-subtitle">${esc(player.position || "N/A")} &middot; ${teamName(player)}</div>
        </div>
        <div class="hall-rising-metrics">
          <span><strong>${esc(fmtCount(player.recent5_goals))}</strong><span>G5</span></span>
          <span><strong>${esc(fmtCount(player.recent7_motm))}</strong><span>MOTM</span></span>
          <span><strong>${esc(fmtScore(player.rise_score))}</strong><span>Rise</span></span>
        </div>
      </a>
    `;
  }

  try {
    const [hallResult, playersResult, summaryResult] = await Promise.allSettled([
      loadHallOfFame(),
      loadDetailedPlayers(),
      loadSummary(),
    ]);

    const hallPayload = hallResult.status === "fulfilled" ? hallResult.value : { players: [] };
    const playersPayload = playersResult.status === "fulfilled" ? playersResult.value : { players: [] };
    const summaryPayload = summaryResult.status === "fulfilled" ? summaryResult.value : {};

    const detailedPlayers = Array.isArray(playersPayload.players) ? playersPayload.players : [];
    const hallPlayers = mergePlayers(Array.isArray(hallPayload.players) ? hallPayload.players : [], detailedPlayers);
    const risingStars = mergePlayers(
      Array.isArray(summaryPayload.storyboards && summaryPayload.storyboards.rising_stars)
        ? summaryPayload.storyboards.rising_stars
        : [],
      detailedPlayers
    ).slice(0, 8);

    const topLegend = hallPlayers[0] || null;
    const topThree = hallPlayers.slice(0, 3);
    const legacyWatch = hallPlayers
      .filter((player) => player.last_match_at)
      .slice()
      .sort((left, right) => new Date(right.last_match_at).getTime() - new Date(left.last_match_at).getTime())
      .slice(0, 4);

    const metricsSample = hallPlayers.slice(0, 20);
    const trophyTotal = hallPlayers.reduce((sum, player) => sum + num(player.trophy_count), 0);
    const awardTotal = hallPlayers.reduce((sum, player) => sum + num(player.award_count), 0);
    const avgPrestige = metricsSample.length
      ? metricsSample.reduce((sum, player) => sum + num(player.prestige_score), 0) / metricsSample.length
      : 0;
    const avgRating = metricsSample.length
      ? metricsSample.reduce((sum, player) => sum + num(player.rating), 0) / metricsSample.length
      : 0;

    page.innerHTML = `
      <div class="hub-v2 hall-page">
        ${heroSection(topLegend)}

        <section class="v2-grid four">
          <article class="v2-stat-tile"><span class="v2-label">Legends Tracked</span><strong>${esc(fmtCount(hallPlayers.length))}</strong></article>
          <article class="v2-stat-tile"><span class="v2-label">Trophies Logged</span><strong>${esc(fmtCount(trophyTotal))}</strong></article>
          <article class="v2-stat-tile"><span class="v2-label">Awards Logged</span><strong>${esc(fmtCount(awardTotal))}</strong></article>
          <article class="v2-stat-tile"><span class="v2-label">Top 20 Avg Prestige</span><strong>${esc(fmtScore(avgPrestige))}</strong></article>
        </section>

        <section class="v2-grid two">
          <article class="v2-card tier-b">
            <div class="v2-section-head">
              <div>
                <div class="v2-kicker">First Ballot</div>
                <h3>Current Hall Class</h3>
              </div>
              <div class="v2-subtitle">Average rating ${esc(fmtRating(avgRating))}</div>
            </div>
            <div class="hall-class-grid">
              ${topThree.length ? topThree.map((player, index) => classCard(player, index)).join("") : '<div class="v2-mini-card">No hall entries are available yet.</div>'}
            </div>
          </article>

          <article class="v2-card tier-b">
            <div class="v2-section-head">
              <div>
                <div class="v2-kicker">Legacy Watch</div>
                <h3>Recently Active Legends</h3>
              </div>
            </div>
            <div class="hall-watch-list">
              ${(legacyWatch.length ? legacyWatch : topThree).map((player) => watchRow(player, legendStatus(player))).join("") || '<div class="v2-mini-card">No active legends to highlight yet.</div>'}
            </div>
          </article>
        </section>

        <section class="v2-card tier-c hall-table-shell">
          <div class="v2-section-head">
            <div>
              <div class="v2-kicker">Prestige Ladder</div>
              <h3>Full Hall Of Fame Table</h3>
            </div>
          </div>
          <div class="hall-table-head">
            <span>Rank</span>
            <span>Player</span>
            <span>Prestige</span>
            <span>Trophies</span>
            <span>Awards</span>
            <span>Matches</span>
            <span>Rating</span>
          </div>
          <div class="hall-table-list">
            ${hallPlayers.length ? hallPlayers.map((player, index) => tableRow(player, index)).join("") : '<div class="v2-mini-card">No prestige records were returned.</div>'}
          </div>
        </section>

        <section class="v2-card tier-b">
          <div class="v2-section-head">
            <div>
              <div class="v2-kicker">Prestige Pipeline</div>
              <h3>Rising Stars With Hall Potential</h3>
            </div>
          </div>
          <div class="hall-rising-grid">
            ${risingStars.length ? risingStars.map((player, index) => risingCard(player, index)).join("") : '<div class="v2-mini-card">No rising star records were returned.</div>'}
          </div>
        </section>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load hall of fame: ${err.message}`);
  }
})();
