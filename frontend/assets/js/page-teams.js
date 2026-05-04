(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError, teamThemeStyle } = window.HubUI;
  renderLayout("teams.html", "Team Browser", {
    layout: "standard",
    eyebrow: "Club Directory",
  });
  const page = byId("page");
  const fallbackLogo = "assets/icons/iosca-icon.png";

  const DEFAULT_STATE = {
    search: "",
    sort: "rating",
    view: "grid",
  };

  const SORT_OPTIONS = new Set(["rating", "name", "players", "updated", "created"]);

  let allTeams = [];
  let state = readState();

  renderLoading();

  try {
    let data;
    try {
      data = await window.HubStatic.teams();
    } catch (_) {
      data = await window.HubApi.teams();
    }
    allTeams = (data.teams || []).map(normalizeTeam);
    render();
  } catch (err) {
    showError(`Failed to load teams: ${err.message}`);
  }

  function readState() {
    const params = new URLSearchParams(window.location.search);
    return {
      search: String(params.get("search") || "").trim(),
      sort: SORT_OPTIONS.has(params.get("sort")) ? params.get("sort") : DEFAULT_STATE.sort,
      view: params.get("view") === "list" ? "list" : DEFAULT_STATE.view,
    };
  }

  function syncStateToUrl() {
    const params = new URLSearchParams();
    if (state.search) params.set("search", state.search);
    if (state.sort !== DEFAULT_STATE.sort) params.set("sort", state.sort);
    if (state.view !== DEFAULT_STATE.view) params.set("view", state.view);
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeTeam(raw) {
    const guildName = String(raw.guild_name || "Unknown Team").trim() || "Unknown Team";
    const captainName = String(raw.captain_name || "N/A").trim() || "N/A";
    return {
      ...raw,
      guildName,
      captainName,
      playerCount: Math.max(0, Math.round(num(raw.player_count))),
      averageRatingValue: Number.isFinite(Number(raw.average_rating)) ? Number(raw.average_rating) : null,
      updatedAt: raw.updated_at || null,
      createdAt: raw.created_at || null,
      searchBlob: [guildName, captainName, raw.guild_id].join(" ").toLowerCase(),
    };
  }

  function formatRating(value) {
    return Number.isFinite(value) ? value.toFixed(2) : "N/A";
  }

  function filteredTeams() {
    return allTeams
      .filter((team) => !state.search || team.searchBlob.includes(state.search.toLowerCase()))
      .sort(compareTeams);
  }

  function compareTeams(left, right) {
    if (state.sort === "name") return left.guildName.localeCompare(right.guildName);
    if (state.sort === "players") {
      if (right.playerCount !== left.playerCount) return right.playerCount - left.playerCount;
      return left.guildName.localeCompare(right.guildName);
    }
    if (state.sort === "updated") {
      const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
      const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return left.guildName.localeCompare(right.guildName);
    }
    if (state.sort === "created") {
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return left.guildName.localeCompare(right.guildName);
    }
    const leftRating = Number.isFinite(left.averageRatingValue) ? left.averageRatingValue : -999;
    const rightRating = Number.isFinite(right.averageRatingValue) ? right.averageRatingValue : -999;
    if (rightRating !== leftRating) return rightRating - leftRating;
    return left.guildName.localeCompare(right.guildName);
  }

  function summaryMetrics(teams) {
    const visible = teams.length;
    const ratedTeams = teams.filter((team) => Number.isFinite(team.averageRatingValue));
    const averageRating = ratedTeams.length
      ? ratedTeams.reduce((sum, team) => sum + team.averageRatingValue, 0) / ratedTeams.length
      : 0;
    const rosteredPlayers = teams.reduce((sum, team) => sum + team.playerCount, 0);
    return { visible, averageRating, rosteredPlayers };
  }

  function teamCard(team, index) {
    const accentStyle = teamThemeStyle(team.guild_id || team.guildName);
    return `
      <article class="team-browser-card" style="--card-index:${index};${accentStyle}">
        <div class="team-browser-name-row">
          <a class="team-browser-name" href="team.html?id=${encodeURIComponent(team.guild_id)}">${esc(team.guildName)}</a>
        </div>
        <div class="team-browser-center">
          <img class="team-browser-logo" src="${esc(team.guild_icon || fallbackLogo)}" alt="${esc(team.guildName)}" onerror="this.onerror=null;this.src='${fallbackLogo}';">
        </div>
        <div class="team-browser-meta">
          <div class="team-browser-captain">
            <span>Captain</span>
            <strong>${esc(team.captainName)}</strong>
          </div>
          <div class="team-browser-rating">
            <span>Rating</span>
            <strong>${esc(formatRating(team.averageRatingValue))}</strong>
          </div>
        </div>
        <div class="team-browser-actions">
          <a class="player-browser-action primary" href="team.html?id=${encodeURIComponent(team.guild_id)}">Open Team</a>
        </div>
      </article>
    `;
  }

  function teamListRow(team, index) {
    const accentStyle = teamThemeStyle(team.guild_id || team.guildName);
    return `
      <article class="team-list-row" style="--card-index:${index};${accentStyle}">
        <div class="team-list-main">
          <img class="team-list-logo" src="${esc(team.guild_icon || fallbackLogo)}" alt="${esc(team.guildName)}" onerror="this.onerror=null;this.src='${fallbackLogo}';">
          <div class="team-list-text">
            <a class="team-list-name" href="team.html?id=${encodeURIComponent(team.guild_id)}">${esc(team.guildName)}</a>
            <div class="team-list-subtitle">Captain: ${esc(team.captainName)}</div>
          </div>
        </div>
        <div class="team-list-cell">${esc(String(team.playerCount))}</div>
        <div class="team-list-cell"><strong>${esc(formatRating(team.averageRatingValue))}</strong></div>
        <div class="team-list-cell">${esc(team.captainName)}</div>
        <div class="team-list-cell actions">
          <a class="player-browser-action primary" href="team.html?id=${encodeURIComponent(team.guild_id)}">Open Team</a>
        </div>
      </article>
    `;
  }

  function renderLoading() {
    page.innerHTML = `
      <section class="teams-browser">
        <div class="players-toolbar players-loading-shell">
          <div class="players-loading-bar"></div>
          <div class="players-loading-row">
            <div class="players-loading-pill"></div>
            <div class="players-loading-pill"></div>
            <div class="players-loading-pill"></div>
            <div class="players-loading-pill"></div>
          </div>
        </div>
        <div class="teams-card-grid">
          ${Array.from({ length: 6 }).map((_, index) => `
            <article class="team-browser-card skeleton" style="--card-index:${index};">
              <div class="player-browser-skeleton shimmer"></div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function render(restoreFocus) {
    syncStateToUrl();
    const teams = filteredTeams();
    const metrics = summaryMetrics(teams);
    const topRatedTeam = teams.find((team) => Number.isFinite(team.averageRatingValue)) || null;

    page.innerHTML = `
      <section class="teams-browser">
        <div class="players-toolbar">
          <div class="players-toolbar-head">
            <div>
              <div class="players-section-kicker">Team Browser</div>
              <h2 class="players-section-title">Explore teams, sort the table, and jump into head-to-head comparisons</h2>
              <div class="players-section-copy">The H2H shortcut preloads a team so you can compare it instantly against anyone else.</div>
            </div>
            <div class="players-view-toggle">
              <button type="button" class="players-view-btn ${state.view === "grid" ? "active" : ""}" data-view="grid">Card View</button>
              <button type="button" class="players-view-btn ${state.view === "list" ? "active" : ""}" data-view="list">List View</button>
            </div>
          </div>

          <div class="players-search-wrap">
            <label class="players-field">
              <span class="players-field-label">Search teams</span>
              <div class="players-search-shell">
                <span class="players-search-icon">&#9906;</span>
                <input id="teams-search" class="players-search-input" type="search" placeholder="Search by team, captain, or team id" value="${esc(state.search)}" autocomplete="off" spellcheck="false">
                ${state.search ? '<button type="button" id="teams-search-clear" class="players-search-clear" aria-label="Clear search">&times;</button>' : ""}
              </div>
            </label>
          </div>

          <div class="teams-controls-grid">
            <label class="players-field">
              <span class="players-field-label">Sort by</span>
              <select id="teams-sort" class="players-select">
                <option value="rating" ${state.sort === "rating" ? "selected" : ""}>Average rating</option>
                <option value="name" ${state.sort === "name" ? "selected" : ""}>Name</option>
                <option value="players" ${state.sort === "players" ? "selected" : ""}>Players</option>
                <option value="updated" ${state.sort === "updated" ? "selected" : ""}>Updated</option>
                <option value="created" ${state.sort === "created" ? "selected" : ""}>Created</option>
              </select>
            </label>
            <div class="teams-shortcut-card">
              <div class="players-section-kicker">Head to Head</div>
              <div class="teams-shortcut-title">Compare clubs instantly</div>
              <div class="teams-shortcut-copy">Open the dedicated comparison page and search for any two clubs.</div>
              <a class="player-browser-action primary" href="h2h.html">Open H2H</a>
            </div>
          </div>
        </div>

        <div class="players-overview-grid">
          <article class="players-overview-card">
            <span class="players-overview-label">Visible teams</span>
            <strong>${esc(String(metrics.visible))}</strong>
          </article>
          <article class="players-overview-card">
            <span class="players-overview-label">Average rating</span>
            <strong>${esc(metrics.averageRating ? metrics.averageRating.toFixed(2) : "0.00")}</strong>
          </article>
          <article class="players-overview-card">
            <span class="players-overview-label">Rostered players</span>
            <strong>${esc(String(metrics.rosteredPlayers))}</strong>
          </article>
        </div>

        <div class="players-results-head">
          <div class="players-results-copy">
            <strong>${esc(String(teams.length))}</strong> teams currently visible
          </div>
          <button type="button" class="players-reset-btn" id="teams-reset" ${JSON.stringify(state) === JSON.stringify(DEFAULT_STATE) ? "disabled" : ""}>Reset All</button>
        </div>

        ${teams.length ? (
          state.view === "grid"
            ? `<div class="teams-card-grid">${teams.map((team, index) => teamCard(team, index)).join("")}</div>`
            : `<div class="teams-list">${teams.map((team, index) => teamListRow(team, index)).join("")}</div>`
        ) : `
          <div class="players-empty-state">
            <div class="players-empty-icon">&#9906;</div>
            <h3>No teams matched that search</h3>
            <p>Try clearing the text filter or switching to the H2H page to compare specific clubs.</p>
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

  function bindEvents() {
    const search = byId("teams-search");
    if (search) {
      search.addEventListener("input", (event) => {
        updateState(
          { search: String(event.target.value || "").trimStart() },
          {
            id: "teams-search",
            start: event.target.selectionStart,
            end: event.target.selectionEnd,
          }
        );
      });
    }

    const clearSearch = byId("teams-search-clear");
    if (clearSearch) clearSearch.addEventListener("click", () => updateState({ search: "" }));

    const sort = byId("teams-sort");
    if (sort) sort.addEventListener("change", (event) => updateState({ sort: event.target.value }));

    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => updateState({ view: button.getAttribute("data-view") || "grid" }));
    });

    const reset = byId("teams-reset");
    if (reset) {
      reset.addEventListener("click", () => {
        state = { ...DEFAULT_STATE };
        render();
      });
    }
  }
})();
