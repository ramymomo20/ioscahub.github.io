(function () {
  "use strict";

  const state = {
    payload: null,
    selectedTournamentId: null,
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function fmtDateTime(value) {
    if (!value) return "N/A";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "N/A";
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function fmtDate(value) {
    if (!value) return "N/A";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "N/A";
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function maybeLogo(url, alt) {
    if (!url) return "";
    return `<img class="team-logo" src="${esc(url)}" alt="${esc(alt || "logo")}" loading="lazy">`;
  }

  function renderSummary() {
    const root = byId("summary");
    if (!root || !state.payload) return;
    const summary = state.payload.summary || {};
    const cards = [
      ["Equipos", summary.teams_total || 0],
      ["Partidos", summary.matches_total || 0],
      ["Torneos", summary.tournaments_total || 0],
      ["Torneos activos", summary.active_tournaments_total || 0],
      ["Agenda abierta", summary.upcoming_schedules_total || 0],
    ];
    root.innerHTML = cards
      .map(([label, value]) => {
        return [
          '<article class="summary-card">',
          `<div class="label">${esc(label)}</div>`,
          `<div class="value">${esc(value)}</div>`,
          "</article>",
        ].join("");
      })
      .join("");
  }

  function renderGeneratedAt() {
    const el = byId("generatedAt");
    if (!el || !state.payload) return;
    el.textContent = `Actualizado: ${fmtDateTime(state.payload.generated_at)}`;
  }

  function renderRecentMatches() {
    const root = byId("matchesList");
    if (!root || !state.payload) return;
    const matches = state.payload.recent_matches || [];
    if (!matches.length) {
      root.innerHTML = '<div class="list-item"><div class="main">Sin resultados por ahora.</div></div>';
      return;
    }
    root.innerHTML = matches
      .map((m) => {
        const score = `${m.home_score ?? 0} - ${m.away_score ?? 0}`;
        const tour = m.tournament_name ? ` | ${m.tournament_name}` : "";
        return [
          '<article class="list-item">',
          `<div class="meta">${fmtDateTime(m.datetime)}${esc(tour)}</div>`,
          `<div class="main">${esc(m.home_team_name)} <span class="score">${esc(score)}</span> ${esc(m.away_team_name)}</div>`,
          "</article>",
        ].join("");
      })
      .join("");
  }

  function getSelectedTournament() {
    if (!state.payload) return null;
    const tournaments = state.payload.tournaments || [];
    if (!tournaments.length) return null;
    if (!state.selectedTournamentId) return tournaments[0];
    return tournaments.find((t) => String(t.id) === String(state.selectedTournamentId)) || tournaments[0];
  }

  function renderTournamentSelect() {
    const select = byId("tournamentSelect");
    if (!select || !state.payload) return;
    const tournaments = state.payload.tournaments || [];
    if (!tournaments.length) {
      select.innerHTML = '<option value="">Sin torneos</option>';
      select.disabled = true;
      return;
    }
    state.selectedTournamentId = state.selectedTournamentId || String(tournaments[0].id);
    select.innerHTML = tournaments
      .map((t) => {
        const selected = String(t.id) === String(state.selectedTournamentId) ? ' selected="selected"' : "";
        return `<option value="${esc(t.id)}"${selected}>${esc(t.name)} (${esc(t.status)})</option>`;
      })
      .join("");
    select.disabled = false;
    select.addEventListener("change", (event) => {
      state.selectedTournamentId = String(event.target.value);
      renderTournamentDetails();
    });
  }

  function renderTournamentMeta(tournament) {
    const root = byId("tournamentMeta");
    if (!root) return;
    if (!tournament) {
      root.innerHTML = "";
      return;
    }
    const chips = [
      `Formato: ${tournament.format || "N/A"}`,
      `Estado: ${tournament.status || "N/A"}`,
      `Equipos: ${tournament.num_teams || 0}`,
      `Puntos W/D/L: ${tournament.points_win || 3}/${tournament.points_draw || 1}/${tournament.points_loss || 0}`,
    ];
    root.innerHTML = chips.map((v) => `<span class="chip">${esc(v)}</span>`).join("");
  }

  function renderStandings(tournament) {
    const root = byId("standingsTable");
    if (!root) return;
    const rows = (tournament && tournament.standings) || [];
    if (!rows.length) {
      root.innerHTML = '<div class="list-item"><div class="main">Sin tabla por ahora.</div></div>';
      return;
    }
    root.innerHTML = [
      "<table>",
      "<thead><tr><th>#</th><th>Equipo</th><th>MJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>PTS</th></tr></thead>",
      "<tbody>",
      rows
        .map((r, i) => {
          return [
            "<tr>",
            `<td>${i + 1}</td>`,
            `<td><div class="team-cell">${maybeLogo(r.team_icon, r.team_name)}<span>${esc(r.team_name)}</span></div></td>`,
            `<td>${esc(r.matches_played ?? 0)}</td>`,
            `<td>${esc(r.wins ?? 0)}</td>`,
            `<td>${esc(r.draws ?? 0)}</td>`,
            `<td>${esc(r.losses ?? 0)}</td>`,
            `<td>${esc(r.goals_for ?? 0)}</td>`,
            `<td>${esc(r.goals_against ?? 0)}</td>`,
            `<td>${esc(r.goal_diff ?? 0)}</td>`,
            `<td>${esc(r.points ?? 0)}</td>`,
            "</tr>",
          ].join("");
        })
        .join(""),
      "</tbody>",
      "</table>",
    ].join("");
  }

  function renderTopPlayers(tournament) {
    const root = byId("topPlayers");
    if (!root) return;
    const players = (tournament && tournament.top_players) || [];
    if (!players.length) {
      root.innerHTML = '<div class="list-item"><div class="main">Sin datos de jugadores por ahora.</div></div>';
      return;
    }
    root.innerHTML = players
      .slice(0, 12)
      .map((p, index) => {
        return [
          '<article class="list-item">',
          `<div class="meta">#${index + 1} | ${esc(p.team_name || "N/A")}</div>`,
          `<div class="main">${esc(p.player_name || "Unknown")}</div>`,
          `<div class="meta">Goles: ${esc(p.goals || 0)} | Asist: ${esc(p.assists || 0)} | Atajadas: ${esc(p.keeper_saves || 0)} | PJ: ${esc(p.matches_played || 0)}</div>`,
          "</article>",
        ].join("");
      })
      .join("");
  }

  function renderFixtures(tournament) {
    const root = byId("fixturesList");
    if (!root) return;
    const fixtures = (tournament && tournament.fixtures) || [];
    if (!fixtures.length) {
      root.innerHTML = '<div class="list-item"><div class="main">Sin fixtures por ahora.</div></div>';
      return;
    }
    root.innerHTML = fixtures
      .slice(0, 20)
      .map((f) => {
        const status = f.is_played ? "Jugado" : (f.is_active ? "Pendiente" : "Cerrado");
        return [
          '<article class="list-item">',
          `<div class="meta">${esc(f.week_label || "Fecha")} | ${esc(status)}</div>`,
          `<div class="main">${esc(f.home_team_name)} vs ${esc(f.away_team_name)}</div>`,
          `<div class="meta">${f.played_at ? `Jugado: ${fmtDate(f.played_at)}` : "Sin fecha de juego registrada"}</div>`,
          "</article>",
        ].join("");
      })
      .join("");
  }

  function renderTournamentMatches(tournament) {
    const root = byId("tournamentMatches");
    if (!root) return;
    const matches = (tournament && tournament.recent_matches) || [];
    if (!matches.length) {
      root.innerHTML = '<div class="list-item"><div class="main">Este torneo aun no tiene partidos.</div></div>';
      return;
    }
    root.innerHTML = matches
      .map((m) => {
        return [
          '<article class="list-item">',
          `<div class="meta">${fmtDateTime(m.datetime)}</div>`,
          `<div class="main">${esc(m.home_team_name)} <span class="score">${esc(m.home_score ?? 0)} - ${esc(m.away_score ?? 0)}</span> ${esc(m.away_team_name)}</div>`,
          "</article>",
        ].join("");
      })
      .join("");
  }

  function renderTournamentDetails() {
    const tournament = getSelectedTournament();
    renderTournamentMeta(tournament);
    renderStandings(tournament);
    renderTopPlayers(tournament);
    renderFixtures(tournament);
    renderTournamentMatches(tournament);
  }

  function renderTeamsTable() {
    const root = byId("teamsTable");
    if (!root || !state.payload) return;
    const teams = state.payload.teams || [];
    if (!teams.length) {
      root.innerHTML = '<div class="list-item"><div class="main">Sin equipos por ahora.</div></div>';
      return;
    }
    root.innerHTML = [
      "<table>",
      "<thead><tr><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>Rating</th></tr></thead>",
      "<tbody>",
      teams
        .map((t) => {
          return [
            "<tr>",
            `<td><div class="team-cell">${maybeLogo(t.guild_icon, t.guild_name)}<span>${esc(t.guild_name)}</span></div></td>`,
            `<td>${esc(t.matches_played ?? 0)}</td>`,
            `<td>${esc(t.wins ?? 0)}</td>`,
            `<td>${esc(t.draws ?? 0)}</td>`,
            `<td>${esc(t.losses ?? 0)}</td>`,
            `<td>${esc(t.goals_for ?? 0)}</td>`,
            `<td>${esc(t.goals_against ?? 0)}</td>`,
            `<td>${esc(t.goal_diff ?? 0)}</td>`,
            `<td>${esc(t.average_rating ?? "N/A")}</td>`,
            "</tr>",
          ].join("");
        })
        .join(""),
      "</tbody>",
      "</table>",
    ].join("");
  }

  function renderSchedules() {
    const root = byId("schedulesList");
    if (!root || !state.payload) return;
    const rows = state.payload.upcoming_schedules || [];
    if (!rows.length) {
      root.innerHTML = '<div class="list-item"><div class="main">No hay agenda abierta.</div></div>';
      return;
    }
    root.innerHTML = rows
      .map((s) => {
        const status = String(s.status || "").toLowerCase();
        const statusClass = status === "confirmed" ? "badge-confirmed" : status === "countered" ? "badge-countered" : "badge-pending";
        return [
          '<article class="list-item">',
          `<div class="meta">${esc(s.tournament_name || "Torneo")} | <span class="${esc(statusClass)}">${esc(s.status || "pending")}</span></div>`,
          `<div class="main">${esc(s.home_team_name)} vs ${esc(s.away_team_name)}</div>`,
          `<div class="meta">${fmtDateTime(s.proposed_time)} | Server: ${esc(s.server_name || "TBD")}</div>`,
          "</article>",
        ].join("");
      })
      .join("");
  }

  function showError(message) {
    const el = byId("errorBanner");
    if (!el) return;
    el.classList.remove("hidden");
    el.textContent = message;
  }

  async function loadData() {
    const response = await fetch(`data/hub.json?v=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`No se pudo cargar data/hub.json (${response.status})`);
    }
    return response.json();
  }

  async function init() {
    try {
      state.payload = await loadData();
      renderGeneratedAt();
      renderSummary();
      renderRecentMatches();
      renderTournamentSelect();
      renderTournamentDetails();
      renderTeamsTable();
      renderSchedules();
    } catch (error) {
      showError(`Error cargando el hub: ${error.message}`);
      console.error(error);
    }
  }

  init();
})();
