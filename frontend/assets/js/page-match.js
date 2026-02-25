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

  const STAT_META = {
    goal: { icon: "assets/icons/soccer-ball-icon.png", label: "Goals", chip: "G" },
    own_goal: { icon: "assets/icons/soccer-ball-icon.png", label: "Own goals", chip: "OG" },
    assist: { icon: "assets/icons/cleats-icon.png", label: "Assists", chip: "A" },
    save: { icon: "assets/icons/glove-icon.png", label: "Saves", chip: "S" },
    tackle: { icon: "assets/icons/cleats-icon.png", label: "Tackles", chip: "TKL" },
    interception: { icon: "assets/icons/cleats-icon.png", label: "Interceptions", chip: "INT" },
    yellow: { icon: "assets/icons/yellow-card-icon.png", label: "Yellow cards", chip: "Y" },
    red: { icon: "assets/icons/red-card-icon.png", label: "Red cards", chip: "R" }
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

  function mvpIdentity(mvp) {
    if (!mvp) return { steam: "", name: "", pos: "" };
    return {
      steam: String(mvp.steam_id || "").trim(),
      name: normName(mvp.player_name || mvp.name || ""),
      pos: String(mvp.position || "").toUpperCase().trim()
    };
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

  function toNum(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function pickNum(player, keys) {
    for (const key of keys) {
      if (player && player[key] !== undefined && player[key] !== null) return toNum(player[key]);
    }
    return 0;
  }

  function playerRating10(player) {
    const provided = Number(
      player && (
        player.match_rating ??
        player.matchRating ??
        player.matched_rating ??
        player._rating ??
        player.mvp_score ??
        player.score
      )
    );
    if (Number.isFinite(provided)) {
      const clampedProvided = Math.max(3, Math.min(10, provided));
      return Math.round(clampedProvided * 10) / 10;
    }

    const goals = pickNum(player, ["goals"]);
    const assists = pickNum(player, ["assists"]);
    const saves = pickNum(player, ["keeper_saves", "keeperSaves"]);
    const interceptions = pickNum(player, ["interceptions"]);
    const tackles = pickNum(player, ["tackles", "sliding_tackles_completed", "slidingTacklesCompleted"]);
    const chances = pickNum(player, ["chances_created", "chancesCreated"]);
    const keyPasses = pickNum(player, ["key_passes", "keyPasses"]);
    const shotsOnGoal = pickNum(player, ["shots_on_goal", "shotsOnGoal"]);
    const passesCompleted = pickNum(player, ["passes_completed", "passesCompleted"]);
    const reds = pickNum(player, ["red_cards", "redCards"]);
    const yellows = pickNum(player, ["yellow_cards", "yellowCards"]);
    const ownGoals = pickNum(player, ["own_goals", "ownGoals"]);
    const goalsConceded = pickNum(player, ["goals_conceded", "goalsConceded"]);

    const raw =
      5.5 +
      goals * 1.1 +
      assists * 0.8 +
      saves * 0.24 +
      interceptions * 0.18 +
      tackles * 0.14 +
      chances * 0.22 +
      keyPasses * 0.18 +
      shotsOnGoal * 0.11 +
      passesCompleted * 0.004 -
      reds * 1.9 -
      yellows * 0.35 -
      ownGoals * 1.2 -
      goalsConceded * 0.05;

    const clamped = Math.max(3, Math.min(10, raw));
    return Math.round(clamped * 10) / 10;
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

  function normalizeLineupPos(value) {
    const pos = String(value || "").toUpperCase().trim();
    // Canonical lineup positions are already stored in DB; keep raw uppercase.
    return pos;
  }

  function formationFromGameType(gameType) {
    const raw = String(gameType || "").toLowerCase();
    if (!raw) return null;
    if (raw.includes("8v8")) return "eight";
    if (raw.includes("6v6")) return "six";
    if (raw.includes("5v5")) return "five";
    return null;
  }

  function detectFormation(entries, gameType) {
    const byType = formationFromGameType(gameType);
    if (byType) return byType;

    const started = entries.filter((entry) => entry.started !== false);
    const positions = new Set(started.map((entry) => normalizeLineupPos(entry.pos)));

    if (positions.has("CF") && positions.has("LM") && positions.has("RM") && positions.has("CB") && positions.has("GK")) return "five";
    if (positions.has("LW") && positions.has("RW") && positions.has("CM") && positions.has("LB") && positions.has("RB") && positions.has("GK") && !positions.has("CF")) return "six";

    if (started.length <= 5) return "five";
    if (started.length <= 6) return "six";
    return "eight";
  }

  function buildEventLines(sideStats) {
    const lines = [];

    function parseMinutes(raw) {
      if (Array.isArray(raw)) {
        // pass
      } else if (raw === null || raw === undefined) {
        return [];
      } else {
        raw = [raw];
      }
      const mins = raw
        .map((v) => {
          const n = Number(v);
          return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : null;
        })
        .filter((v) => v !== null);
      return [...new Set(mins)].sort((a, b) => a - b);
    }

    function getEventMap(player) {
      let raw = player && (player.event_timestamps ?? player.eventTimestamps) || {};
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch (_) {
          raw = {};
        }
      }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      return raw;
    }

    function getMinutes(eventMap, keys) {
      const normalized = {};
      Object.keys(eventMap || {}).forEach((k) => {
        normalized[String(k || "").toLowerCase().replace(/[^a-z0-9]/g, "")] = eventMap[k];
      });
      for (const key of keys) {
        const mins = parseMinutes(eventMap[key]);
        if (mins.length) return mins;
        const nkey = String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const nmins = parseMinutes(normalized[nkey]);
        if (nmins.length) return nmins;
      }
      return [];
    }

    for (const player of sideStats || []) {
      const name = safeName(player);
      const eventMap = getEventMap(player);
      const rating = playerRating10(player);

      const goalMinutes = getMinutes(eventMap, ["goal", "goals"]);
      if (goalMinutes.length) {
        lines.push({ kind: "goal", name, minutes: goalMinutes, sortMinute: goalMinutes[0], rating });
      } else {
        const count = Number(player.goals || 0);
        if (count > 0) lines.push({ kind: "goal", name, count, sortMinute: 999, rating });
      }

      const yellowMinutes = getMinutes(eventMap, ["yellow", "yellow_card", "yellow_cards"]);
      if (yellowMinutes.length) {
        lines.push({ kind: "yellow", name, minutes: yellowMinutes, sortMinute: yellowMinutes[0], rating });
      } else {
        const count = Number(player.yellow_cards || player.yellowCards || 0);
        if (count > 0) lines.push({ kind: "yellow", name, count, sortMinute: 999, rating });
      }

      const redCount = Number(player.red_cards || player.redCards || 0);
      let redMinutes = getMinutes(eventMap, [
        "red",
        "red_card",
        "red_cards",
        "redcard",
        "redcards",
        "straight_red"
      ]);
      if (redMinutes.length) {
        lines.push({ kind: "red", name, minutes: redMinutes, sortMinute: redMinutes[0], rating });
      } else {
        const count = redCount;
        if (count > 0) lines.push({ kind: "red", name, count, sortMinute: 999, rating });
      }
    }

    lines.sort((a, b) => (a.sortMinute || 999) - (b.sortMinute || 999) || a.name.localeCompare(b.name));
    return lines.slice(0, 12);
  }

  function parseJsonValue(value, fallback) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "object") return value;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch (_) {
        return fallback;
      }
    }
    return fallback;
  }

  function normalizeMvpStats(value) {
    const parsed = parseJsonValue(value, value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0);
    }
    const text = String(parsed || "").trim();
    return text ? [text] : [];
  }

  function teamDerivedMetrics(sideStats) {
    const out = {
      starts: 0,
      subs: 0,
      bench: 0,
      clutch: 0,
      subImpactEvents: 0,
      subGoals: 0,
      subOwnGoals: 0
    };

    for (const player of sideStats || []) {
      const status = String(player.status || "").toLowerCase();
      if (status === "started") out.starts += 1;
      else if (status === "substitute") out.subs += 1;
      else if (status === "on_bench") out.bench += 1;

      const clutch = parseJsonValue(player.clutch_actions ?? player.clutchActions, []);
      if (Array.isArray(clutch)) out.clutch += clutch.length;

      const subImpact = parseJsonValue(player.sub_impact ?? player.subImpact, {});
      if (subImpact && typeof subImpact === "object") {
        if (Array.isArray(subImpact.events)) out.subImpactEvents += subImpact.events.length;
        if (subImpact.summary && typeof subImpact.summary === "object") {
          out.subGoals += Number(subImpact.summary.goals || 0) || 0;
          out.subOwnGoals += Number(subImpact.summary.own_goals || 0) || 0;
        }
      }

    }
    return out;
  }

  function attachEventRatings(items, sideStats) {
    const byName = new Map();
    for (const player of sideStats || []) {
      byName.set(normName(safeName(player)), player);
    }
    return (items || []).map((item) => {
      const linked = byName.get(normName(item.name || ""));
      const rating = linked ? playerRating10(linked) : null;
      return { ...item, rating };
    });
  }

  function eventLineHtml(item) {
    const icon = (STAT_META[item.kind] && STAT_META[item.kind].icon) || STAT_META.goal.icon;
    const minuteText = Array.isArray(item.minutes) && item.minutes.length
      ? " " + item.minutes.map((m) => `${m}'`).join(", ")
      : "";
    const countText = minuteText ? "" : (item.count > 1 ? " x" + item.count : "");
    const ratingBadge = Number.isFinite(item.rating)
      ? `<span class="event-rating">${esc(item.rating.toFixed(1))}</span>`
      : "";
    return `
      <div class="match-event-line ${esc(item.kind)}">
        <img class="event-icon" src="${esc(icon)}" alt="${esc(item.kind)}">
        <span>${esc(item.name)}${esc(minuteText)}${esc(countText)}</span>
        ${ratingBadge}
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
      ["red", Number(player.red_cards || 0)],
      ["yellow", Number(player.yellow_cards || 0)]
    ];

    const chips = rows
      .filter((row) => row[1] > 0)
      .map((row) => `<span class="pitch-stat-chip"><img src="${esc(STAT_META[row[0]].icon)}" alt="${esc(row[0])}"><em>${esc(row[1])}</em></span>`);

    if (!chips.length) return "";
    return `<div class="pitch-player-stats">${chips.join("")}</div>`;
  }

  function playerHoverCardHtml(player, profileSteamId) {
    if (!player) return "";
    const rating = playerRating10(player);
    const goals = pickNum(player, ["goals"]);
    const assists = pickNum(player, ["assists"]);
    const shotsOnGoal = pickNum(player, ["shots_on_goal", "shotsOnGoal"]);
    const passesCompleted = pickNum(player, ["passes_completed", "passesCompleted"]);
    const passesAttempted = pickNum(player, ["passes_attempted", "passesAttempted"]);
    const interceptions = pickNum(player, ["interceptions"]);
    const tackles = pickNum(player, ["tackles", "sliding_tackles_completed", "slidingTacklesCompleted"]);
    const saves = pickNum(player, ["keeper_saves", "keeperSaves"]) + pickNum(player, ["keeper_saves_caught", "keeperSavesCaught"]);
    const yellows = pickNum(player, ["yellow_cards", "yellowCards"]);
    const reds = pickNum(player, ["red_cards", "redCards"]);
    const passAcc = passesAttempted > 0 ? `${((passesCompleted / passesAttempted) * 100).toFixed(1)}%` : "0.0%";

    return `
      <div class="pitch-hover-card">
        <div class="pitch-hover-head">
          <strong>${esc(safeName(player))}</strong>
          <span>${esc(String(player.position || "").toUpperCase() || "N/A")} | ${esc(rating.toFixed(1))}</span>
        </div>
        <div class="pitch-hover-grid">
          <span>Goals: <b>${esc(goals)}</b></span>
          <span>Assists: <b>${esc(assists)}</b></span>
          <span>Shots on goal: <b>${esc(shotsOnGoal)}</b></span>
          <span>Passes: <b>${esc(passesCompleted)}/${esc(passesAttempted)} (${esc(passAcc)})</b></span>
          <span>Interceptions: <b>${esc(interceptions)}</b></span>
          <span>Tackles: <b>${esc(tackles)}</b></span>
          <span>Saves: <b>${esc(saves)}</b></span>
          <span>Cards: <b>${esc(yellows)}Y / ${esc(reds)}R</b></span>
        </div>
        ${profileSteamId ? '<div class="pitch-hover-foot">Click name to open full player profile</div>' : ""}
      </div>
    `;
  }

  function lineupCardHtml(teamName, teamIcon, entries, lookup, gameType, mvpKey) {
    const formationKey = detectFormation(entries, gameType);
    const slots = FORMATIONS[formationKey] || FORMATIONS.eight;
    const started = entries
      .filter((entry) => entry.started !== false)
      .map((entry) => ({ ...entry, pos: normalizeLineupPos(entry.pos) }));
    const usedIndex = new Set();
    const slotPlayers = new Array(slots.length).fill(null);

    // Pass 1: strict position mapping.
    for (let i = 0; i < slots.length; i++) {
      const expectedPos = normalizeLineupPos(slots[i].pos);
      const matchIndex = started.findIndex((entry, idx) => !usedIndex.has(idx) && entry.pos === expectedPos);
      if (matchIndex >= 0) {
        usedIndex.add(matchIndex);
        slotPlayers[i] = started[matchIndex];
      }
    }

    // Pass 2: if data has duplicates/missing positions, fill remaining slots with leftover starters.
    for (let i = 0; i < slots.length; i++) {
      if (slotPlayers[i]) continue;
      const fallbackIndex = started.findIndex((entry, idx) => !usedIndex.has(idx));
      if (fallbackIndex >= 0) {
        usedIndex.add(fallbackIndex);
        slotPlayers[i] = started[fallbackIndex];
      }
    }

    const nodes = slots.map((slot, slotIdx) => {
      const entry = slotPlayers[slotIdx];
      if (!entry) {
        return `
          <div class="pitch-player empty" style="left:${slot.x}%;top:${slot.y}%;">
            <div class="pitch-jersey">${esc(slot.pos)}</div>
            <div class="pitch-player-name">&nbsp;</div>
          </div>
        `;
      }

      const stats = resolvePlayerStats(entry, lookup);
      const rating = stats ? playerRating10(stats) : null;
      const profileSteamId = String(entry.steamId || (stats && stats.steam_id) || "").trim();
      const playerNameNorm = normName(entry.name || (stats && stats.player_name) || "");
      const playerPos = String((stats && stats.position) || entry.pos || slot.pos || "").toUpperCase().trim();
      const isMvp = Boolean(
        mvpKey && (
          (mvpKey.steam && profileSteamId && mvpKey.steam === profileSteamId) ||
          (mvpKey.name && playerNameNorm && mvpKey.name === playerNameNorm && (!mvpKey.pos || !playerPos || mvpKey.pos === playerPos))
        )
      );
      const nameNode = profileSteamId
        ? `<a class="pitch-player-name-link" href="player.html?steam_id=${encodeURIComponent(profileSteamId)}">${esc(truncateName(entry.name, 16))}</a>`
        : esc(truncateName(entry.name, 16));
      return `
        <div class="pitch-player ${isMvp ? "is-mvp" : ""}" style="left:${slot.x}%;top:${slot.y}%;">
          ${Number.isFinite(rating) ? `<div class="pitch-rating-chip">${esc(rating.toFixed(1))}</div>` : ""}
          <div class="pitch-jersey">${esc(entry.pos || slot.pos)}</div>
          <div class="pitch-player-name">${isMvp ? '<span class="mvp-badge" title="MVP">🏆</span>' : ""}${nameNode}</div>
          ${playerStatChips(stats)}
          ${playerHoverCardHtml(stats || entry, profileSteamId)}
        </div>
      `;
    }).join("");

    const overflowStarters = started.filter((_, idx) => !usedIndex.has(idx));
    const overflowHtml = overflowStarters.length
      ? `
        <div class="pitch-overflow">
          <span class="pitch-overflow-label">Extra starters:</span>
          ${overflowStarters.map((entry) => `
            <span class="pitch-overflow-chip">
              ${esc(entry.pos || "N/A")} - ${esc(truncateName(entry.name, 20))}
            </span>
          `).join("")}
        </div>
      `
      : "";

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
        ${overflowHtml}
      </article>
    `;
  }

  function computeMvp(allStats) {
    if (!allStats.length) return null;

    const scored = allStats.map((player) => {
      const rating = playerRating10(player);
      const tieBreak =
        pickNum(player, ["goals"]) * 4 +
        pickNum(player, ["assists"]) * 3 +
        pickNum(player, ["interceptions"]) +
        pickNum(player, ["keeper_saves", "keeperSaves"]);
      return { ...player, _rating: rating, _tieBreak: tieBreak };
    }).sort((a, b) => (b._rating - a._rating) || (b._tieBreak - a._tieBreak));

    return scored[0] || null;
  }

  function resolveMvp(allStats, apiMvp) {
    if (apiMvp && typeof apiMvp === "object") {
      const merged = { ...apiMvp };
      const targetName = normName(apiMvp.player_name || apiMvp.name || "");
      const targetPos = String(apiMvp.position || "").toUpperCase();
      if (targetName) {
        const linked = (allStats || []).find((player) => {
          const playerName = normName(player.player_name || player.name || "");
          if (!playerName || playerName !== targetName) return false;
          if (!targetPos) return true;
          return String(player.position || "").toUpperCase() === targetPos;
        });
        if (linked) Object.assign(merged, linked);
      }
      merged._rating = playerRating10(merged);
      return merged;
    }
    return computeMvp(allStats);
  }

  function mvpReason(player) {
    if (!player) return "No MVP data available for this match.";
    const mvpStats = normalizeMvpStats(player.mvp_stats || player.mvp_key_stats || player.stats);
    if (mvpStats.length) {
      return mvpStats.join(" | ");
    }
    const goals = Number(player.goals || 0);
    if (goals >= 3) return "Hat-trick performance.";
    if (goals > 0) return `${goals} goal${goals === 1 ? "" : "s"} in the match.`;
    return "Strong overall performance.";
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
    const rating = Number.isFinite(mvp._rating) ? mvp._rating : playerRating10(mvp);

    const mvpStats = [
      { label: "Goals", value: pickNum(mvp, ["goals"]) },
      { label: "Assists", value: pickNum(mvp, ["assists"]) },
      { label: "Saves", value: pickNum(mvp, ["keeper_saves", "keeperSaves"]) },
      { label: "Interceptions", value: pickNum(mvp, ["interceptions"]) },
      { label: "Tackles", value: pickNum(mvp, ["tackles", "sliding_tackles_completed", "slidingTacklesCompleted"]) },
      { label: "Key Passes", value: pickNum(mvp, ["key_passes", "keyPasses"]) }
    ].filter((item) => item.value > 0).slice(0, 6);

    const statsHtml = mvpStats.length
      ? mvpStats.map((item) => `
          <div class="mvp-stat">
            <strong>${esc(String(item.value))}</strong>
            <span>${esc(item.label)}</span>
          </div>
        `).join("")
      : `
          <div class="mvp-stat">
            <strong>0</strong>
            <span>Key stats</span>
          </div>
        `;

    return `
      <section class="mvp-widget">
        <img class="mvp-bg-bot" src="assets/icons/entrenador-icon.png" alt="">
        <div class="mvp-header">
          <div class="mvp-title">
            <img src="assets/icons/gold-medal-icon.png" alt="MVP medal">
            <span>MVP</span>
          </div>
          <div class="mvp-rating">${esc(rating.toFixed(1))}/10</div>
        </div>
        <div class="mvp-name"><span class="mvp-name-emoji">🏆</span>${esc(playerName)}</div>
        <div class="mvp-sub">${esc(position)}</div>
        <div class="mvp-reason">${esc(mvpReason(mvp))}</div>
        <div class="mvp-stats-grid">${statsHtml}</div>
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
      const apiHomeEvents = data.team_events && Array.isArray(data.team_events.home) ? data.team_events.home : [];
      const apiAwayEvents = data.team_events && Array.isArray(data.team_events.away) ? data.team_events.away : [];
      const homeEvents = attachEventRatings(apiHomeEvents.length ? apiHomeEvents : buildEventLines(homeStats), homeStats);
      const awayEvents = attachEventRatings(apiAwayEvents.length ? apiAwayEvents : buildEventLines(awayStats), awayStats);
      const hasEvents = homeEvents.length > 0 || awayEvents.length > 0;
      const homeDerived = teamDerivedMetrics(homeStats);
      const awayDerived = teamDerivedMetrics(awayStats);
      const showDerived = (
        homeDerived.clutch + awayDerived.clutch + homeDerived.subImpactEvents + awayDerived.subImpactEvents
      ) > 0;
      const comebackFlag = Boolean(match.comeback_flag);

      const homeLineup = parseLineupEntries(match.home_lineup || []);
      const awayLineup = parseLineupEntries(match.away_lineup || []);
      const homeLookup = buildStatsLookup(homeStats);
      const awayLookup = buildStatsLookup(awayStats);
      const mvp = resolveMvp(allStats, data.mvp || null);
      const mvpKey = mvpIdentity(mvp);

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
                ${comebackFlag ? '<span class="badge">COMEBACK</span>' : ""}
              </div>
            </div>

            <div class="match-side">
              ${teamLogo(match.away_team_icon, match.away_team_name || "Away")}
              <h2 class="match-team-name">${esc(match.away_team_name || "Away")}</h2>
            </div>
          </div>

          ${hasEvents ? `
          <div class="match-events-wrap">
            <div class="match-events-grid">
              <div class="match-events">${homeEvents.map(eventLineHtml).join("")}</div>
              <div class="match-events">${awayEvents.map(eventLineHtml).join("")}</div>
            </div>
          </div>
          ` : ""}

          <div class="match-bottom-meta">${esc(matchDate)}</div>
        </section>

        ${showDerived ? `
        <section class="derived-widget">
          <div class="derived-title">Derived Metrics</div>
          <div class="derived-subtitle">S/Sub/B = Started/Substitute/Bench, Clutch = decisive late actions, Sub impact = events right after substitutions.</div>
          <div class="match-events-grid">
            <div class="match-events">
              <div class="match-event-line"><span><strong>${esc((match.home_team_name || "Home") + ((match.home_team_name || "") === (match.away_team_name || "") ? " (Home)" : ""))}</strong></span></div>
              <div class="match-event-line"><span>S/Sub/B: ${esc(homeDerived.starts)}/${esc(homeDerived.subs)}/${esc(homeDerived.bench)}</span></div>
              <div class="match-event-line"><span>Clutch: ${esc(homeDerived.clutch)} | Sub impact: ${esc(homeDerived.subImpactEvents)}</span></div>
              <div class="match-event-line"><span>Sub G/OG: ${esc(homeDerived.subGoals)}/${esc(homeDerived.subOwnGoals)}</span></div>
            </div>
            <div class="match-events">
              <div class="match-event-line"><span><strong>${esc((match.away_team_name || "Away") + ((match.home_team_name || "") === (match.away_team_name || "") ? " (Away)" : ""))}</strong></span></div>
              <div class="match-event-line"><span>S/Sub/B: ${esc(awayDerived.starts)}/${esc(awayDerived.subs)}/${esc(awayDerived.bench)}</span></div>
              <div class="match-event-line"><span>Clutch: ${esc(awayDerived.clutch)} | Sub impact: ${esc(awayDerived.subImpactEvents)}</span></div>
              <div class="match-event-line"><span>Sub G/OG: ${esc(awayDerived.subGoals)}/${esc(awayDerived.subOwnGoals)}</span></div>
            </div>
          </div>
        </section>
        ` : ""}

        ${mvpWidgetHtml(mvp)}

        <section class="lineup-pitches">
          ${lineupCardHtml(match.home_team_name || "Home", match.home_team_icon, homeLineup, homeLookup, match.game_type, mvpKey)}
          ${lineupCardHtml(match.away_team_name || "Away", match.away_team_icon, awayLineup, awayLookup, match.game_type, mvpKey)}
        </section>
      `;
    } catch (err) {
      showError(`Failed to load match detail: ${err.message}`);
    }
  })();
})();
