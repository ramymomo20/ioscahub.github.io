(async function () {
  const { renderLayout, byId, esc, fmtDate, fmtDateTime, showError } = window.HubUI;
  renderLayout("h2h.html", "Head to Head");
  const page = byId("page");
  const fallbackLogo = "assets/icons/iosca-icon.png";

  let allTeams = [];
  let state = {
    team1: "",
    team2: "",
  };
  let pickerInputs = {
    team1: "",
    team2: "",
  };
  let activePicker = "";
  let comparisonState = {
    status: "idle",
    data: null,
    error: "",
  };
  let comparisonRequestId = 0;
  let pickerInputTimer = 0;

  bootstrap();

  async function bootstrap() {
    const params = new URLSearchParams(window.location.search);
    state.team1 = String(params.get("team1") || "").trim();
    state.team2 = String(params.get("team2") || "").trim();
    renderShell();

    try {
      const data = await window.HubApi.teams();
      allTeams = (data.teams || []).map(normalizeTeam);
      hydratePickerInputs();
      if (state.team1 && state.team2) {
        await loadComparison();
      } else {
        render();
      }
    } catch (err) {
      showError(`Failed to load team directory: ${err.message}`);
    }
  }

  function normalizeTeam(raw) {
    return {
      ...raw,
      id: String(raw.guild_id || "").trim(),
      name: String(raw.guild_name || "Unknown Team").trim() || "Unknown Team",
      captainName: String(raw.captain_name || "N/A").trim() || "N/A",
      playerCount: Math.max(0, Math.round(Number(raw.player_count || 0))),
      ratingValue: Number.isFinite(Number(raw.average_rating)) ? Number(raw.average_rating) : null,
    };
  }

  function hydratePickerInputs() {
    const selectedTeam1 = getTeamById(state.team1);
    const selectedTeam2 = getTeamById(state.team2);
    pickerInputs.team1 = selectedTeam1 ? selectedTeam1.name : "";
    pickerInputs.team2 = selectedTeam2 ? selectedTeam2.name : "";
  }

  function getTeamById(teamId) {
    const key = String(teamId || "").trim();
    return allTeams.find((team) => team.id === key) || null;
  }

  function syncStateToUrl() {
    const params = new URLSearchParams();
    if (state.team1) params.set("team1", state.team1);
    if (state.team2) params.set("team2", state.team2);
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }

  function renderShell() {
    page.innerHTML = `
      <section class="h2h-page">
        <div class="h2h-picker-shell">
          <div class="players-loading-bar shimmer"></div>
        </div>
      </section>
    `;
  }

  async function loadComparison() {
    const team1 = getTeamById(state.team1);
    const team2 = getTeamById(state.team2);
    if (!team1 || !team2 || team1.id === team2.id) {
      comparisonState = {
        status: "idle",
        data: null,
        error: "",
      };
      render();
      return;
    }

    const requestId = ++comparisonRequestId;
    comparisonState = {
      status: "loading",
      data: null,
      error: "",
    };
    render();

    try {
      const data = await window.HubApi.teamH2H(team1.id, team2.id, 100);
      if (requestId !== comparisonRequestId) return;
      comparisonState = {
        status: "loaded",
        data,
        error: "",
      };
    } catch (err) {
      if (requestId !== comparisonRequestId) return;
      comparisonState = {
        status: "error",
        data: null,
        error: err.message || "Failed to load comparison",
      };
    }

    render();
  }

  function updateSelection(nextState) {
    clearPickerTimer();
    state = { ...state, ...nextState };
    syncStateToUrl();
    loadComparison();
  }

  function clearPickerTimer() {
    if (pickerInputTimer) {
      window.clearTimeout(pickerInputTimer);
      pickerInputTimer = 0;
    }
  }

  function scoreTeamSearch(team, query) {
    if (!query) return 0;
    const name = String(team.name || "").toLowerCase();
    const captain = String(team.captainName || "").toLowerCase();
    if (name.startsWith(query)) return 300;
    if (name.includes(query)) return 220;
    if (captain.startsWith(query)) return 140;
    if (captain.includes(query)) return 90;
    return -1;
  }

  function searchResults(which) {
    const query = String(pickerInputs[which] || "").trim().toLowerCase();
    const excludeId = which === "team1" ? state.team2 : state.team1;
    const teams = allTeams
      .filter((team) => team.id !== excludeId)
      .map((team) => ({ team, score: scoreTeamSearch(team, query) }))
      .filter((item) => !query || item.score >= 0)
      .sort((left, right) => right.score - left.score || left.team.name.localeCompare(right.team.name))
      .slice(0, 24)
      .map((item) => item.team);
    return teams;
  }

  function pickerCard(which) {
    const selectedTeam = getTeamById(state[which]);
    const results = searchResults(which);
    const isActive = activePicker === which;
    const selectedMarkup = selectedTeam
      ? `
        <button type="button" class="h2h-selected-team" data-open-picker="${esc(which)}">
          <img src="${esc(selectedTeam.guild_icon || fallbackLogo)}" alt="${esc(selectedTeam.name)}" onerror="this.onerror=null;this.src='${fallbackLogo}';">
          <span>
            <strong>${esc(selectedTeam.name)}</strong>
            <small>Captain: ${esc(selectedTeam.captainName)}</small>
          </span>
        </button>
      `
      : '<div class="h2h-selected-empty">No team selected yet</div>';

    return `
      <section class="h2h-picker-card">
        <div class="players-field">
          <span class="players-field-label">${which === "team1" ? "Team 1" : "Team 2"}</span>
          <div class="players-search-shell">
            <span class="players-search-icon">&#9906;</span>
            <input id="${which}-search" class="players-search-input" type="search" placeholder="Search by team name or captain" value="${esc(pickerInputs[which] || "")}" autocomplete="off" spellcheck="false">
            ${pickerInputs[which] ? `<button type="button" class="players-search-clear" data-clear-picker="${esc(which)}" aria-label="Clear ${esc(which)} search">&times;</button>` : ""}
          </div>
        </div>
        ${selectedMarkup}
        ${(isActive || (!selectedTeam && pickerInputs[which])) ? `
          <div class="h2h-results-list">
            ${results.length ? results.map((team) => `
              <button type="button" class="h2h-result-item" data-select-team="${esc(which)}" data-team-id="${esc(team.id)}">
                <img src="${esc(team.guild_icon || fallbackLogo)}" alt="${esc(team.name)}" onerror="this.onerror=null;this.src='${fallbackLogo}';">
                <span>
                  <strong>${esc(team.name)}</strong>
                  <small>${esc(team.captainName)} &middot; ${esc(String(team.playerCount))} players</small>
                </span>
              </button>
            `).join("") : '<div class="h2h-no-results">No teams matched that search.</div>'}
          </div>
        ` : ""}
      </section>
    `;
  }

  function formatBreakdownCard(item) {
    return `
      <article class="h2h-format-card">
        <div class="h2h-format-head">
          <strong>${esc(item.game_type || "Unknown")}</strong>
          <span>${esc(String(item.matches_played || 0))} matches</span>
        </div>
        <div class="h2h-format-body">
          <div><span>Record</span><strong>${esc(`${item.team1_wins}/${item.draws}/${item.team2_wins}`)}</strong></div>
          <div><span>Goals</span><strong>${esc(`${item.team1_goals}-${item.team2_goals}`)}</strong></div>
        </div>
      </article>
    `;
  }

  function resultBadge(result) {
    const value = String(result || "").toUpperCase();
    if (value === "W") return '<span class="form-badge w">W</span>';
    if (value === "D") return '<span class="form-badge d">D</span>';
    if (value === "L") return '<span class="form-badge l">L</span>';
    return '<span class="form-badge">-</span>';
  }

  function renderComparison(team1, team2) {
    if (!team1 || !team2) {
      return `
        <div class="players-empty-state">
          <div class="players-empty-icon">&#9906;</div>
          <h3>Select two teams to compare</h3>
          <p>Pick both sides above and the hub will build a head-to-head view with record, formats, and recent meetings.</p>
        </div>
      `;
    }

    if (comparisonState.status === "loading") {
      return `
        <div class="h2h-loading-grid">
          <div class="players-loading-bar shimmer"></div>
          <div class="players-loading-bar shimmer"></div>
          <div class="players-loading-bar shimmer"></div>
        </div>
      `;
    }

    if (comparisonState.status === "error") {
      return `<div class="error">${esc(comparisonState.error || "Failed to load head-to-head data.")}</div>`;
    }

    if (comparisonState.status !== "loaded" || !comparisonState.data) {
      return '<div class="empty">No comparison data available yet.</div>';
    }

    const summary = comparisonState.data.summary || {};
    const matches = Array.isArray(comparisonState.data.matches) ? comparisonState.data.matches : [];
    const formats = Array.isArray(comparisonState.data.formats) ? comparisonState.data.formats : [];

    return `
      <section class="h2h-comparison">
        <div class="h2h-hero-card">
          <div class="h2h-hero-team">
            <img src="${esc(team1.guild_icon || fallbackLogo)}" alt="${esc(team1.name)}" onerror="this.onerror=null;this.src='${fallbackLogo}';">
            <strong>${esc(team1.name)}</strong>
          </div>
          <div class="h2h-hero-center">
            <div class="players-section-kicker">All-Time Record</div>
            <div class="h2h-record">${esc(`${summary.team1_wins || 0} - ${summary.draws || 0} - ${summary.team2_wins || 0}`)}</div>
            <div class="h2h-record-sub">${esc(`${summary.matches_played || 0} meetings`)}</div>
          </div>
          <div class="h2h-hero-team right">
            <img src="${esc(team2.guild_icon || fallbackLogo)}" alt="${esc(team2.name)}" onerror="this.onerror=null;this.src='${fallbackLogo}';">
            <strong>${esc(team2.name)}</strong>
          </div>
        </div>

        <div class="players-overview-grid h2h-overview-grid">
          <article class="players-overview-card">
            <span class="players-overview-label">${esc(team1.name)} wins</span>
            <strong>${esc(String(summary.team1_wins || 0))}</strong>
          </article>
          <article class="players-overview-card">
            <span class="players-overview-label">Draws</span>
            <strong>${esc(String(summary.draws || 0))}</strong>
          </article>
          <article class="players-overview-card">
            <span class="players-overview-label">${esc(team2.name)} wins</span>
            <strong>${esc(String(summary.team2_wins || 0))}</strong>
          </article>
          <article class="players-overview-card">
            <span class="players-overview-label">Goals</span>
            <strong>${esc(`${summary.team1_goals || 0} - ${summary.team2_goals || 0}`)}</strong>
          </article>
          <article class="players-overview-card">
            <span class="players-overview-label">Avg total goals</span>
            <strong>${esc(Number(summary.avg_total_goals || 0).toFixed(2))}</strong>
          </article>
          <article class="players-overview-card">
            <span class="players-overview-label">${esc(team1.name)} win rate</span>
            <strong>${esc(Number(summary.team1_win_rate || 0).toFixed(1))}%</strong>
          </article>
        </div>

        <div class="card" style="margin:0;">
          <h3>Format Breakdown</h3>
          <div class="h2h-format-grid">
            ${formats.length ? formats.map(formatBreakdownCard).join("") : '<div class="empty">No format breakdown available yet.</div>'}
          </div>
        </div>

        <div class="card" style="margin:0;">
          <h3>Recent Meetings</h3>
          <div class="h2h-match-list">
            ${matches.length ? matches.map((match) => {
              const inner = `
                <div class="h2h-match-main">
                  <div class="h2h-match-scoreline">
                    <span>${esc(match.home_team_name || "Home")}</span>
                    <strong>${esc(`${match.home_score} - ${match.away_score}`)}</strong>
                    <span>${esc(match.away_team_name || "Away")}</span>
                  </div>
                  <div class="h2h-match-meta">
                    <span>${esc(match.tournament_name || "Independent Match")}</span>
                    <span>${esc(match.game_type || "Unknown")}</span>
                    <span>${esc(fmtDateTime(match.datetime))}</span>
                    ${match.is_forfeit ? '<span class="badge">FORFEIT</span>' : ''}
                    ${match.extratime ? '<span class="badge">ET</span>' : ''}
                    ${match.penalties ? '<span class="badge">PEN</span>' : ''}
                  </div>
                </div>
              `;
              const rowContent = match.id
                ? `<a class="h2h-match-link" href="match.html?id=${encodeURIComponent(match.id)}">${inner}</a>`
                : `<div class="h2h-match-link static">${inner}</div>`;
              return `
                <article class="h2h-match-row">
                  ${resultBadge(match.team1_result)}
                  ${rowContent}
                </article>
              `;
            }).join("") : '<div class="empty">These teams have not played each other yet.</div>'}
          </div>
        </div>
      </section>
    `;
  }

  function render(restoreFocus) {
    syncStateToUrl();
    const team1 = getTeamById(state.team1);
    const team2 = getTeamById(state.team2);

    page.innerHTML = `
      <section class="h2h-page">
        <div class="h2h-picker-shell">
          <div class="players-toolbar">
            <div class="players-toolbar-head">
              <div>
                <div class="players-section-kicker">Head to Head</div>
                <h2 class="players-section-title">Compare any two teams with live search and direct match history</h2>
                <div class="players-section-copy">Pick a side on each panel, swap them instantly, and drill into the meetings below.</div>
              </div>
              <div class="h2h-toolbar-actions">
                <button type="button" id="h2h-swap" class="players-reset-btn" ${team1 && team2 ? "" : "disabled"}>Swap Teams</button>
                <a class="player-browser-action primary" href="teams.html">Browse Teams</a>
              </div>
            </div>
            <div class="h2h-picker-grid">
              ${pickerCard("team1")}
              <div class="h2h-versus-pill">VS</div>
              ${pickerCard("team2")}
            </div>
          </div>
        </div>

        ${renderComparison(team1, team2)}
      </section>
    `;

    bindEvents();

    if (restoreFocus && restoreFocus.id) {
      const target = byId(restoreFocus.id);
      if (target) {
        target.focus({ preventScroll: true });
        if (typeof restoreFocus.start === "number" && typeof restoreFocus.end === "number" && typeof target.setSelectionRange === "function") {
          target.setSelectionRange(restoreFocus.start, restoreFocus.end);
        }
      }
    }
  }

  function bindEvents() {
    ["team1", "team2"].forEach((which) => {
      const input = byId(`${which}-search`);
      if (input) {
        input.addEventListener("focus", () => {
          activePicker = which;
        });
        input.addEventListener("input", (event) => {
          clearPickerTimer();
          pickerInputs[which] = String(event.target.value || "");
          activePicker = which;
          if (state[which] && getTeamById(state[which])?.name !== pickerInputs[which]) {
            state[which] = "";
            syncStateToUrl();
          }
          pickerInputTimer = window.setTimeout(() => {
            render({
              id: `${which}-search`,
              start: event.target.selectionStart,
              end: event.target.selectionEnd,
            });
          }, 120);
        });
        input.addEventListener("blur", () => {
          clearPickerTimer();
          window.setTimeout(() => {
            if (activePicker === which) {
              activePicker = "";
              render();
            }
          }, 120);
        });
      }
    });

    document.querySelectorAll("[data-select-team]").forEach((button) => {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const which = button.getAttribute("data-select-team") || "";
        const teamId = button.getAttribute("data-team-id") || "";
        const team = getTeamById(teamId);
        if (!which || !team) return;
        pickerInputs[which] = team.name;
        activePicker = "";
        updateSelection({ [which]: team.id });
      });
    });

    document.querySelectorAll("[data-clear-picker]").forEach((button) => {
      button.addEventListener("click", () => {
        const which = button.getAttribute("data-clear-picker") || "";
        if (!which) return;
        clearPickerTimer();
        pickerInputs[which] = "";
        activePicker = which;
        state[which] = "";
        comparisonState = {
          status: "idle",
          data: null,
          error: "",
        };
        render();
      });
    });

    document.querySelectorAll("[data-open-picker]").forEach((button) => {
      button.addEventListener("click", () => {
        const which = button.getAttribute("data-open-picker") || "";
        activePicker = which;
        render({ id: `${which}-search`, start: 0, end: pickerInputs[which]?.length || 0 });
      });
    });

    const swap = byId("h2h-swap");
    if (swap) {
      swap.addEventListener("click", () => {
        if (!state.team1 || !state.team2) return;
        const nextTeam1 = state.team2;
        const nextTeam2 = state.team1;
        const nextInput1 = pickerInputs.team2;
        const nextInput2 = pickerInputs.team1;
        state.team1 = nextTeam1;
        state.team2 = nextTeam2;
        pickerInputs.team1 = nextInput1;
        pickerInputs.team2 = nextInput2;
        syncStateToUrl();
        loadComparison();
      });
    }
  }
})();
