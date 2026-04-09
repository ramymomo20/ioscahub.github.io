(async function () {
  const { renderLayout, byId, esc, fmtDate, fmtDateTime, showError } = window.HubUI;
  renderLayout("matches.html", "Matches");
  const page = byId("page");

  const DEFAULT_STATE = {
    search: "",
    sort: "newest",
    format: "all",
    tournament: "all",
    team: "all",
    home: "all",
    away: "all",
    flags: "all",
    from: "",
    to: "",
    view: "grid",
  };

  const SORT_OPTIONS = new Set(["newest", "oldest", "goals", "tournament", "home", "away"]);
  const FLAG_OPTIONS = new Set(["all", "clean", "extratime", "penalties", "special"]);
  const VIEW_OPTIONS = new Set(["grid", "list"]);

  let allMatches = [];
  let tournamentOptions = [];
  let teamOptions = [];
  let formatOptions = [];
  let state = readState();

  renderLoading();

  try {
    const data = await window.HubApi.matches({ limit: 3000 });
    allMatches = (data.matches || []).map(normalizeMatch);
    tournamentOptions = buildDistinctOptions(allMatches.map((match) => match.tournamentName).filter(Boolean));
    teamOptions = buildDistinctOptions(
      allMatches.flatMap((match) => [match.homeTeamName, match.awayTeamName]).filter(Boolean)
    );
    formatOptions = buildDistinctOptions(allMatches.map((match) => match.gameType).filter(Boolean));
    sanitizeState();
    render();
  } catch (err) {
    showError(`Failed to load matches: ${err.message}`);
  }

  function readState() {
    const params = new URLSearchParams(window.location.search);
    const next = { ...DEFAULT_STATE };
    next.search = String(params.get("search") || "").trim();
    next.sort = SORT_OPTIONS.has(params.get("sort")) ? params.get("sort") : DEFAULT_STATE.sort;
    next.format = String(params.get("format") || DEFAULT_STATE.format).trim() || DEFAULT_STATE.format;
    next.tournament = String(params.get("tournament") || DEFAULT_STATE.tournament).trim() || DEFAULT_STATE.tournament;
    next.team = String(params.get("team") || DEFAULT_STATE.team).trim() || DEFAULT_STATE.team;
    next.home = String(params.get("home") || DEFAULT_STATE.home).trim() || DEFAULT_STATE.home;
    next.away = String(params.get("away") || DEFAULT_STATE.away).trim() || DEFAULT_STATE.away;
    next.flags = FLAG_OPTIONS.has(params.get("flags")) ? params.get("flags") : DEFAULT_STATE.flags;
    next.from = String(params.get("from") || "").trim();
    next.to = String(params.get("to") || "").trim();
    next.view = VIEW_OPTIONS.has(params.get("view")) ? params.get("view") : DEFAULT_STATE.view;
    return next;
  }

  function sanitizeState() {
    if (state.format !== "all" && !formatOptions.includes(state.format)) state.format = "all";
    if (state.tournament !== "all" && !tournamentOptions.includes(state.tournament)) state.tournament = "all";
    if (state.team !== "all" && !teamOptions.includes(state.team)) state.team = "all";
    if (state.home !== "all" && !teamOptions.includes(state.home)) state.home = "all";
    if (state.away !== "all" && !teamOptions.includes(state.away)) state.away = "all";
  }

  function syncStateToUrl() {
    const params = new URLSearchParams();
    if (state.search) params.set("search", state.search);
    if (state.sort !== DEFAULT_STATE.sort) params.set("sort", state.sort);
    if (state.format !== DEFAULT_STATE.format) params.set("format", state.format);
    if (state.tournament !== DEFAULT_STATE.tournament) params.set("tournament", state.tournament);
    if (state.team !== DEFAULT_STATE.team) params.set("team", state.team);
    if (state.home !== DEFAULT_STATE.home) params.set("home", state.home);
    if (state.away !== DEFAULT_STATE.away) params.set("away", state.away);
    if (state.flags !== DEFAULT_STATE.flags) params.set("flags", state.flags);
    if (state.from) params.set("from", state.from);
    if (state.to) params.set("to", state.to);
    if (state.view !== DEFAULT_STATE.view) params.set("view", state.view);
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }

  function buildDistinctOptions(items) {
    return Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeMatch(raw) {
    const homeTeamName = String(raw.home_team_name || "Home").trim() || "Home";
    const awayTeamName = String(raw.away_team_name || "Away").trim() || "Away";
    const gameType = String(raw.game_type || "Unknown").trim() || "Unknown";
    const tournamentName = String(raw.tournament_name || "").trim();
    const datetimeValue = raw.datetime ? new Date(raw.datetime) : null;
    const validDate = datetimeValue && !Number.isNaN(datetimeValue.getTime()) ? datetimeValue : null;
    const homeScore = Math.round(num(raw.home_score));
    const awayScore = Math.round(num(raw.away_score));
    const totalGoals = homeScore + awayScore;
    const searchBlob = [
      homeTeamName,
      awayTeamName,
      tournamentName,
      gameType,
      raw.match_id,
      raw.id,
      fmtDate(raw.datetime),
    ].join(" ").toLowerCase();

    return {
      ...raw,
      homeTeamName,
      awayTeamName,
      tournamentName,
      gameType,
      homeScore,
      awayScore,
      totalGoals,
      dateValue: validDate,
      dateKey: validDate ? validDate.toISOString().slice(0, 10) : "",
      displayDate: raw.datetime ? fmtDateTime(raw.datetime) : "N/A",
      searchBlob,
    };
  }

  function matchSearch(match) {
    if (!state.search) return true;
    return match.searchBlob.includes(state.search.toLowerCase());
  }

  function matchFormat(match) {
    return state.format === "all" || match.gameType === state.format;
  }

  function matchTournament(match) {
    return state.tournament === "all" || match.tournamentName === state.tournament;
  }

  function matchTeam(match) {
    if (state.team === "all") return true;
    return match.homeTeamName === state.team || match.awayTeamName === state.team;
  }

  function matchHome(match) {
    return state.home === "all" || match.homeTeamName === state.home;
  }

  function matchAway(match) {
    return state.away === "all" || match.awayTeamName === state.away;
  }

  function matchFlags(match) {
    if (state.flags === "all") return true;
    if (state.flags === "clean") return !match.extratime && !match.penalties;
    if (state.flags === "extratime") return Boolean(match.extratime);
    if (state.flags === "penalties") return Boolean(match.penalties);
    if (state.flags === "special") return Boolean(match.extratime || match.penalties);
    return true;
  }

  function matchDateRange(match) {
    if (!state.from && !state.to) return true;
    if (!match.dateKey) return false;
    if (state.from && match.dateKey < state.from) return false;
    if (state.to && match.dateKey > state.to) return false;
    return true;
  }

  function compareMatches(left, right) {
    if (state.sort === "oldest") {
      return getTime(left) - getTime(right);
    }
    if (state.sort === "goals") {
      if (right.totalGoals !== left.totalGoals) return right.totalGoals - left.totalGoals;
      return getTime(right) - getTime(left);
    }
    if (state.sort === "tournament") {
      const tournamentCompare = left.tournamentName.localeCompare(right.tournamentName);
      if (tournamentCompare !== 0) return tournamentCompare;
      return getTime(right) - getTime(left);
    }
    if (state.sort === "home") {
      const homeCompare = left.homeTeamName.localeCompare(right.homeTeamName);
      if (homeCompare !== 0) return homeCompare;
      return getTime(right) - getTime(left);
    }
    if (state.sort === "away") {
      const awayCompare = left.awayTeamName.localeCompare(right.awayTeamName);
      if (awayCompare !== 0) return awayCompare;
      return getTime(right) - getTime(left);
    }
    return getTime(right) - getTime(left);
  }

  function getTime(match) {
    return match.dateValue ? match.dateValue.getTime() : 0;
  }

  function filteredMatches() {
    return allMatches
      .filter(matchSearch)
      .filter(matchFormat)
      .filter(matchTournament)
      .filter(matchTeam)
      .filter(matchHome)
      .filter(matchAway)
      .filter(matchFlags)
      .filter(matchDateRange)
      .sort(compareMatches);
  }

  function summaryMetrics(matches) {
    const visible = matches.length;
    const totalGoals = matches.reduce((sum, match) => sum + match.totalGoals, 0);
    const avgGoals = visible ? totalGoals / visible : 0;
    const tournaments = new Set(matches.map((match) => match.tournamentName).filter(Boolean)).size;
    const special = matches.filter((match) => match.extratime || match.penalties).length;
    return { visible, totalGoals, avgGoals, tournaments, special };
  }

  function flagBadges(match) {
    const bits = [];
    if (match.extratime) bits.push('<span class="badge">ET</span>');
    if (match.penalties) bits.push('<span class="badge">PEN</span>');
    return bits.join(" ");
  }

  function tournamentLabel(match) {
    return match.tournamentName || "Independent Match";
  }

  function matchCard(match, index) {
    const scoreline = `${match.homeScore} - ${match.awayScore}`;
    return `
      <article class="match-browser-card" style="--card-index:${index};">
        <div class="match-browser-glow"></div>
        <div class="match-browser-top">
          <div class="match-browser-date">
            <span>${esc(fmtDate(match.datetime))}</span>
            <strong>${esc(match.gameType)}</strong>
          </div>
          <div class="match-browser-flags">${flagBadges(match) || '<span class="match-browser-muted">Standard</span>'}</div>
        </div>

        <a class="match-browser-link" href="match.html?id=${encodeURIComponent(match.id)}">
          <div class="match-browser-teams">
            <div class="match-browser-team home">
              ${match.home_team_icon ? `<img src="${esc(match.home_team_icon)}" alt="${esc(match.homeTeamName)}">` : ""}
              <span>${esc(match.homeTeamName)}</span>
            </div>
            <div class="match-browser-score">
              <strong>${esc(scoreline)}</strong>
              <span>${esc(match.totalGoals)} total goals</span>
            </div>
            <div class="match-browser-team away">
              <span>${esc(match.awayTeamName)}</span>
              ${match.away_team_icon ? `<img src="${esc(match.away_team_icon)}" alt="${esc(match.awayTeamName)}">` : ""}
            </div>
          </div>

          <div class="match-browser-meta">
            <span class="match-browser-meta-pill">${esc(tournamentLabel(match))}</span>
            <span class="match-browser-meta-pill">${esc(match.displayDate)}</span>
          </div>
        </a>
      </article>
    `;
  }

  function matchListRow(match, index) {
    return `
      <article class="match-list-row" style="--card-index:${index};">
        <div class="match-list-main">
          <a class="match-list-link" href="match.html?id=${encodeURIComponent(match.id)}">
            <span class="match-list-team home">${esc(match.homeTeamName)}</span>
            <strong>${esc(`${match.homeScore} - ${match.awayScore}`)}</strong>
            <span class="match-list-team away">${esc(match.awayTeamName)}</span>
          </a>
          <div class="match-list-subtitle">${esc(tournamentLabel(match))}</div>
        </div>
        <div class="match-list-cell">${esc(match.gameType)}</div>
        <div class="match-list-cell">${flagBadges(match) || '<span class="match-browser-muted">-</span>'}</div>
        <div class="match-list-cell">${esc(fmtDate(match.datetime))}</div>
        <div class="match-list-cell">${esc(String(match.totalGoals))}</div>
      </article>
    `;
  }

  function renderLoading() {
    page.innerHTML = `
      <section class="matches-browser">
        <div class="matches-toolbar players-loading-shell">
          <div class="players-loading-bar"></div>
          <div class="players-loading-row">
            <div class="players-loading-pill"></div>
            <div class="players-loading-pill"></div>
            <div class="players-loading-pill"></div>
            <div class="players-loading-pill"></div>
          </div>
        </div>
        <div class="matches-card-grid">
          ${Array.from({ length: 6 }).map((_, index) => `
            <article class="match-browser-card skeleton" style="--card-index:${index};">
              <div class="player-browser-skeleton shimmer"></div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function render(restoreFocus) {
    syncStateToUrl();
    const matches = filteredMatches();
    const metrics = summaryMetrics(matches);

    page.innerHTML = `
      <section class="matches-browser">
        <div class="matches-toolbar">
          <div class="matches-toolbar-head">
            <div>
              <div class="players-section-kicker">Results Explorer</div>
              <h2 class="players-section-title">Search match history by teams, formats, dates, and tournaments</h2>
              <div class="players-section-copy">Use the filters like a real results browser and keep the view shareable in the URL.</div>
            </div>
            <div class="players-view-toggle">
              <button type="button" class="players-view-btn ${state.view === "grid" ? "active" : ""}" data-view="grid">Card View</button>
              <button type="button" class="players-view-btn ${state.view === "list" ? "active" : ""}" data-view="list">List View</button>
            </div>
          </div>

          <div class="players-search-wrap">
            <label class="players-field">
              <span class="players-field-label">Search matches</span>
              <div class="players-search-shell">
                <span class="players-search-icon">&#9906;</span>
                <input id="matches-search" class="players-search-input" type="search" placeholder="Search by team, tournament, format, or match id" value="${esc(state.search)}" autocomplete="off" spellcheck="false">
                ${state.search ? '<button type="button" id="matches-search-clear" class="players-search-clear" aria-label="Clear search">&times;</button>' : ""}
              </div>
            </label>
          </div>

          <div class="matches-filter-grid">
            <label class="players-field">
              <span class="players-field-label">Sort by</span>
              <select id="matches-sort" class="players-select">
                <option value="newest" ${state.sort === "newest" ? "selected" : ""}>Newest first</option>
                <option value="oldest" ${state.sort === "oldest" ? "selected" : ""}>Oldest first</option>
                <option value="goals" ${state.sort === "goals" ? "selected" : ""}>Most goals</option>
                <option value="tournament" ${state.sort === "tournament" ? "selected" : ""}>Tournament</option>
                <option value="home" ${state.sort === "home" ? "selected" : ""}>Home team</option>
                <option value="away" ${state.sort === "away" ? "selected" : ""}>Away team</option>
              </select>
            </label>
            <label class="players-field">
              <span class="players-field-label">Format</span>
              <select id="matches-format" class="players-select">
                <option value="all">All formats</option>
                ${formatOptions.map((format) => `<option value="${esc(format)}" ${state.format === format ? "selected" : ""}>${esc(format)}</option>`).join("")}
              </select>
            </label>
            <label class="players-field">
              <span class="players-field-label">Tournament</span>
              <select id="matches-tournament" class="players-select">
                <option value="all">All tournaments</option>
                ${tournamentOptions.map((tournament) => `<option value="${esc(tournament)}" ${state.tournament === tournament ? "selected" : ""}>${esc(tournament)}</option>`).join("")}
              </select>
            </label>
            <label class="players-field">
              <span class="players-field-label">Any team</span>
              <select id="matches-team" class="players-select">
                <option value="all">Any team</option>
                ${teamOptions.map((team) => `<option value="${esc(team)}" ${state.team === team ? "selected" : ""}>${esc(team)}</option>`).join("")}
              </select>
            </label>
            <label class="players-field">
              <span class="players-field-label">Flags</span>
              <select id="matches-flags" class="players-select">
                <option value="all" ${state.flags === "all" ? "selected" : ""}>All matches</option>
                <option value="clean" ${state.flags === "clean" ? "selected" : ""}>No ET / penalties</option>
                <option value="extratime" ${state.flags === "extratime" ? "selected" : ""}>Extra time</option>
                <option value="penalties" ${state.flags === "penalties" ? "selected" : ""}>Penalties</option>
                <option value="special" ${state.flags === "special" ? "selected" : ""}>ET or penalties</option>
              </select>
            </label>
            <label class="players-field">
              <span class="players-field-label">Home team</span>
              <select id="matches-home" class="players-select">
                <option value="all">Any home side</option>
                ${teamOptions.map((team) => `<option value="${esc(team)}" ${state.home === team ? "selected" : ""}>${esc(team)}</option>`).join("")}
              </select>
            </label>
            <label class="players-field">
              <span class="players-field-label">Away team</span>
              <select id="matches-away" class="players-select">
                <option value="all">Any away side</option>
                ${teamOptions.map((team) => `<option value="${esc(team)}" ${state.away === team ? "selected" : ""}>${esc(team)}</option>`).join("")}
              </select>
            </label>
            <label class="players-field">
              <span class="players-field-label">From date</span>
              <input id="matches-from" class="players-select matches-date-input" type="date" value="${esc(state.from)}">
            </label>
            <label class="players-field">
              <span class="players-field-label">To date</span>
              <input id="matches-to" class="players-select matches-date-input" type="date" value="${esc(state.to)}">
            </label>
          </div>
        </div>

        <div class="players-overview-grid matches-overview-grid">
          <article class="players-overview-card">
            <span class="players-overview-label">Visible matches</span>
            <strong>${esc(String(metrics.visible))}</strong>
          </article>
          <article class="players-overview-card">
            <span class="players-overview-label">Goals in view</span>
            <strong>${esc(String(metrics.totalGoals))}</strong>
          </article>
          <article class="players-overview-card">
            <span class="players-overview-label">Avg goals / match</span>
            <strong>${esc(metrics.avgGoals ? metrics.avgGoals.toFixed(2) : "0.00")}</strong>
          </article>
          <article class="players-overview-card">
            <span class="players-overview-label">Tournaments in view</span>
            <strong>${esc(String(metrics.tournaments))}</strong>
          </article>
          <article class="players-overview-card">
            <span class="players-overview-label">Special endings</span>
            <strong>${esc(String(metrics.special))}</strong>
          </article>
        </div>

        <div class="players-results-head">
          <div class="players-results-copy">
            <strong>${esc(String(matches.length))}</strong> match results currently visible
          </div>
          <button type="button" class="players-reset-btn" id="matches-reset" ${JSON.stringify(state) === JSON.stringify(DEFAULT_STATE) ? "disabled" : ""}>Reset All</button>
        </div>

        ${matches.length ? (
          state.view === "grid"
            ? `<div class="matches-card-grid">${matches.map((match, index) => matchCard(match, index)).join("")}</div>`
            : `<div class="matches-list">${matches.map((match, index) => matchListRow(match, index)).join("")}</div>`
        ) : `
          <div class="players-empty-state">
            <div class="players-empty-icon">&#9906;</div>
            <h3>No matches matched those filters</h3>
            <p>Try broadening the date range, clearing the team filters, or switching back to all tournaments.</p>
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

  function bindSelect(id, key) {
    const field = byId(id);
    if (field) {
      field.addEventListener("change", (event) => updateState({ [key]: event.target.value }));
    }
  }

  function bindEvents() {
    const search = byId("matches-search");
    if (search) {
      search.addEventListener("input", (event) => {
        updateState(
          { search: String(event.target.value || "").trimStart() },
          {
            id: "matches-search",
            start: event.target.selectionStart,
            end: event.target.selectionEnd,
          }
        );
      });
    }

    const clearSearch = byId("matches-search-clear");
    if (clearSearch) clearSearch.addEventListener("click", () => updateState({ search: "" }));

    bindSelect("matches-sort", "sort");
    bindSelect("matches-format", "format");
    bindSelect("matches-tournament", "tournament");
    bindSelect("matches-team", "team");
    bindSelect("matches-home", "home");
    bindSelect("matches-away", "away");
    bindSelect("matches-flags", "flags");
    bindSelect("matches-from", "from");
    bindSelect("matches-to", "to");

    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => updateState({ view: button.getAttribute("data-view") || "grid" }));
    });

    const reset = byId("matches-reset");
    if (reset) {
      reset.addEventListener("click", () => {
        state = { ...DEFAULT_STATE };
        render();
      });
    }
  }
})();
