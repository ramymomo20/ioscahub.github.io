(async function () {
  const { renderLayout, byId, esc, fmtDate, showError } = window.HubUI;
  renderLayout("players.html", "Players");
  const page = byId("page");
  const fallbackAvatar = "https://cdn.discordapp.com/embed/avatars/0.png";

  const DEFAULT_STATE = {
    search: "",
    sort: "rating",
    dir: "desc",
    role: "all",
    team: "all",
    activity: "all",
    view: "grid",
  };

  const SORT_OPTIONS = new Set(["rating", "name", "position", "lastActive", "registered"]);
  const DIRECTION_OPTIONS = new Set(["asc", "desc"]);
  const ACTIVITY_OPTIONS = new Set(["all", "hot", "active", "quiet", "inactive", "unknown"]);
  const ACTIVITY_LABELS = {
    hot: "Hot",
    active: "Active",
    quiet: "Quiet",
    inactive: "Inactive",
    unknown: "Unknown",
  };
  const SORT_LABELS = {
    rating: "rating",
    name: "name",
    position: "position",
    lastActive: "last active",
    registered: "registration date",
  };

  let allPlayers = [];
  let roleOptions = [];
  let teamOptions = [];
  let state = readState();

  renderLoading();

  try {
    const data = await window.HubApi.players({ limit: 3000 });
    allPlayers = (data.players || []).map(normalizePlayer);
    roleOptions = buildRoleOptions(allPlayers);
    teamOptions = buildTeamOptions(allPlayers);
    if (state.role !== "all" && !roleOptions.includes(state.role)) state.role = "all";
    if (state.team !== "all" && !teamOptions.includes(state.team)) state.team = "all";
    render();
  } catch (err) {
    showError(`Failed to load players: ${err.message}`);
  }

  function readState() {
    const params = new URLSearchParams(window.location.search);
    const next = { ...DEFAULT_STATE };

    next.search = String(params.get("search") || "").trim();
    next.sort = SORT_OPTIONS.has(params.get("sort")) ? params.get("sort") : DEFAULT_STATE.sort;
    next.dir = DIRECTION_OPTIONS.has(params.get("dir")) ? params.get("dir") : DEFAULT_STATE.dir;
    next.role = String(params.get("role") || DEFAULT_STATE.role).trim() || DEFAULT_STATE.role;
    next.team = String(params.get("team") || DEFAULT_STATE.team).trim() || DEFAULT_STATE.team;
    next.activity = ACTIVITY_OPTIONS.has(params.get("activity")) ? params.get("activity") : DEFAULT_STATE.activity;
    next.view = params.get("view") === "list" ? "list" : DEFAULT_STATE.view;
    return next;
  }

  function syncStateToUrl() {
    const params = new URLSearchParams();
    if (state.search) params.set("search", state.search);
    if (state.sort !== DEFAULT_STATE.sort) params.set("sort", state.sort);
    if (state.dir !== DEFAULT_STATE.dir) params.set("dir", state.dir);
    if (state.role !== DEFAULT_STATE.role) params.set("role", state.role);
    if (state.team !== DEFAULT_STATE.team) params.set("team", state.team);
    if (state.activity !== DEFAULT_STATE.activity) params.set("activity", state.activity);
    if (state.view !== DEFAULT_STATE.view) params.set("view", state.view);
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }

  function buildRoleOptions(players) {
    const set = new Set();
    for (const player of players) {
      if (player.roleKey && player.roleKey !== "other") set.add(player.roleKey);
    }
    return ["atk", "mid", "def", "gk", ...Array.from(set).filter((value) => !["atk", "mid", "def", "gk"].includes(value)).sort()];
  }

  function buildTeamOptions(players) {
    const map = new Map();
    for (const player of players) {
      if (!player.currentTeamName) continue;
      const key = player.currentTeamName.toLowerCase();
      if (!map.has(key)) map.set(key, player.currentTeamName);
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
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
    return key ? key.toUpperCase() : "N/A";
  }

  function deriveRoleKey(position, mainRole) {
    const role = String(mainRole || "").trim().toUpperCase();
    if (role) return role.toLowerCase();

    const pos = String(position || "").trim().toUpperCase();
    if (pos === "GK") return "gk";
    if (["LB", "RB", "CB", "SW", "LWB", "RWB", "DEF"].includes(pos)) return "def";
    if (["LM", "RM", "CM", "CDM", "CAM", "MID"].includes(pos)) return "mid";
    if (["LW", "RW", "CF", "ST", "ATT"].includes(pos)) return "atk";
    return "other";
  }

  function normalizePlayer(raw) {
    const name = String(raw.discord_name || raw.steam_name || raw.player_name || raw.steam_id || "Unknown").trim();
    const steamName = String(raw.steam_name || "").trim();
    const position = String(raw.position || "N/A").trim().toUpperCase() || "N/A";
    const roleKey = deriveRoleKey(position, raw.main_role);
    const roleLabel = roleLabelFromKey(roleKey);
    const currentTeamName = String(raw.current_team_name || "").trim();
    const lastMatchAt = raw.last_match_at || raw.last_active || null;
    const activityKey = getActivityKey(lastMatchAt);

    return {
      ...raw,
      name,
      steamName,
      position,
      roleKey,
      roleLabel,
      ratingValue: Number.isFinite(Number(raw.rating)) ? Number(raw.rating) : null,
      appearances: Math.max(0, Math.round(num(raw.total_appearances))),
      minutes: Math.max(0, Math.round(num(raw.total_minutes))),
      currentTeamName,
      currentTeamIcon: raw.current_team_icon || "",
      lastMatchAt,
      activityKey,
      searchBlob: [
        name,
        steamName,
        raw.steam_id,
        position,
        roleLabel,
        currentTeamName,
      ].join(" ").toLowerCase(),
    };
  }

  function getDaysSince(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const now = Date.now();
    const diffMs = Math.max(0, now - date.getTime());
    return Math.floor(diffMs / 86400000);
  }

  function getActivityKey(value) {
    const days = getDaysSince(value);
    if (days === null) return "unknown";
    if (days <= 14) return "hot";
    if (days <= 30) return "active";
    if (days <= 90) return "quiet";
    return "inactive";
  }

  function formatRelativeDate(value) {
    const days = getDaysSince(value);
    if (days === null) return "No activity";
    if (days === 0) return "Today";
    if (days === 1) return "1 day ago";
    if (days < 30) return `${days} days ago`;
    if (days < 365) {
      const months = Math.floor(days / 30);
      return `${months} ${months === 1 ? "month" : "months"} ago`;
    }
    const years = Math.floor(days / 365);
    return `${years} ${years === 1 ? "year" : "years"} ago`;
  }

  function formatActivityPill(player) {
    const value = ACTIVITY_LABELS[player.activityKey] || "Unknown";
    const detail = player.lastMatchAt ? formatRelativeDate(player.lastMatchAt) : "No match history";
    return `
      <span class="players-activity-pill ${esc(player.activityKey)}" title="Last match: ${esc(player.lastMatchAt ? fmtDate(player.lastMatchAt) : "N/A")}">
        <span class="players-activity-dot"></span>
        ${esc(value)} &middot; ${esc(detail)}
      </span>
    `;
  }

  function formatRating(value) {
    return Number.isFinite(value) ? value.toFixed(2) : "N/A";
  }

  function formatMinutes(value) {
    const total = Math.max(0, Math.round(num(value)));
    if (!total) return "0m";
    if (total < 60) return `${total}m`;
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  function matchesSearch(player) {
    if (!state.search) return true;
    return player.searchBlob.includes(state.search.toLowerCase());
  }

  function matchesRole(player) {
    if (state.role === "all") return true;
    return player.roleKey === state.role;
  }

  function matchesTeam(player) {
    if (state.team === "all") return true;
    return player.currentTeamName === state.team;
  }

  function matchesActivity(player) {
    if (state.activity === "all") return true;
    return player.activityKey === state.activity;
  }

  function comparePlayers(left, right) {
    const direction = state.dir === "asc" ? 1 : -1;

    if (state.sort === "name") {
      return direction * left.name.localeCompare(right.name);
    }

    if (state.sort === "position") {
      const positionCompare = left.position.localeCompare(right.position);
      if (positionCompare !== 0) return direction * positionCompare;
      return direction * left.name.localeCompare(right.name);
    }

    if (state.sort === "lastActive") {
      const leftDays = getDaysSince(left.lastMatchAt);
      const rightDays = getDaysSince(right.lastMatchAt);
      const leftValue = leftDays === null ? Number.POSITIVE_INFINITY : leftDays;
      const rightValue = rightDays === null ? Number.POSITIVE_INFINITY : rightDays;
      if (leftValue !== rightValue) return direction * (leftValue - rightValue);
      return left.name.localeCompare(right.name);
    }

    if (state.sort === "registered") {
      const leftTime = left.registered_at ? new Date(left.registered_at).getTime() : 0;
      const rightTime = right.registered_at ? new Date(right.registered_at).getTime() : 0;
      if (leftTime !== rightTime) return direction * (leftTime - rightTime);
      return left.name.localeCompare(right.name);
    }

    const leftRating = Number.isFinite(left.ratingValue) ? left.ratingValue : -999;
    const rightRating = Number.isFinite(right.ratingValue) ? right.ratingValue : -999;
    if (leftRating !== rightRating) return direction * (leftRating - rightRating);
    return left.name.localeCompare(right.name);
  }

  function filteredPlayers() {
    return allPlayers
      .filter(matchesSearch)
      .filter(matchesRole)
      .filter(matchesTeam)
      .filter(matchesActivity)
      .sort(comparePlayers);
  }

  function summaryMetrics(players) {
    const visible = players.length;
    const ratedPlayers = players.filter((player) => Number.isFinite(player.ratingValue));
    const averageRating = ratedPlayers.length
      ? ratedPlayers.reduce((sum, player) => sum + player.ratingValue, 0) / ratedPlayers.length
      : 0;
    const representedTeams = new Set(players.map((player) => player.currentTeamName).filter(Boolean)).size;
    const recentActive = players.filter((player) => ["hot", "active"].includes(player.activityKey)).length;

    return {
      visible,
      averageRating,
      representedTeams,
      recentActive,
    };
  }

  function activeFilterChips() {
    const chips = [];
    if (state.search) chips.push({ key: "search", label: `Search: ${state.search}` });
    if (state.role !== "all") chips.push({ key: "role", label: `Role: ${roleLabelFromKey(state.role)}` });
    if (state.team !== "all") chips.push({ key: "team", label: `Team: ${state.team}` });
    if (state.activity !== "all") chips.push({ key: "activity", label: `Activity: ${ACTIVITY_LABELS[state.activity] || state.activity}` });
    if (!chips.length) return "";

    return `
      <div class="players-active-filters">
        ${chips.map((chip) => `
          <button type="button" class="players-filter-chip" data-clear-filter="${esc(chip.key)}">
            <span>${esc(chip.label)}</span>
            <strong>&times;</strong>
          </button>
        `).join("")}
        <button type="button" class="players-filter-chip clear-all" data-clear-filter="all">
          <span>Reset filters</span>
          <strong>&times;</strong>
        </button>
      </div>
    `;
  }

  function teamBadge(player) {
    const label = player.currentTeamName || "Free Agent";
    if (!player.currentTeamName) {
      return `<span class="players-team-badge empty">${esc(label)}</span>`;
    }
    return `
      <span class="players-team-badge">
        ${player.currentTeamIcon ? `<img src="${esc(player.currentTeamIcon)}" alt="${esc(label)}">` : ""}
        <span>${esc(label)}</span>
      </span>
    `;
  }

  function playerCard(player, index) {
    const steamLabel = player.steamName && player.steamName !== player.name ? player.steamName : player.steam_id;
    const registeredLabel = player.registered_at ? fmtDate(player.registered_at) : "N/A";
    const lastSeenLabel = player.lastMatchAt ? fmtDate(player.lastMatchAt) : "N/A";

    return `
      <article class="player-browser-card role-${esc(player.roleKey)}" style="--card-index:${index};">
        <div class="player-browser-glow"></div>
        <div class="player-browser-top">
          ${formatActivityPill(player)}
          <span class="player-browser-role role-${esc(player.roleKey)}">${esc(player.roleLabel)}</span>
        </div>
        <div class="player-browser-main">
          <img class="player-browser-avatar" src="${esc(player.display_avatar_url || player.steam_avatar_url || player.avatar_url || player.avatar_fallback_url || fallbackAvatar)}" alt="${esc(player.name)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
          <div class="player-browser-body">
            <div class="player-browser-header">
              <div>
                <a class="player-browser-name" href="player.html?steam_id=${encodeURIComponent(player.steam_id)}">${esc(player.name)}</a>
                <div class="player-browser-subtitle">${esc(steamLabel || "No Steam alias")}</div>
              </div>
              <div class="player-browser-rating">
                <span>Rating</span>
                <strong>${esc(formatRating(player.ratingValue))}</strong>
              </div>
            </div>
            <div class="player-browser-tags">
              <span class="player-browser-tag position">${esc(player.position)}</span>
              <span class="player-browser-tag role-${esc(player.roleKey)}">${esc(player.roleLabel)}</span>
              ${teamBadge(player)}
            </div>
            <div class="player-browser-stats">
              <div class="player-browser-stat">
                <span>Appearances</span>
                <strong>${esc(String(player.appearances))}</strong>
              </div>
              <div class="player-browser-stat">
                <span>Minutes</span>
                <strong>${esc(formatMinutes(player.minutes))}</strong>
              </div>
              <div class="player-browser-stat">
                <span>Last match</span>
                <strong>${esc(lastSeenLabel)}</strong>
              </div>
              <div class="player-browser-stat">
                <span>Registered</span>
                <strong>${esc(registeredLabel)}</strong>
              </div>
            </div>
          </div>
        </div>
        <div class="player-browser-actions">
          <a class="player-browser-action primary" href="player.html?steam_id=${encodeURIComponent(player.steam_id)}">Open Profile</a>
          ${player.steam_profile_url
            ? `<a class="player-browser-action" href="${esc(player.steam_profile_url)}" target="_blank" rel="noreferrer">Steam Profile</a>`
            : `<span class="player-browser-action disabled">Steam Profile</span>`}
        </div>
      </article>
    `;
  }

  function playerListRow(player, index) {
    return `
      <article class="player-list-row role-${esc(player.roleKey)}" style="--card-index:${index};">
        <div class="player-list-main">
          <img class="player-list-avatar" src="${esc(player.display_avatar_url || player.steam_avatar_url || player.avatar_url || player.avatar_fallback_url || fallbackAvatar)}" alt="${esc(player.name)}" onerror="this.onerror=null;this.src='${fallbackAvatar}';">
          <div class="player-list-text">
            <a class="player-list-name" href="player.html?steam_id=${encodeURIComponent(player.steam_id)}">${esc(player.name)}</a>
            <div class="player-list-subtitle">${esc(player.steamName || player.steam_id)}</div>
          </div>
        </div>
        <div class="player-list-cell">
          <span class="player-browser-tag role-${esc(player.roleKey)}">${esc(player.roleLabel)}</span>
          <span class="player-browser-tag position">${esc(player.position)}</span>
        </div>
        <div class="player-list-cell">${teamBadge(player)}</div>
        <div class="player-list-cell rating"><strong>${esc(formatRating(player.ratingValue))}</strong></div>
        <div class="player-list-cell">${esc(String(player.appearances))}</div>
        <div class="player-list-cell">${esc(formatRelativeDate(player.lastMatchAt))}</div>
        <div class="player-list-cell">${esc(player.registered_at ? fmtDate(player.registered_at) : "N/A")}</div>
      </article>
    `;
  }

  function renderLoading() {
    page.innerHTML = `
      <section class="players-browser">
        <div class="players-toolbar players-loading-shell">
          <div class="players-loading-bar"></div>
          <div class="players-loading-row">
            <div class="players-loading-pill"></div>
            <div class="players-loading-pill"></div>
            <div class="players-loading-pill"></div>
            <div class="players-loading-pill"></div>
          </div>
        </div>
        <div class="players-card-grid loading">
          ${Array.from({ length: 8 }).map((_, index) => `
            <article class="player-browser-card skeleton" style="--card-index:${index};">
              <div class="player-browser-skeleton shimmer"></div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function render(restoreFocus) {
    syncStateToUrl();
    const players = filteredPlayers();
    const metrics = summaryMetrics(players);

    page.innerHTML = `
      <section class="players-browser">
        <div class="players-toolbar">
          <div class="players-toolbar-head">
            <div>
              <div class="players-section-kicker">Player Browser</div>
              <h2 class="players-section-title">Search, sort, and explore the hub roster</h2>
              <div class="players-section-copy">Live filtering updates as you type and keeps your state in the URL.</div>
            </div>
            <div class="players-view-toggle">
              <button type="button" class="players-view-btn ${state.view === "grid" ? "active" : ""}" data-view="grid">Card View</button>
              <button type="button" class="players-view-btn ${state.view === "list" ? "active" : ""}" data-view="list">List View</button>
            </div>
          </div>

          <div class="players-search-wrap">
            <label class="players-field">
              <span class="players-field-label">Search players</span>
              <div class="players-search-shell">
                <span class="players-search-icon">&#9906;</span>
                <input id="players-search" class="players-search-input" type="search" placeholder="Search by player, Steam ID, team, or position" value="${esc(state.search)}" autocomplete="off" spellcheck="false">
                ${state.search ? '<button type="button" id="players-search-clear" class="players-search-clear" aria-label="Clear search">&times;</button>' : ""}
              </div>
            </label>
          </div>

          <div class="players-filter-grid">
            <label class="players-field">
              <span class="players-field-label">Sort by</span>
              <select id="players-sort" class="players-select">
                <option value="rating" ${state.sort === "rating" ? "selected" : ""}>Rating</option>
                <option value="name" ${state.sort === "name" ? "selected" : ""}>Name</option>
                <option value="position" ${state.sort === "position" ? "selected" : ""}>Position</option>
                <option value="lastActive" ${state.sort === "lastActive" ? "selected" : ""}>Last active</option>
                <option value="registered" ${state.sort === "registered" ? "selected" : ""}>Registered</option>
              </select>
            </label>
            <label class="players-field">
              <span class="players-field-label">Direction</span>
              <select id="players-dir" class="players-select">
                <option value="desc" ${state.dir === "desc" ? "selected" : ""}>Descending</option>
                <option value="asc" ${state.dir === "asc" ? "selected" : ""}>Ascending</option>
              </select>
            </label>
            <label class="players-field">
              <span class="players-field-label">Role</span>
              <select id="players-role" class="players-select">
                <option value="all">All roles</option>
                ${roleOptions.map((role) => `<option value="${esc(role)}" ${state.role === role ? "selected" : ""}>${esc(roleLabelFromKey(role))}</option>`).join("")}
              </select>
            </label>
            <label class="players-field">
              <span class="players-field-label">Team</span>
              <select id="players-team" class="players-select">
                <option value="all">All teams</option>
                ${teamOptions.map((team) => `<option value="${esc(team)}" ${state.team === team ? "selected" : ""}>${esc(team)}</option>`).join("")}
              </select>
            </label>
            <label class="players-field">
              <span class="players-field-label">Activity</span>
              <select id="players-activity" class="players-select">
                <option value="all" ${state.activity === "all" ? "selected" : ""}>Any activity</option>
                <option value="hot" ${state.activity === "hot" ? "selected" : ""}>Hot (14d)</option>
                <option value="active" ${state.activity === "active" ? "selected" : ""}>Active (30d)</option>
                <option value="quiet" ${state.activity === "quiet" ? "selected" : ""}>Quiet (90d)</option>
                <option value="inactive" ${state.activity === "inactive" ? "selected" : ""}>Inactive</option>
                <option value="unknown" ${state.activity === "unknown" ? "selected" : ""}>Unknown</option>
              </select>
            </label>
          </div>
        </div>

        <div class="players-overview-grid">
          <article class="players-overview-card">
            <span class="players-overview-label">Visible players</span>
            <strong>${esc(String(metrics.visible))}</strong>
          </article>
          <article class="players-overview-card">
            <span class="players-overview-label">Average rating</span>
            <strong>${esc(metrics.averageRating ? metrics.averageRating.toFixed(2) : "0.00")}</strong>
          </article>
          <article class="players-overview-card">
            <span class="players-overview-label">Teams represented</span>
            <strong>${esc(String(metrics.representedTeams))}</strong>
          </article>
          <article class="players-overview-card">
            <span class="players-overview-label">Recently active</span>
            <strong>${esc(String(metrics.recentActive))}</strong>
          </article>
        </div>

        ${activeFilterChips()}

        <div class="players-results-head">
          <div class="players-results-copy">
            <strong>${esc(String(players.length))}</strong> results sorted by <strong>${esc(SORT_LABELS[state.sort] || state.sort)}</strong>
          </div>
          <button type="button" class="players-reset-btn" id="players-reset" ${JSON.stringify(state) === JSON.stringify(DEFAULT_STATE) ? "disabled" : ""}>Reset All</button>
        </div>

        ${players.length ? (
          state.view === "grid"
            ? `<div class="players-card-grid">${players.map((player, index) => playerCard(player, index)).join("")}</div>`
            : `<div class="players-list">${players.map((player, index) => playerListRow(player, index)).join("")}</div>`
        ) : `
          <div class="players-empty-state">
            <div class="players-empty-icon">&#9906;</div>
            <h3>No players matched those filters</h3>
            <p>Try clearing the search, switching roles, or broadening the activity window.</p>
          </div>
        `}
      </section>
    `;

    bindEvents();

    if (restoreFocus && restoreFocus.id) {
      const target = byId(restoreFocus.id);
      if (target) {
        target.focus();
        if (typeof restoreFocus.start === "number" && typeof restoreFocus.end === "number" && typeof target.setSelectionRange === "function") {
          target.setSelectionRange(restoreFocus.start, restoreFocus.end);
        }
      }
    }
  }

  function updateState(nextState, restoreFocus) {
    state = { ...state, ...nextState };
    render(restoreFocus);
  }

  function clearFilter(key) {
    if (key === "all") {
      state = { ...DEFAULT_STATE };
      render();
      return;
    }
    if (key === "search") updateState({ search: "" });
    if (key === "role") updateState({ role: "all" });
    if (key === "team") updateState({ team: "all" });
    if (key === "activity") updateState({ activity: "all" });
  }

  function bindEvents() {
    const search = byId("players-search");
    if (search) {
      search.addEventListener("input", (event) => {
        updateState(
          { search: String(event.target.value || "").trimStart() },
          {
            id: "players-search",
            start: event.target.selectionStart,
            end: event.target.selectionEnd,
          }
        );
      });
    }

    const clearSearch = byId("players-search-clear");
    if (clearSearch) {
      clearSearch.addEventListener("click", () => updateState({ search: "" }));
    }

    const sort = byId("players-sort");
    if (sort) {
      sort.addEventListener("change", (event) => updateState({ sort: event.target.value }));
    }

    const dir = byId("players-dir");
    if (dir) {
      dir.addEventListener("change", (event) => updateState({ dir: event.target.value }));
    }

    const role = byId("players-role");
    if (role) {
      role.addEventListener("change", (event) => updateState({ role: event.target.value }));
    }

    const team = byId("players-team");
    if (team) {
      team.addEventListener("change", (event) => updateState({ team: event.target.value }));
    }

    const activity = byId("players-activity");
    if (activity) {
      activity.addEventListener("change", (event) => updateState({ activity: event.target.value }));
    }

    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => updateState({ view: button.getAttribute("data-view") || "grid" }));
    });

    document.querySelectorAll("[data-clear-filter]").forEach((button) => {
      button.addEventListener("click", () => clearFilter(button.getAttribute("data-clear-filter") || ""));
    });

    const reset = byId("players-reset");
    if (reset) {
      reset.addEventListener("click", () => {
        state = { ...DEFAULT_STATE };
        render();
      });
    }
  }
})();
