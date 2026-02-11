(function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout("match.html", "Match Detail");
  const page = byId("page");

  const params = new URLSearchParams(window.location.search);
  const matchId = params.get("id");
  if (!matchId) {
    showError("Missing match id in URL.");
    return;
  }

  const STAT_ICONS = {
    goal: "assets/icons/soccer-ball-icon.png",
    assist: "assets/icons/cleats-icon.png",
    save: "assets/icons/glove-icon.png",
    tackle: "assets/icons/cleats-icon.png",
    interception: "assets/icons/cleats-icon.png",
    chance: "assets/icons/cleats-icon.png",
    keypass: "assets/icons/cleats-icon.png",
    yellow: "assets/icons/yellow-card-icon.png",
    red: "assets/icons/red-card-icon.png"
  };

  const FORMATIONS = {
    eight: [
      { pos: "LW", x: 16, y: 18 },
      { pos: "CF", x: 50, y: 18 },
      { pos: "RW", x: 84, y: 18 },
      { pos: "CM", x: 50, y: 39 },
      { pos: "LB", x: 16, y: 62 },
      { pos: "CB", x: 50, y: 62 },
      { pos: "RB", x: 84, y: 62 },
      { pos: "GK", x: 50, y: 86 }
    ],
    six: [
      { pos: "LW", x: 22, y: 22 },
      { pos: "RW", x: 78, y: 22 },
      { pos: "CM", x: 50, y: 42 },
      { pos: "LB", x: 22, y: 64 },
      { pos: "RB", x: 78, y: 64 },
      { pos: "GK", x: 50, y: 86 }
    ],
    five: [
      { pos: "CF", x: 50, y: 21 },
      { pos: "LM", x: 22, y: 42 },
      { pos: "RM", x: 78, y: 42 },
      { pos: "CB", x: 50, y: 64 },
      { pos: "GK", x: 50, y: 86 }
    ]
  };

  function normName(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function safeName(player) {
    return String(player && (player.player_name || player.steam_id) || "Unknown");
  }

  function shortWhenLabel(dateValue) {
    if (!dateValue) return "";
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    if (now.toDateString() === date.toDateString()) return "Today";
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (yesterday.toDateString() === date.toDateString()) return "Yesterday";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function truncateName(name, max) {
    const value = String(name || "");
    const limit = max || 14;
    if (value.length <= limit) return value;
    return value.slice(0, Math.max(1, limit - 3)) + "...";
  }

  function parseLineupEntries(lineupData) {
    const entries = [];
    if (!Array.isArray(lineupData)) return entries;

    for (const item of lineupData) {
      if (Array.isArray(item) && item.length >= 3) {
        const started = item.length >= 4 ? Boolean(item[3]) : true;
        entries.push({
          pos: String(item[0] || "").toUpperCase(),
          name: String(item[1] || item[2] || "-"),
          steamId: String(item[2] || ""),
          started
        });
        continue;
      }

      if (!item || typeof item !== "object") continue;
      const pos = String(item.position || item.pos || item.slot || "").toUpperCase();
      if (!pos) continue;
      const started = item.started === undefined ? true : Boolean(item.started);
      entries.push({
        pos,
        name: String(item.name || item.player_name || item.discord_name || item.player || item.steam_id || "-"),
        steamId: String(item.steam_id || item.steamId || ""),
        started
      });
    }

    return entries;
  }

  function detectFormation(entries) {
    const started = entries.filter((entry) => entry.started !== false);
    const positions = new Set(started.map((entry) => entry.pos));

    if (positions.has("CF") && positions.has("LM") && positions.has("RM") && positions.has("CB") && positions.has("GK")) return "five";
    if (positions.has("LW") && positions.has("RW") && positions.has("CM") && positions.has("LB") && positions.has("RB") && positions.has("GK") && !positions.has("CF")) return "six";

    if (started.length <= 5) return "five";
    if (started.length <= 6) return "six";
    return "eight";
  }

  function buildEventLines(sideStats) {
    const lines = [];

    for (const player of sideStats || []) {
      const name = safeName(player);
      const rows = [
        ["goal", Number(player.goals || 0)],
        ["assist", Number(player.assists || 0)],
        ["save", Number(player.keeper_saves || 0)],
        ["tackle", Number(player.tackles || 0)],
        ["interception", Number(player.interceptions || 0)],
        ["chance", Number(player.chances_created || 0)],
        ["keypass", Number(player.key_passes || 0)],
        ["yellow", Number(player.yellow_cards || 0)],
        ["red", Number(player.red_cards || 0)]
      ];

      for (const row of rows) {
        if (row[1] > 0) {
          lines.push({ kind: row[0], name, count: row[1] });
        }
      }
    }

    lines.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    if (!lines.length) return [{ kind: "empty", label: "No key stats" }];
    return lines.slice(0, 12);
  }

  function eventLineHtml(item) {
    if (item.kind === "empty") {
      return '<div class="match-event-line"><span class="meta">' + esc(item.label) + '</span></div>';
    }

    const icon = STAT_ICONS[item.kind] || STAT_ICONS.goal;
    const countText = item.count > 1 ? " x" + item.count : "";
    return `
      <div class="match-event-line ${esc(item.kind)}">
        <img class="event-icon" src="${esc(icon)}" alt="${esc(item.kind)}">
        <span>${esc(item.name)}${esc(countText)}</span>
      </div>
    `;
  }

  function teamLogo(url, teamName) {
    const hasUrl = String(url || "").trim();
    const fallback = /iosca/i.test(String(teamName || "")) ? "assets/icons/iosca-icon.png" : "";
    const finalUrl = hasUrl || fallback;
    if (!finalUrl) return '<div class="match-team-logo"></div>';
    return `<img class="match-team-logo" src="${esc(finalUrl)}" alt="${esc(teamName || "Team")}">`;
  }

  function buildStatsLookup(sideStats) {
    const bySteam = new Map();
    const byName = new Map();

    for (const row of sideStats || []) {
      const steamKey = String(row.steam_id || "").trim();
      if (steamKey) bySteam.set(steamKey, row);
      const nameKey = normName(row.player_name || "");
      if (nameKey) byName.set(nameKey, row);
    }

    return { bySteam, byName };
  }

  function resolvePlayerStats(entry, lookup) {
    if (!entry || !lookup) return null;
    const steam = String(entry.steamId || "").trim();
    if (steam && lookup.bySteam.has(steam)) return lookup.bySteam.get(steam);
    const nameKey = normName(entry.name || "");
    if (nameKey && lookup.byName.has(nameKey)) return lookup.byName.get(nameKey);
    return null;
  }

  function playerStatChips(player) {
    if (!player) return "";

    const rows = [
      ["goal", Number(player.goals || 0)],
      ["assist", Number(player.assists || 0)],
      ["save", Number(player.keeper_saves || 0)],
      ["tackle", Number(player.tackles || 0)],
      ["interception", Number(player.interceptions || 0)],
      ["keypass", Number(player.key_passes || 0)],
      ["chance", Number(player.chances_created || 0)],
      ["red", Number(player.red_cards || 0)],
      ["yellow", Number(player.yellow_cards || 0)]
    ];

    const chips = rows
      .filter((row) => row[1] > 0)
      .map((row) => `<span class="pitch-stat-chip"><img src="${esc(STAT_ICONS[row[0]])}" alt="${esc(row[0])}"><em>${esc(row[1])}</em></span>`);

    if (!chips.length) return "";
    return `<div class="pitch-player-stats">${chips.join("")}</div>`;
  }

  function lineupCardHtml(teamName, teamIcon, entries, lookup) {
    const formationKey = detectFormation(entries);
    const slots = FORMATIONS[formationKey] || FORMATIONS.eight;
    const started = entries.filter((entry) => entry.started !== false);
    const usedIndex = new Set();

    const nodes = slots.map((slot) => {
      const matchIndex = started.findIndex((entry, idx) => !usedIndex.has(idx) && entry.pos === slot.pos);
      let entry = null;

      if (matchIndex >= 0) {
        usedIndex.add(matchIndex);
        entry = started[matchIndex];
      }

      if (!entry) {
        return `
          <div class="pitch-player empty" style="left:${slot.x}%;top:${slot.y}%;">
            <div class="pitch-jersey">${esc(slot.pos)}</div>
            <div class="pitch-player-name">&nbsp;</div>
          </div>
        `;
      }

      const stats = resolvePlayerStats(entry, lookup);
      return `
        <div class="pitch-player" style="left:${slot.x}%;top:${slot.y}%;">
          <div class="pitch-jersey">${esc(slot.pos)}</div>
          <div class="pitch-player-name">${esc(truncateName(entry.name, 16))}</div>
          ${playerStatChips(stats)}
        </div>
      `;
    }).join("");

    const fallbackIcon = /iosca/i.test(String(teamName || "")) ? "assets/icons/iosca-icon.png" : "";
    const headerIcon = String(teamIcon || "").trim() || fallbackIcon;

    return `
      <article class="pitch-card">
        <header class="pitch-header">
          ${headerIcon ? `<img class="pitch-header-icon" src="${esc(headerIcon)}" alt="${esc(teamName)}">` : ""}
          <h3>${esc(teamName)}</h3>
        </header>
        <div class="pitch-surface">
          <div class="pitch-line half"></div>
          <div class="pitch-circle"></div>
          <div class="pitch-box top"></div>
          <div class="pitch-goal-box top"></div>
          <div class="pitch-box bottom"></div>
          <div class="pitch-goal-box bottom"></div>
          ${nodes}
        </div>
      </article>
    `;
  }

  function computeMvp(allStats) {
    if (!allStats.length) return null;

    const scored = allStats.map((player) => {
      const goals = Number(player.goals || 0);
      const assists = Number(player.assists || 0);
      const saves = Number(player.keeper_saves || 0);
      const interceptions = Number(player.interceptions || 0);
      const tackles = Number(player.tackles || 0);
      const chances = Number(player.chances_created || 0);
      const keyPasses = Number(player.key_passes || 0);
      const reds = Number(player.red_cards || 0);
      const yellows = Number(player.yellow_cards || 0);

      const score =
        goals * 4 +
        assists * 3 +
        saves * 1.7 +
        interceptions * 1.25 +
        tackles * 1.05 +
        chances * 1.2 +
        keyPasses * 1.0 -
        reds * 3.4 -
        yellows * 1.1;

      return { ...player, _score: score };
    }).sort((a, b) => b._score - a._score);

    return scored[0] || null;
  }

  function mvpReason(player) {
    if (!player) return "No MVP data available for this match.";
    if (Number(player.goals || 0) >= 3) return "Hat-trick performance.";

    const metrics = [
      [Number(player.goals || 0), "goals"],
      [Number(player.assists || 0), "assists"],
      [Number(player.interceptions || 0), "interceptions"],
      [Number(player.tackles || 0), "tackles"],
      [Number(player.keeper_saves || 0), "saves"],
      [Number(player.chances_created || 0), "chances created"],
      [Number(player.key_passes || 0), "key passes"]
    ].filter((row) => row[0] > 0).sort((a, b) => b[0] - a[0]);

    if (!metrics.length) return "Strong all-around impact for the match.";
    return metrics.slice(0, 3).map((row) => `${row[0]} ${row[1]}`).join(" | ");
  }

  function mvpWidgetHtml(mvp) {
    if (!mvp) {
      return `
        <section class="mvp-widget">
          <div class="mvp-header">
            <div class="mvp-title">
              <img src="assets/icons/gold-medal-icon.png" alt="MVP">
              <span>MVP</span>
            </div>
          </div>
          <div class="mvp-name">No MVP Available</div>
          <div class="mvp-reason">No player stats were found for this match.</div>
        </section>
      `;
    }

    const playerName = safeName(mvp);
    const position = String(mvp.position || "N/A").toUpperCase();

    return `
      <section class="mvp-widget">
        <img class="mvp-bg-bot" src="assets/icons/entrenador-icon.png" alt="">
        <div class="mvp-header">
          <div class="mvp-title">
            <img src="assets/icons/gold-medal-icon.png" alt="MVP medal">
            <span>MVP</span>
          </div>
        </div>
        <div class="mvp-name">${esc(playerName)}</div>
        <div class="mvp-sub">${esc(position)}</div>
        <div class="mvp-reason">${esc(mvpReason(mvp))}</div>
      </section>
    `;
  }

  (async function init() {
    try {
      const data = await window.HubApi.match(matchId);
      const match = data.match || {};
      const homeStats = data.player_stats && data.player_stats.home ? data.player_stats.home : [];
      const awayStats = data.player_stats && data.player_stats.away ? data.player_stats.away : [];
      const neutralStats = data.player_stats && data.player_stats.neutral ? data.player_stats.neutral : [];
      const allStats = [...homeStats, ...awayStats, ...neutralStats];

      const competitionLabel = match.tournament_name || match.game_type || "Match";
      const matchDate = fmtDateTime(match.datetime);
      const whenLabel = shortWhenLabel(match.datetime);
      const homeEvents = buildEventLines(homeStats);
      const awayEvents = buildEventLines(awayStats);

      const homeLineup = parseLineupEntries(match.home_lineup || []);
      const awayLineup = parseLineupEntries(match.away_lineup || []);
      const homeLookup = buildStatsLookup(homeStats);
      const awayLookup = buildStatsLookup(awayStats);
      const mvp = computeMvp(allStats);

      page.innerHTML = `
        <section class="match-panel">
          <div class="match-top-row">
            <div class="left">${esc(competitionLabel)}${whenLabel ? ` - ${esc(whenLabel)}` : ""}</div>
            <div class="right">Full-time</div>
          </div>

          <div class="match-hero">
            <div class="match-side">
              ${teamLogo(match.home_team_icon, match.home_team_name || "Home")}
              <h2 class="match-team-name">${esc(match.home_team_name || "Home")}</h2>
            </div>

            <div class="match-score">
              <div class="value">${esc(match.home_score ?? 0)} - ${esc(match.away_score ?? 0)}</div>
              <div class="flags">
                ${match.extratime ? '<span class="badge">ET</span>' : ""}
                ${match.penalties ? '<span class="badge">PEN</span>' : ""}
              </div>
            </div>

            <div class="match-side">
              ${teamLogo(match.away_team_icon, match.away_team_name || "Away")}
              <h2 class="match-team-name">${esc(match.away_team_name || "Away")}</h2>
            </div>
          </div>

          <div class="match-events-wrap">
            <div class="match-events-grid">
              <div class="match-events">${homeEvents.map(eventLineHtml).join("")}</div>
              <div class="match-events">${awayEvents.map(eventLineHtml).join("")}</div>
            </div>
          </div>

          <div class="match-bottom-meta">${esc(matchDate)}</div>
        </section>

        ${mvpWidgetHtml(mvp)}

        <section class="lineup-pitches">
          ${lineupCardHtml(match.home_team_name || "Home", match.home_team_icon, homeLineup, homeLookup)}
          ${lineupCardHtml(match.away_team_name || "Away", match.away_team_icon, awayLineup, awayLookup)}
        </section>
      `;
    } catch (err) {
      showError(`Failed to load match detail: ${err.message}`);
    }
  })();
})();
