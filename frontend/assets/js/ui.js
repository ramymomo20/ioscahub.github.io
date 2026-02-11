(function () {
  function byId(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function fmtDate(value) {
    if (!value) return 'N/A';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  }

  function fmtDateTime(value) {
    if (!value) return 'N/A';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  }

  function navTemplate(activePage) {
    const links = [
      ['index.html', 'Home', 'home', '#7cf2ff'],
      ['rankings.html', 'Rankings', 'rankings', '#76b8ff'],
      ['players.html', 'Players', 'players', '#5de2a5'],
      ['matches.html', 'Matches', 'matches', '#9ac6ff'],
      ['tournaments.html', 'Tournaments', 'tournaments', '#86f0ff'],
      ['teams.html', 'Teams', 'teams', '#89a8ff'],
      ['servers.html', 'Servers', 'servers', '#7cdcff'],
      ['discord.html', 'Discord', 'discord', '#8be4ff']
    ];

    return `
      <header class="header">
        <div class="header-inner">
          <a class="brand" href="index.html">
            <span class="brand-dot"></span>
            IOSCA Hub
          </a>
          <nav class="nav">
            ${links.map(([href, label, key, accent]) => {
              const active = activePage === href ? 'active' : '';
              return `<a class="nav-link nav-${key} ${active}" style="--nav-accent:${accent};" href="${href}">${label}</a>`;
            }).join('')}
          </nav>
        </div>
      </header>
    `;
  }

  function ensureFavicon() {
    const href = 'assets/icons/iosca-icon.png';
    let icon = document.querySelector("link[rel='icon']");
    if (!icon) {
      icon = document.createElement('link');
      icon.setAttribute('rel', 'icon');
      document.head.appendChild(icon);
    }
    icon.setAttribute('type', 'image/png');
    icon.setAttribute('href', href);

    let apple = document.querySelector("link[rel='apple-touch-icon']");
    if (!apple) {
      apple = document.createElement('link');
      apple.setAttribute('rel', 'apple-touch-icon');
      document.head.appendChild(apple);
    }
    apple.setAttribute('href', href);
  }

  function renderLayout(activePage, pageTitle) {
    ensureFavicon();
    const root = byId('app');
    if (!root) return;
    root.innerHTML = `
      ${navTemplate(activePage)}
      <main class="main">
        <section class="hero-banner">
          <div class="hero-banner-glow"></div>
          <div class="hero-banner-inner">
            <img class="hero-logo" src="assets/icons/iosca-icon.png" alt="IOSCA logo" onerror="if(!this.dataset.fallback){this.dataset.fallback='1';this.src='assets/img/iosca-logo.png';}else{this.style.display='none';}">
            <div>
              <div class="hero-kicker">IOSCA COMMUNITY</div>
              <h1 class="hero-title">${esc(pageTitle)}</h1>
            </div>
          </div>
        </section>
        <section class="card page-card">
          <div id="page"></div>
        </section>
      </main>
    `;
  }

  function showError(message) {
    const page = byId('page');
    if (!page) return;
    page.innerHTML = `<div class="error">${esc(message)}</div>`;
  }

  function parseLineupEntries(lineupData) {
    const out = [];
    if (!Array.isArray(lineupData)) return out;
    for (const item of lineupData) {
      if (!item || typeof item !== 'object') continue;
      const pos = item.position || item.pos || item.slot || '';
      const name = item.name || item.player_name || item.discord_name || item.player || '';
      const steamId = item.steam_id || item.steamId || '';
      const started = item.started;
      if (!pos) continue;
      out.push({ pos, name: name || steamId || '-', steamId, started });
    }
    return out;
  }

  function statIcons(stats) {
    const bits = [];
    const goals = Number(stats?.goals || 0);
    const assists = Number(stats?.assists || 0);
    const saves = Number(stats?.keeper_saves || 0);
    const rc = Number(stats?.red_cards || 0);
    const yc = Number(stats?.yellow_cards || 0);
    if (goals > 0) bits.push(`<span class="icon goal" title="Goals">G</span>`);
    if (assists > 0) bits.push(`<span class="icon assist" title="Assists">A</span>`);
    if (saves > 0) bits.push(`<span class="icon save" title="Saves">S</span>`);
    if (rc > 0) bits.push(`<span class="icon card-red" title="Red card">R</span>`);
    else if (yc > 0) bits.push(`<span class="icon card-yellow" title="Yellow card">Y</span>`);
    if (!bits.length) return '';
    return `<span class="stat-icons">${bits.join('')}</span>`;
  }

  window.HubUI = {
    byId,
    esc,
    fmtDate,
    fmtDateTime,
    renderLayout,
    showError,
    parseLineupEntries,
    statIcons
  };
})();
