(async function () {
  const { renderLayout, byId, esc, showError } = window.HubUI;
  renderLayout("rankings.html", "Player Leaderboards", {
    layout: "wide",
    eyebrow: "Top Performers",
  });

  const page = byId("page");
  const fallbackAvatar = "https://cdn.discordapp.com/embed/avatars/0.png";

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

  function playerLink(player) {
    return `player.html?steam_id=${encodeURIComponent(player.steam_id || "")}`;
  }

  function podiumCard(player, index) {
    if (!player) {
      return `
        <article class="leaderboard-podium-card">
          <div class="leaderboard-podium-rank">#${index + 1}</div>
          <div class="leaderboard-meta">No player data</div>
        </article>
      `;
    }
    return `
      <article class="leaderboard-podium-card ${index === 0 ? "is-first" : ""}">
        <div class="leaderboard-podium-rank">#${index + 1}</div>
        <img class="leaderboard-avatar" src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
        <div class="leaderboard-player-name">${playerName(player)}</div>
        <div class="leaderboard-meta">${esc(player.position || "N/A")}</div>
        <div class="leaderboard-kpi" style="margin-top:16px;">
          <span>Rating</span>
          <strong>${esc(fmtRating(player.rating))}</strong>
        </div>
      </article>
    `;
  }

  function leaderCard(label, player) {
    if (!player) {
      return `
        <article class="leaderboard-card">
          <div class="home-kicker">${esc(label)}</div>
          <h3>Unavailable</h3>
          <div class="leaderboard-meta">No player returned for this slot.</div>
        </article>
      `;
    }
    return `
      <article class="leaderboard-card">
        <div class="home-kicker">${esc(label)}</div>
        <div class="leaderboard-row-main" style="margin-top:16px;">
          <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
          <div>
            <a class="leaderboard-row-name" href="${playerLink(player)}">${playerName(player)}</a>
            <div class="leaderboard-meta">${esc(player.position || "N/A")}</div>
          </div>
        </div>
        <div class="leaderboard-row-meta" style="margin-top:16px;">
          <div class="leaderboard-kpi">
            <span>Rating</span>
            <strong>${esc(fmtRating(player.rating))}</strong>
          </div>
          <div class="leaderboard-kpi">
            <span>Steam ID</span>
            <strong>${esc(player.steam_id || "N/A")}</strong>
          </div>
          <div class="leaderboard-kpi">
            <span>Role</span>
            <strong>${esc(player.position || "N/A")}</strong>
          </div>
        </div>
      </article>
    `;
  }

  try {
    const data = await window.HubApi.rankings(100);
    const players = Array.isArray(data.players) ? data.players : [];
    const widgets = data.widgets || {};
    const topThree = [players[0], players[1], players[2]];

    page.innerHTML = `
      <section class="leaderboard-hero">
        <div class="leaderboard-hero-head">
          <div>
            <div class="home-kicker">Season Snapshot</div>
            <h2 class="leaderboard-hero-title">Top players, position leaders, and the current order of play.</h2>
            <p class="leaderboard-meta">This page now behaves more like a sports leaderboard than a generic report table.</p>
          </div>
          <div class="leaderboard-tabs">
            <a class="leaderboard-tab active" href="rankings.html">Overall</a>
            <a class="leaderboard-tab" href="players.html">Player Browser</a>
          </div>
        </div>

        <div class="leaderboard-podium">
          ${podiumCard(topThree[1], 1)}
          ${podiumCard(topThree[0], 0)}
          ${podiumCard(topThree[2], 2)}
        </div>
      </section>

      <section class="home-leaders-grid">
        ${leaderCard("Best Goalkeeper", widgets.best_goalkeeper)}
        ${leaderCard("Best Defender", widgets.best_defender)}
        ${leaderCard("Best Midfielder", widgets.best_midfielder)}
        ${leaderCard("Best Attacker", widgets.best_attacker)}
      </section>

      <section class="leaderboard-card">
        <div class="home-kicker">Overall Table</div>
        <h3>Top 100 players</h3>
        <div class="leaderboard-list">
          ${players.length ? players.map((player, index) => `
            <a class="leaderboard-row" href="${playerLink(player)}">
              <div class="leaderboard-row-rank">
                <strong>#${index + 1}</strong>
              </div>
              <div class="leaderboard-row-main">
                <img src="${avatarFor(player)}" alt="${playerName(player)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
                <div>
                  <div class="leaderboard-row-name">${playerName(player)}</div>
                  <div class="leaderboard-meta">${esc(player.position || "N/A")}</div>
                </div>
              </div>
              <div class="leaderboard-row-meta">
                <div class="leaderboard-kpi">
                  <span>Rating</span>
                  <strong>${esc(fmtRating(player.rating))}</strong>
                </div>
                <div class="leaderboard-kpi">
                  <span>Position</span>
                  <strong>${esc(player.position || "N/A")}</strong>
                </div>
                <div class="leaderboard-kpi">
                  <span>Steam ID</span>
                  <strong>${esc(player.steam_id || "N/A")}</strong>
                </div>
              </div>
            </a>
          `).join("") : '<div class="empty">No ranking data was returned.</div>'}
        </div>
      </section>
    `;
  } catch (err) {
    showError(`Failed to load rankings: ${err.message}`);
  }
})();
