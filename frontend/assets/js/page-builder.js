(async function () {
  const { renderLayout, byId, esc, fmtDate, showError } = window.HubUI;
  renderLayout("builder.html", "Lineup Builder");
  const page = byId("page");

  const STORAGE_KEY = "iosca_hub_lineup_builder_v1";
  const FALLBACK_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

  const FORMATS = {
    "4v4": {
      label: "4v4",
      subtitle: "Compact spine",
      benchSize: 6,
      slots: [
        { id: "gk", label: "GK", role: "gk", x: 50, y: 86, accept: ["GK"] },
        { id: "cb", label: "CB", role: "def", x: 50, y: 63, accept: ["CB", "DEF", "SW"] },
        { id: "cm", label: "CM", role: "mid", x: 50, y: 39, accept: ["CM", "MID", "CAM", "CDM"] },
        { id: "cf", label: "CF", role: "atk", x: 50, y: 17, accept: ["CF", "ST", "ATT"] }
      ]
    },
    "5v5": {
      label: "5v5",
      subtitle: "Wide control",
      benchSize: 7,
      slots: [
        { id: "gk", label: "GK", role: "gk", x: 50, y: 86, accept: ["GK"] },
        { id: "cb", label: "CB", role: "def", x: 50, y: 64, accept: ["CB", "DEF", "SW"] },
        { id: "lm", label: "LM", role: "mid", x: 22, y: 42, accept: ["LM", "LW", "CM", "MID"] },
        { id: "rm", label: "RM", role: "mid", x: 78, y: 42, accept: ["RM", "RW", "CM", "MID"] },
        { id: "cf", label: "CF", role: "atk", x: 50, y: 18, accept: ["CF", "ST", "ATT"] }
      ]
    },
    "6v6": {
      label: "6v6",
      subtitle: "Balanced press",
      benchSize: 7,
      slots: [
        { id: "gk", label: "GK", role: "gk", x: 50, y: 86, accept: ["GK"] },
        { id: "lb", label: "LB", role: "def", x: 22, y: 63, accept: ["LB", "LWB", "DEF"] },
        { id: "rb", label: "RB", role: "def", x: 78, y: 63, accept: ["RB", "RWB", "DEF"] },
        { id: "cm", label: "CM", role: "mid", x: 50, y: 43, accept: ["CM", "MID", "CAM", "CDM"] },
        { id: "lw", label: "LW", role: "atk", x: 24, y: 18, accept: ["LW", "LM", "ATT"] },
        { id: "rw", label: "RW", role: "atk", x: 76, y: 18, accept: ["RW", "RM", "ATT"] }
      ]
    },
    "8v8": {
      label: "8v8",
      subtitle: "Three-lane attack",
      benchSize: 8,
      slots: [
        { id: "gk", label: "GK", role: "gk", x: 50, y: 86, accept: ["GK"] },
        { id: "lb", label: "LB", role: "def", x: 16, y: 63, accept: ["LB", "LWB", "DEF"] },
        { id: "cb", label: "CB", role: "def", x: 50, y: 63, accept: ["CB", "DEF", "SW"] },
        { id: "rb", label: "RB", role: "def", x: 84, y: 63, accept: ["RB", "RWB", "DEF"] },
        { id: "cm", label: "CM", role: "mid", x: 50, y: 39, accept: ["CM", "MID", "CAM", "CDM"] },
        { id: "lw", label: "LW", role: "atk", x: 16, y: 18, accept: ["LW", "LM", "ATT"] },
        { id: "cf", label: "CF", role: "atk", x: 50, y: 18, accept: ["CF", "ST", "ATT"] },
        { id: "rw", label: "RW", role: "atk", x: 84, y: 18, accept: ["RW", "RM", "ATT"] }
      ]
    },
    "11v11": {
      label: "11v11",
      subtitle: "Classic 4-3-3",
      benchSize: 10,
      slots: [
        { id: "gk", label: "GK", role: "gk", x: 50, y: 88, accept: ["GK"] },
        { id: "lb", label: "LB", role: "def", x: 14, y: 68, accept: ["LB", "LWB", "DEF"] },
        { id: "lcb", label: "LCB", role: "def", x: 37, y: 71, accept: ["CB", "LB", "DEF"] },
        { id: "rcb", label: "RCB", role: "def", x: 63, y: 71, accept: ["CB", "RB", "DEF"] },
        { id: "rb", label: "RB", role: "def", x: 86, y: 68, accept: ["RB", "RWB", "DEF"] },
        { id: "lcm", label: "LCM", role: "mid", x: 28, y: 46, accept: ["CM", "LM", "MID", "CAM", "CDM"] },
        { id: "cm", label: "CM", role: "mid", x: 50, y: 41, accept: ["CM", "MID", "CAM", "CDM"] },
        { id: "rcm", label: "RCM", role: "mid", x: 72, y: 46, accept: ["CM", "RM", "MID", "CAM", "CDM"] },
        { id: "lw", label: "LW", role: "atk", x: 18, y: 19, accept: ["LW", "LM", "ATT"] },
        { id: "st", label: "ST", role: "atk", x: 50, y: 15, accept: ["ST", "CF", "ATT"] },
        { id: "rw", label: "RW", role: "atk", x: 82, y: 19, accept: ["RW", "RM", "ATT"] }
      ]
    }
  };

  const FORMAT_KEYS = Object.keys(FORMATS);
  const DEFAULT_FORMAT = "8v8";
  const ROLE_FILTERS = ["all", "atk", "mid", "def", "gk"];

  let allPlayers = [];
  let playersBySteam = new Map();
  let state = readState();

  renderLoading();

  try {
    const data = await window.HubApi.players({ limit: 3000 });
    allPlayers = (data.players || []).map(normalizePlayer).filter((player) => player.steamId);
    playersBySteam = new Map(allPlayers.map((player) => [player.steamId, player]));
    ensureStateIntegrity();
    render();
  } catch (err) {
    showError(`Failed to load lineup builder: ${err.message}`);
  }

  function renderLoading() {
    page.innerHTML = `
      <section class="builder-shell">
        <div class="players-empty-state">
          <div class="players-empty-icon">XI</div>
          <h3>Loading Builder</h3>
          <p>Preparing formations, squad slots, and player scouting data.</p>
        </div>
      </section>
    `;
  }

  function emptyFormatState(formatKey) {
    const format = FORMATS[formatKey];
    return {
      slots: Object.fromEntries(format.slots.map((slot) => [slot.id, null])),
      bench: new Array(format.benchSize).fill(null)
    };
  }

  function emptyLineups() {
    return Object.fromEntries(FORMAT_KEYS.map((formatKey) => [formatKey, emptyFormatState(formatKey)]));
  }

  function readState() {
    let parsed = null;
    try {
      parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (_) {
      parsed = null;
    }

    return {
      format: parsed && FORMATS[parsed.format] ? parsed.format : DEFAULT_FORMAT,
      search: parsed && typeof parsed.search === "string" ? parsed.search : "",
      roleFilter: parsed && ROLE_FILTERS.includes(parsed.roleFilter) ? parsed.roleFilter : "all",
      target: parsed && parsed.target ? parsed.target : null,
      lineups: parsed && parsed.lineups && typeof parsed.lineups === "object" ? parsed.lineups : emptyLineups()
    };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function defaultTarget(formatKey) {
    const slots = FORMATS[formatKey].slots;
    const preferred = slots.find((slot) => slot.role === "atk") || slots[0];
    return preferred ? { type: "slot", id: preferred.id } : null;
  }

  function ensureStateIntegrity() {
    if (!FORMATS[state.format]) state.format = DEFAULT_FORMAT;
    if (!ROLE_FILTERS.includes(state.roleFilter)) state.roleFilter = "all";
    if (typeof state.search !== "string") state.search = "";

    const nextLineups = emptyLineups();
    for (const formatKey of FORMAT_KEYS) {
      const source = state.lineups && state.lineups[formatKey] ? state.lineups[formatKey] : {};
      const format = FORMATS[formatKey];
      for (const slot of format.slots) {
        const steamId = String(source.slots && source.slots[slot.id] || "").trim();
        nextLineups[formatKey].slots[slot.id] = playersBySteam.size && playersBySteam.has(steamId) ? steamId : null;
      }
      const bench = Array.isArray(source.bench) ? source.bench : [];
      nextLineups[formatKey].bench = new Array(format.benchSize).fill(null).map((_, index) => {
        const steamId = String(bench[index] || "").trim();
        return playersBySteam.size && playersBySteam.has(steamId) ? steamId : null;
      });
      dedupeLineup(nextLineups[formatKey], formatKey);
    }
    state.lineups = nextLineups;

    if (!isValidTarget(state.target, state.format)) {
      state.target = defaultTarget(state.format);
    }
    saveState();
  }

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function roleLabelFromKey(roleKey) {
    const key = String(roleKey || "").trim().toLowerCase();
    if (key === "atk") return "ATK";
    if (key === "mid") return "MID";
    if (key === "def") return "DEF";
    if (key === "gk") return "GK";
    return "N/A";
  }

  function deriveRoleKey(position, mainRole) {
    const role = String(mainRole || "").trim().toUpperCase();
    if (role) return role.toLowerCase();

    const pos = String(position || "").trim().toUpperCase();
    if (pos === "GK") return "gk";
    if (["LB", "RB", "CB", "SW", "LWB", "RWB", "DEF", "LCB", "RCB"].includes(pos)) return "def";
    if (["LM", "RM", "CM", "LCM", "RCM", "CDM", "CAM", "MID"].includes(pos)) return "mid";
    if (["LW", "RW", "CF", "ST", "ATT"].includes(pos)) return "atk";
    return "other";
  }

  function normalizePlayer(raw) {
    const name = String(raw.discord_name || raw.steam_name || raw.player_name || raw.steam_id || "Unknown").trim();
    const position = String(raw.position || "N/A").trim().toUpperCase() || "N/A";
    const roleKey = deriveRoleKey(position, raw.main_role);
    const rating = Number.isFinite(Number(raw.rating)) ? Number(raw.rating) : null;
    const currentTeamName = String(raw.current_team_name || "").trim();
    const avatarUrl = raw.display_avatar_url || raw.steam_avatar_url || raw.avatar_url || FALLBACK_AVATAR;

    return {
      steamId: String(raw.steam_id || "").trim(),
      name,
      position,
      roleKey,
      roleLabel: roleLabelFromKey(roleKey),
      rating,
      currentTeamName,
      currentTeamIcon: raw.current_team_icon || "",
      avatarUrl,
      appearances: Math.max(0, Math.round(num(raw.total_appearances))),
      lastMatchAt: raw.last_match_at || raw.last_active || null,
      registeredAt: raw.registered_at || null,
      steamProfileUrl: raw.steam_profile_url || "",
      searchBlob: [
        name,
        raw.steam_name,
        raw.steam_id,
        position,
        roleKey,
        currentTeamName
      ].join(" ").toLowerCase()
    };
  }

  function currentFormat() {
    return FORMATS[state.format];
  }

  function currentLineup() {
    return state.lineups[state.format];
  }

  function isValidTarget(target, formatKey) {
    if (!target || typeof target !== "object") return false;
    if (target.type === "slot") {
      return FORMATS[formatKey].slots.some((slot) => slot.id === target.id);
    }
    if (target.type === "bench") {
      return Number.isInteger(target.index) && target.index >= 0 && target.index < FORMATS[formatKey].benchSize;
    }
    return false;
  }

  function sameLocation(left, right) {
    if (!left || !right) return false;
    if (left.type !== right.type) return false;
    if (left.type === "slot") return left.id === right.id;
    return left.index === right.index;
  }

  function getLocationValue(lineup, location) {
    if (!location || !lineup) return null;
    if (location.type === "slot") return lineup.slots[location.id] || null;
    if (location.type === "bench") return lineup.bench[location.index] || null;
    return null;
  }

  function setLocationValue(lineup, location, steamId) {
    const nextValue = steamId ? String(steamId) : null;
    if (location.type === "slot") lineup.slots[location.id] = nextValue;
    if (location.type === "bench") lineup.bench[location.index] = nextValue;
  }

  function findPlayerLocation(lineup, steamId) {
    if (!lineup || !steamId) return null;
    for (const [slotId, value] of Object.entries(lineup.slots || {})) {
      if (value === steamId) return { type: "slot", id: slotId };
    }
    for (let index = 0; index < (lineup.bench || []).length; index += 1) {
      if (lineup.bench[index] === steamId) return { type: "bench", index };
    }
    return null;
  }

  function dedupeLineup(lineup, formatKey) {
    const seen = new Set();
    for (const slot of FORMATS[formatKey].slots) {
      const steamId = lineup.slots[slot.id];
      if (!steamId || seen.has(steamId)) {
        lineup.slots[slot.id] = null;
      } else {
        seen.add(steamId);
      }
    }
    lineup.bench = lineup.bench.map((steamId) => {
      if (!steamId || seen.has(steamId)) return null;
      seen.add(steamId);
      return steamId;
    });
  }

  function swapLocations(source, target) {
    if (!isValidTarget(source, state.format) || !isValidTarget(target, state.format) || sameLocation(source, target)) return;
    const lineup = currentLineup();
    const sourceValue = getLocationValue(lineup, source);
    if (!sourceValue) return;
    const targetValue = getLocationValue(lineup, target);
    setLocationValue(lineup, source, targetValue);
    setLocationValue(lineup, target, sourceValue);
    dedupeLineup(lineup, state.format);
    state.target = target;
    saveState();
    render();
  }

  function firstEmptyBenchIndex(lineup) {
    return lineup.bench.findIndex((value) => !value);
  }

  function assignPlayerToTarget(steamId) {
    const normalizedSteamId = String(steamId || "").trim();
    if (!normalizedSteamId || !playersBySteam.has(normalizedSteamId) || !isValidTarget(state.target, state.format)) return;
    const lineup = currentLineup();
    const target = state.target;
    const existingLocation = findPlayerLocation(lineup, normalizedSteamId);

    if (existingLocation) {
      if (sameLocation(existingLocation, target)) return;
      swapLocations(existingLocation, target);
      return;
    }

    const displaced = getLocationValue(lineup, target);
    setLocationValue(lineup, target, normalizedSteamId);
    if (target.type === "slot" && displaced) {
      const emptyBenchIndex = firstEmptyBenchIndex(lineup);
      if (emptyBenchIndex >= 0) {
        lineup.bench[emptyBenchIndex] = displaced;
      }
    }
    dedupeLineup(lineup, state.format);
    saveState();
    render();
  }

  function clearLocation(location) {
    if (!isValidTarget(location, state.format)) return;
    setLocationValue(currentLineup(), location, null);
    saveState();
    render();
  }

  function clearFormat(formatKey) {
    state.lineups[formatKey] = emptyFormatState(formatKey);
    state.target = defaultTarget(formatKey);
    if (state.format !== formatKey) state.format = formatKey;
    saveState();
    render();
  }

  function clearAllLineups() {
    state.lineups = emptyLineups();
    state.target = defaultTarget(state.format);
    saveState();
    render();
  }

  function compareByRating(left, right) {
    const leftRating = Number.isFinite(left.rating) ? left.rating : -1;
    const rightRating = Number.isFinite(right.rating) ? right.rating : -1;
    return rightRating - leftRating || left.name.localeCompare(right.name);
  }

  function fitScore(player, slot) {
    if (!slot) return (Number.isFinite(player.rating) ? player.rating : 0) * 10;
    const position = player.position;
    const accepts = slot.accept || [slot.label];
    const roleMatch = player.roleKey === slot.role;
    let score = (Number.isFinite(player.rating) ? player.rating : 0) * 10;
    if (accepts.includes(position)) score += 400;
    else if (slot.role === "mid" && ["LM", "RM", "CAM", "CDM"].includes(position)) score += 250;
    else if (slot.role === "def" && ["LB", "RB", "CB", "DEF", "LWB", "RWB"].includes(position)) score += 250;
    else if (slot.role === "atk" && ["LW", "RW", "CF", "ST", "ATT"].includes(position)) score += 250;
    else if (roleMatch) score += 180;
    else if (slot.role !== "gk" && player.roleKey !== "gk") score += 40;
    return score;
  }

  function autofillCurrentFormat() {
    const format = currentFormat();
    const lineup = currentLineup();
    const used = new Set(Object.values(lineup.slots).filter(Boolean).concat(lineup.bench.filter(Boolean)));

    for (const slot of format.slots) {
      if (lineup.slots[slot.id]) continue;
      const candidate = allPlayers
        .filter((player) => !used.has(player.steamId))
        .sort((left, right) => fitScore(right, slot) - fitScore(left, slot) || compareByRating(left, right))[0];
      if (candidate) {
        lineup.slots[slot.id] = candidate.steamId;
        used.add(candidate.steamId);
      }
    }

    for (let index = 0; index < lineup.bench.length; index += 1) {
      if (lineup.bench[index]) continue;
      const candidate = allPlayers.filter((player) => !used.has(player.steamId)).sort(compareByRating)[0];
      if (!candidate) break;
      lineup.bench[index] = candidate.steamId;
      used.add(candidate.steamId);
    }

    dedupeLineup(lineup, state.format);
    saveState();
    render();
  }

  function exportLineup() {
    const format = currentFormat();
    const lineup = currentLineup();
    const starters = format.slots.map((slot) => {
      const player = playersBySteam.get(lineup.slots[slot.id]);
      return `${slot.label}: ${player ? player.name : "-"}`;
    });
    const bench = lineup.bench
      .map((steamId) => playersBySteam.get(steamId))
      .filter(Boolean)
      .map((player) => player.name);

    const payload = [
      `${format.label} Lineup`,
      `${format.subtitle}`,
      "",
      "Starters",
      ...starters,
      "",
      `Bench: ${bench.length ? bench.join(", ") : "-"}`
    ].join("\n");

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload).catch(() => {});
    }
    window.alert("Lineup copied to clipboard if your browser allowed it.");
  }

  function setFormat(formatKey) {
    if (!FORMATS[formatKey]) return;
    state.format = formatKey;
    if (!isValidTarget(state.target, formatKey)) state.target = defaultTarget(formatKey);
    saveState();
    render();
  }

  function setTarget(location) {
    if (!isValidTarget(location, state.format)) return;
    state.target = location;
    saveState();
    render();
  }

  function playerCount(lineup) {
    const starters = Object.values(lineup.slots).filter(Boolean).length;
    const bench = lineup.bench.filter(Boolean).length;
    return { starters, bench };
  }

  function avgRating(lineup) {
    const ratings = Object.values(lineup.slots)
      .map((steamId) => playersBySteam.get(steamId))
      .filter(Boolean)
      .map((player) => player.rating)
      .filter((rating) => Number.isFinite(rating));
    if (!ratings.length) return null;
    return ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
  }

  function representedTeams(lineup) {
    const teams = new Set();
    const steamIds = Object.values(lineup.slots).concat(lineup.bench);
    for (const steamId of steamIds) {
      const player = playersBySteam.get(steamId);
      if (player && player.currentTeamName) teams.add(player.currentTeamName);
    }
    return teams.size;
  }

  function targetSlot() {
    if (!state.target || state.target.type !== "slot") return null;
    return currentFormat().slots.find((slot) => slot.id === state.target.id) || null;
  }

  function assignedBadge(player) {
    const location = findPlayerLocation(currentLineup(), player.steamId);
    if (!location) return "";
    if (location.type === "slot") {
      const slot = currentFormat().slots.find((item) => item.id === location.id);
      return `<span class="builder-result-badge assigned">In ${esc(slot ? slot.label : "XI")}</span>`;
    }
    return `<span class="builder-result-badge assigned">Bench ${esc(location.index + 1)}</span>`;
  }

  function scoutPlayers() {
    const search = state.search.trim().toLowerCase();
    const slot = targetSlot();
    return allPlayers
      .filter((player) => !search || player.searchBlob.includes(search))
      .filter((player) => state.roleFilter === "all" || player.roleKey === state.roleFilter)
      .sort((left, right) => {
        const fit = fitScore(right, slot) - fitScore(left, slot);
        if (fit !== 0) return fit;
        return compareByRating(left, right);
      })
      .slice(0, 48);
  }

  function targetTitleHtml() {
    if (!state.target) return "Select a slot";
    if (state.target.type === "bench") return `Assigning to Bench ${state.target.index + 1}`;
    const slot = targetSlot();
    return slot ? `Assigning to ${slot.label}` : "Select a slot";
  }

  function summaryWidgetsHtml() {
    const lineup = currentLineup();
    const counts = playerCount(lineup);
    const average = avgRating(lineup);
    const teams = representedTeams(lineup);

    return `
      <div class="builder-summary-grid">
        <div class="builder-summary-card">
          <span>Starters</span>
          <strong>${esc(counts.starters)}/${esc(currentFormat().slots.length)}</strong>
        </div>
        <div class="builder-summary-card">
          <span>Bench</span>
          <strong>${esc(counts.bench)}/${esc(currentFormat().benchSize)}</strong>
        </div>
        <div class="builder-summary-card">
          <span>Avg Rating</span>
          <strong>${esc(average !== null ? average.toFixed(2) : "N/A")}</strong>
        </div>
        <div class="builder-summary-card">
          <span>Teams Used</span>
          <strong>${esc(teams)}</strong>
        </div>
      </div>
    `;
  }

  function positionCardHtml(slot) {
    const lineup = currentLineup();
    const player = playersBySteam.get(lineup.slots[slot.id]);
    const selected = state.target && sameLocation(state.target, { type: "slot", id: slot.id });
    const roleLabel = roleLabelFromKey(slot.role);

    return `
      <div class="builder-slot ${player ? "occupied" : "empty"} ${selected ? "selected" : ""}" style="left:${slot.x}%;top:${slot.y}%;">
        <button
          class="builder-slot-card"
          type="button"
          data-target-type="slot"
          data-slot-id="${esc(slot.id)}"
          draggable="${player ? "true" : "false"}"
          data-drag-type="${player ? "slot" : ""}"
          data-drag-id="${player ? esc(slot.id) : ""}"
        >
          ${player ? `
            <div class="builder-slot-top">
              <span class="builder-slot-rating">${esc(Number.isFinite(player.rating) ? player.rating.toFixed(2) : "N/A")}</span>
              <span class="builder-slot-position">${esc(slot.label)}</span>
            </div>
            <img class="builder-slot-avatar" src="${esc(player.avatarUrl)}" alt="${esc(player.name)}">
            <strong>${esc(player.name)}</strong>
            <span>${esc(player.currentTeamName || player.position)}</span>
          ` : `
            <div class="builder-slot-empty-mark">${esc(slot.label)}</div>
            <strong>${esc(roleLabel)}</strong>
            <span>Click to scout</span>
          `}
        </button>
        ${player ? `<button class="builder-slot-remove" type="button" data-clear-type="slot" data-slot-id="${esc(slot.id)}" aria-label="Remove ${esc(player.name)}">x</button>` : ""}
      </div>
    `;
  }

  function benchCardHtml(index) {
    const lineup = currentLineup();
    const steamId = lineup.bench[index];
    const player = playersBySteam.get(steamId);
    const selected = state.target && sameLocation(state.target, { type: "bench", index });
    return `
      <button
        class="builder-bench-card ${player ? "occupied" : "empty"} ${selected ? "selected" : ""}"
        type="button"
        data-target-type="bench"
        data-bench-index="${esc(index)}"
        draggable="${player ? "true" : "false"}"
        data-drag-type="${player ? "bench" : ""}"
        data-drag-index="${player ? esc(index) : ""}"
      >
        <span class="builder-bench-label">Bench ${esc(index + 1)}</span>
        ${player ? `
          <div class="builder-bench-main">
            <img src="${esc(player.avatarUrl)}" alt="${esc(player.name)}">
            <div>
              <strong>${esc(player.name)}</strong>
              <span>${esc(player.position)} | ${esc(Number.isFinite(player.rating) ? player.rating.toFixed(2) : "N/A")}</span>
            </div>
          </div>
        ` : `<span class="builder-bench-empty">Open slot</span>`}
      </button>
    `;
  }

  function resultCardHtml(player) {
    const slot = targetSlot();
    const fitLabel = !slot
      ? "Scout"
      : (slot.accept || []).includes(player.position)
        ? "Perfect Fit"
        : player.roleKey === slot.role
          ? "Role Fit"
          : "Wildcard";

    return `
      <article class="builder-result-card">
        <img class="builder-result-avatar" src="${esc(player.avatarUrl)}" alt="${esc(player.name)}">
        <div class="builder-result-body">
          <div class="builder-result-head">
            <strong>${esc(player.name)}</strong>
            <span>${esc(Number.isFinite(player.rating) ? player.rating.toFixed(2) : "N/A")}</span>
          </div>
          <div class="builder-result-sub">${esc(player.currentTeamName || "No current team")}</div>
          <div class="builder-result-tags">
            <span class="builder-result-badge">${esc(player.position)}</span>
            <span class="builder-result-badge">${esc(player.roleLabel)}</span>
            ${slot ? `<span class="builder-result-badge fit">${esc(fitLabel)}</span>` : ""}
            ${assignedBadge(player)}
          </div>
          <div class="builder-result-meta">
            <span>${esc(player.appearances)} apps</span>
            <span>${esc(player.lastMatchAt ? fmtDate(player.lastMatchAt) : "No recent match")}</span>
          </div>
        </div>
        <button class="builder-result-action" type="button" data-assign-steam="${esc(player.steamId)}" title="Assign player">
          ${slot ? `Use ${esc(slot.label)}` : "Add"}
        </button>
      </article>
    `;
  }

  function render() {
    const activeElement = document.activeElement;
    const shouldRestoreSearch = activeElement && activeElement.id === "builder-search-input";
    const selectionStart = shouldRestoreSearch ? activeElement.selectionStart : null;
    const selectionEnd = shouldRestoreSearch ? activeElement.selectionEnd : null;
    const format = currentFormat();
    const results = scoutPlayers();

    page.innerHTML = `
      <section class="builder-shell">
        <div class="builder-toolbar">
          <div>
            <div class="players-section-kicker">SQUAD LAB</div>
            <h2 class="players-section-title">Build Your Own ${esc(format.label)} XI</h2>
            <p class="players-section-copy">Pick a format, click a role on the pitch, search players, and drag cards between the XI and the bench like a squad board.</p>
          </div>
          <div class="builder-format-row">
            ${FORMAT_KEYS.map((formatKey) => `
              <button class="builder-format-pill ${formatKey === state.format ? "active" : ""}" type="button" data-format="${esc(formatKey)}">
                <strong>${esc(FORMATS[formatKey].label)}</strong>
                <span>${esc(FORMATS[formatKey].subtitle)}</span>
              </button>
            `).join("")}
          </div>
          ${summaryWidgetsHtml()}
        </div>

        <div class="builder-grid">
          <aside class="builder-panel builder-panel-left">
            <div class="builder-panel-head">
              <div>
                <div class="builder-panel-kicker">Format Notes</div>
                <h3>${esc(format.label)} Shape</h3>
              </div>
            </div>
            <p class="builder-panel-copy">${esc(format.subtitle)}. Click any slot to target it, then scout players from the right panel. Drag occupied slots to swap players instantly.</p>
            <div class="builder-target-card">
              <span class="builder-target-kicker">Current Target</span>
              <strong>${targetTitleHtml()}</strong>
              <small>${state.target && state.target.type === "slot" ? "Search results are ranked by fit for this role." : "Pick a bench card to stash utility players and late subs."}</small>
            </div>
            <div class="builder-action-stack">
              <button class="player-browser-action primary" type="button" id="builder-autofill">Autofill Empty Slots</button>
              <button class="player-browser-action" type="button" id="builder-copy">Copy Lineup</button>
              <button class="player-browser-action" type="button" id="builder-clear-format">Clear ${esc(format.label)}</button>
              <button class="player-browser-action" type="button" id="builder-clear-all">Clear All Formats</button>
            </div>
          </aside>

          <section class="builder-stage">
            <div class="builder-stage-head">
              <div>
                <div class="builder-panel-kicker">Pitch View</div>
                <h3>${esc(format.label)} Matchday Board</h3>
              </div>
              <div class="builder-stage-note">Drag starters onto each other to swap. Bench cards work the same way.</div>
            </div>
            <div class="builder-pitch">
              <div class="builder-pitch-line mid"></div>
              <div class="builder-pitch-circle"></div>
              <div class="builder-pitch-box top"></div>
              <div class="builder-pitch-box bottom"></div>
              <div class="builder-pitch-goal top"></div>
              <div class="builder-pitch-goal bottom"></div>
              ${format.slots.map(positionCardHtml).join("")}
            </div>
            <div class="builder-bench-wrap">
              <div class="builder-bench-head">
                <div>
                  <div class="builder-panel-kicker">Bench</div>
                  <h3>Substitutes</h3>
                </div>
                <div class="builder-stage-note">${esc(format.benchSize)} slots saved for this format.</div>
              </div>
              <div class="builder-bench-grid">
                ${new Array(format.benchSize).fill(null).map((_, index) => benchCardHtml(index)).join("")}
              </div>
            </div>
          </section>

          <aside class="builder-panel builder-panel-right">
            <div class="builder-panel-head">
              <div>
                <div class="builder-panel-kicker">Scout Players</div>
                <h3>${targetTitleHtml()}</h3>
              </div>
            </div>
            <div class="builder-scout-controls">
              <label class="players-search-shell builder-search-shell">
                <input id="builder-search-input" type="search" placeholder="Search players, teams, positions..." value="${esc(state.search)}">
              </label>
              <div class="builder-role-filter">
                ${ROLE_FILTERS.map((roleKey) => `
                  <button class="builder-role-pill ${state.roleFilter === roleKey ? "active" : ""}" type="button" data-role-filter="${esc(roleKey)}">
                    ${esc(roleKey === "all" ? "All" : roleLabelFromKey(roleKey))}
                  </button>
                `).join("")}
              </div>
            </div>
            <div class="builder-results-meta">
              <span>${esc(results.length)} players shown</span>
              <span>${state.search ? `Search: ${esc(state.search)}` : "Sorted by fit and rating"}</span>
            </div>
            <div class="builder-results-list">
              ${results.length ? results.map(resultCardHtml).join("") : `
                <div class="players-empty-state">
                  <div class="players-empty-icon">?</div>
                  <h3>No Matches</h3>
                  <p>Try a broader search or switch the role filter.</p>
                </div>
              `}
            </div>
          </aside>
        </div>
      </section>
    `;

    bindEvents();

    if (shouldRestoreSearch) {
      const input = byId("builder-search-input");
      if (input) {
        input.focus({ preventScroll: true });
        if (selectionStart !== null && selectionEnd !== null) {
          input.setSelectionRange(selectionStart, selectionEnd);
        }
      }
    }
  }

  function bindEvents() {
    page.querySelectorAll("[data-format]").forEach((button) => {
      button.addEventListener("click", () => setFormat(button.dataset.format));
    });

    page.querySelectorAll("[data-role-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.roleFilter = button.dataset.roleFilter;
        saveState();
        render();
      });
    });

    const searchInput = byId("builder-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        state.search = searchInput.value;
        saveState();
        render();
      });
    }

    page.querySelectorAll("[data-target-type]").forEach((node) => {
      node.addEventListener("click", () => {
        const type = node.dataset.targetType;
        if (type === "slot") setTarget({ type: "slot", id: node.dataset.slotId });
        if (type === "bench") setTarget({ type: "bench", index: Number(node.dataset.benchIndex) });
      });

      node.addEventListener("dragstart", (event) => {
        const dragType = node.dataset.dragType;
        if (!dragType) {
          event.preventDefault();
          return;
        }
        const payload = dragType === "slot"
          ? { type: "slot", id: node.dataset.dragId }
          : { type: "bench", index: Number(node.dataset.dragIndex) };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/json", JSON.stringify(payload));
      });

      node.addEventListener("dragover", (event) => {
        event.preventDefault();
        node.classList.add("is-drop-target");
      });

      node.addEventListener("dragleave", () => {
        node.classList.remove("is-drop-target");
      });

      node.addEventListener("drop", (event) => {
        event.preventDefault();
        node.classList.remove("is-drop-target");
        try {
          const source = JSON.parse(event.dataTransfer.getData("application/json") || "null");
          const target = node.dataset.targetType === "slot"
            ? { type: "slot", id: node.dataset.slotId }
            : { type: "bench", index: Number(node.dataset.benchIndex) };
          swapLocations(source, target);
        } catch (_) {}
      });
    });

    page.querySelectorAll("[data-clear-type]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const location = button.dataset.clearType === "slot"
          ? { type: "slot", id: button.dataset.slotId }
          : { type: "bench", index: Number(button.dataset.benchIndex) };
        clearLocation(location);
      });
    });

    page.querySelectorAll("[data-assign-steam]").forEach((button) => {
      button.addEventListener("click", () => assignPlayerToTarget(button.dataset.assignSteam));
    });

    const autofill = byId("builder-autofill");
    if (autofill) autofill.addEventListener("click", autofillCurrentFormat);

    const copy = byId("builder-copy");
    if (copy) copy.addEventListener("click", exportLineup);

    const clearFormatButton = byId("builder-clear-format");
    if (clearFormatButton) clearFormatButton.addEventListener("click", () => clearFormat(state.format));

    const clearAllButton = byId("builder-clear-all");
    if (clearAllButton) clearAllButton.addEventListener("click", clearAllLineups);
  }
})();
