(async function () {
  const { renderLayout, byId, esc, fmtDateTime, showError } = window.HubUI;
  renderLayout("tournaments.html", "Tournaments", {
    layout: "standard",
    eyebrow: "Competition Posters",
  });
  const page = byId("page");

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function statusTone(status) {
    const key = String(status || "").toLowerCase();
    if (key === "active") return "w";
    if (key === "ended" || key === "finished") return "d";
    return "l";
  }

  try {
    let data;
    try {
      data = await window.HubStatic.tournaments();
    } catch (_) {
      data = await window.HubApi.tournaments();
    }

    const rows = Array.isArray(data.tournaments) ? data.tournaments : [];
    const active = rows.filter((row) => String(row.status || "").toLowerCase() === "active").length;
    const totalFixtures = rows.reduce((sum, row) => sum + num(row.fixtures_total), 0);
    const totalPlayed = rows.reduce((sum, row) => sum + num(row.fixtures_played), 0);

    page.innerHTML = `
      <div class="hub-v2">
        <section class="v2-card tier-a">
          <div class="v2-section-head">
            <div>
              <div class="v2-kicker">Tournament Center</div>
              <h3>Competition Posters</h3>
            </div>
            <div class="v2-chip-row">
              <span class="v2-chip">${esc(String(rows.length))} tournaments</span>
              <span class="v2-chip">${esc(String(active))} active</span>
              <span class="v2-chip">${esc(String(totalPlayed))}/${esc(String(totalFixtures))} fixtures played</span>
            </div>
          </div>
          <div class="v2-subtitle">League tables, leaderboards, and fixture hubs for every active competition.</div>
        </section>

        <section class="v2-grid four">
          <article class="v2-stat-tile"><span class="v2-label">Total Tournaments</span><strong>${esc(String(rows.length))}</strong></article>
          <article class="v2-stat-tile"><span class="v2-label">Active</span><strong>${esc(String(active))}</strong></article>
          <article class="v2-stat-tile"><span class="v2-label">Fixtures Played</span><strong>${esc(String(totalPlayed))}</strong></article>
          <article class="v2-stat-tile"><span class="v2-label">Fixtures Total</span><strong>${esc(String(totalFixtures))}</strong></article>
        </section>

        <section class="v2-grid three">
          ${rows.length ? rows.map((tournament) => `
            <a class="v2-card tier-b v2-tournament-poster large" href="tournament.html?id=${encodeURIComponent(tournament.id)}">
              <div class="v2-chip-row">
                <span class="v2-result ${statusTone(tournament.status)}">${esc(String(tournament.status || "Unknown").slice(0, 1).toUpperCase())}</span>
                <span class="v2-chip">${esc(tournament.format || "Unknown")}</span>
                <span class="v2-chip">${esc(String(tournament.league_count || 1))} leagues</span>
              </div>
              <h3>${esc(tournament.name || "Tournament")}</h3>
              <div class="v2-subtitle">${esc(String(tournament.num_teams || 0))} teams competing</div>
              <div class="v2-snapshot">
                <article class="v2-stat-tile">
                  <span class="v2-label">Fixtures</span>
                  <strong>${esc(String(tournament.fixtures_played || 0))}/${esc(String(tournament.fixtures_total || 0))}</strong>
                </article>
                <article class="v2-stat-tile">
                  <span class="v2-label">Updated</span>
                  <strong>${esc(tournament.updated_at ? fmtDateTime(tournament.updated_at) : "N/A")}</strong>
                </article>
              </div>
            </a>
          `).join("") : '<div class="v2-mini-card">No tournaments found.</div>'}
        </section>
      </div>
    `;
  } catch (err) {
    showError(`Failed to load tournaments: ${err.message}`);
  }
})();
