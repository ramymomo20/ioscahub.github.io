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

  function hashString(value) {
    const input = String(value || 'iosca');
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function teamTheme(seed) {
    const hash = hashString(seed);
    const hue = hash % 360;
    const accent = `hsl(${hue} 78% 60%)`;
    const accentStrong = `hsl(${hue} 84% 54%)`;
    const accentSoft = `hsla(${hue} 80% 62% / 0.18)`;
    const accentBorder = `hsla(${hue} 88% 70% / 0.34)`;
    const accentGlow = `hsla(${hue} 85% 58% / 0.28)`;
    const accentSurface = `linear-gradient(160deg, hsla(${hue} 72% 20% / 0.96), hsla(${(hue + 22) % 360} 70% 12% / 0.98))`;
    return {
      hue,
      accent,
      accentStrong,
      accentSoft,
      accentBorder,
      accentGlow,
      accentSurface
    };
  }

  function teamThemeStyle(seed) {
    const theme = teamTheme(seed);
    return [
      `--team-accent:${theme.accent}`,
      `--team-accent-strong:${theme.accentStrong}`,
      `--team-accent-soft:${theme.accentSoft}`,
      `--team-accent-border:${theme.accentBorder}`,
      `--team-accent-glow:${theme.accentGlow}`,
      `--team-accent-surface:${theme.accentSurface}`
    ].join(';');
  }

  function pageIsActive(activePage, href) {
    if (href === 'index.html') return activePage === 'index.html';
    if (href === 'players.html') return ['players.html', 'player.html'].includes(activePage);
    if (href === 'teams.html') return ['teams.html', 'team.html'].includes(activePage);
    if (href === 'matches.html') return ['matches.html', 'match.html'].includes(activePage);
    if (href === 'tournaments.html') return ['tournaments.html', 'tournament.html'].includes(activePage);
    if (href === 'rankings.html') return ['rankings.html'].includes(activePage);
    if (href === 'h2h.html') return ['h2h.html'].includes(activePage);
    return activePage === href;
  }

  function currentTheme() {
    try {
      return localStorage.getItem('theme') === 'light' ? 'light' : 'dark';
    } catch (_) {
      return 'dark';
    }
  }

  function applyTheme(theme) {
    const nextTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.classList.toggle('light', nextTheme === 'light');
    document.documentElement.setAttribute('data-theme', nextTheme);
    try {
      localStorage.setItem('theme', nextTheme);
    } catch (_) {}
  }

  function bindThemeToggle(root) {
    const toggle = root.querySelector('[data-theme-toggle]');
    if (!toggle) return;
    toggle.checked = currentTheme() === 'light';
    toggle.addEventListener('change', () => {
      applyTheme(toggle.checked ? 'light' : 'dark');
    });
  }

  function bindHeaderSearch(root) {
    const form = root.querySelector('[data-hub-search-form]');
    if (!form) return;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = root.querySelector('[data-hub-search-input]');
      const target = root.querySelector('[data-hub-search-target]');
      const query = String(input && input.value || '').trim();
      const href = target && target.value === 'teams' ? 'teams.html' : 'players.html';
      if (!query) {
        window.location.href = href;
        return;
      }
      window.location.href = `${href}?search=${encodeURIComponent(query)}`;
    });
  }

  function navTemplate(activePage) {
    const nav = [
      { href: 'index.html', label: 'Home', tone: '#ff3aa7' },
      {
        href: 'players.html',
        label: 'Players',
        tone: '#ff5fb9',
        children: [
          ['players.html', 'Browser'],
          ['rankings.html', 'Leaderboards']
        ]
      },
      {
        href: 'teams.html',
        label: 'Teams',
        tone: '#ff7a72',
        children: [
          ['teams.html', 'Club Browser'],
          ['h2h.html', 'Head To Head']
        ]
      },
      {
        href: 'matches.html',
        label: 'Matches',
        tone: '#f9a43a',
        children: [
          ['matches.html', 'Archive'],
          ['match.html', 'Match Detail']
        ]
      },
      {
        href: 'tournaments.html',
        label: 'Tournaments',
        tone: '#58d6a6',
        children: [
          ['tournaments.html', 'Tournaments'],
          ['builder.html', 'Lineup Builder']
        ]
      },
      { href: 'servers.html', label: 'Servers', tone: '#53b5ff' },
      { href: 'discord.html', label: 'Discord', tone: '#8b9dff' }
    ];

    return `
      <header class="topbar">
        <div class="topbar-inner">
          <a class="brand" href="index.html">
            <span class="brand-mark">
              <img class="brand-logo" src="assets/icons/iosca-icon.png" alt="IOSCA">
            </span>
            <span class="brand-copy">
              <span class="brand-name">IOSCA Hub</span>
              <span class="brand-subtitle">Competition Intelligence</span>
            </span>
          </a>

          <nav class="nav-strip" aria-label="Primary navigation">
            ${nav.map((item) => {
              const active = pageIsActive(activePage, item.href);
              if (!item.children) {
                return `
                  <a class="nav-link ${active ? 'active' : ''}" style="--nav-accent:${item.tone};" href="${item.href}">
                    ${item.label}
                  </a>
                `;
              }
              return `
                <div class="nav-group">
                  <a class="nav-group-toggle ${active ? 'active' : ''}" style="--nav-accent:${item.tone};" href="${item.href}">
                    <span>${item.label}</span>
                    <span class="nav-caret">+</span>
                  </a>
                  <div class="nav-flyout">
                    ${item.children.map(([href, label]) => `
                      <a class="${pageIsActive(activePage, href) ? 'active' : ''}" href="${href}">
                        <strong>${label}</strong>
                        <span>${label === 'Leaderboards' ? 'Top performers and position leaders' : label === 'Head To Head' ? 'Compare clubs and recent meetings' : label === 'Match Detail' ? 'Deep dive into a single fixture' : 'Open section'}</span>
                      </a>
                    `).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </nav>

          <div class="topbar-actions">
            <form class="header-search" data-hub-search-form>
              <span>⌕</span>
              <input data-hub-search-input type="search" placeholder="Search players or teams" autocomplete="off" spellcheck="false">
              <select data-hub-search-target aria-label="Search category">
                <option value="players">Players</option>
                <option value="teams">Teams</option>
              </select>
            </form>
            <label class="theme-switch" title="Toggle light mode">
              <input type="checkbox" data-theme-toggle aria-label="Toggle light mode">
              <span class="theme-slider">
                <span class="theme-star theme-star-1"></span>
                <span class="theme-star theme-star-2"></span>
                <span class="theme-star theme-star-3"></span>
                <svg class="theme-cloud" viewBox="0 0 100 60" fill="white">
                  <ellipse cx="50" cy="45" rx="40" ry="15"></ellipse>
                  <ellipse cx="35" cy="38" rx="20" ry="18"></ellipse>
                  <ellipse cx="60" cy="33" rx="25" ry="22"></ellipse>
                </svg>
              </span>
            </label>
          </div>
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

  function renderLayout(activePage, pageTitle, options) {
    ensureFavicon();
    applyTheme(currentTheme());
    const root = byId('app');
    if (!root) return;
    const opts = options && typeof options === 'object' ? options : {};
    const layout = String(opts.layout || 'standard');
    const eyebrow = String(opts.eyebrow || 'IOSCA Community Hub');
    const compact = Boolean(opts.compactHeader);
    const pageShellClass = layout === 'wide'
      ? 'page-shell is-wide'
      : layout === 'narrow'
        ? 'page-shell is-narrow'
        : layout === 'fluid'
          ? 'page-shell is-fluid'
          : 'page-shell';
    root.innerHTML = `
      <div class="site-shell">
        ${navTemplate(activePage)}
        <main class="${pageShellClass} ${compact ? 'main-compact' : ''}">
        <section class="page-banner">
          <div class="page-banner-copy">
            <span class="page-banner-eyebrow">${esc(eyebrow)}</span>
            <h1>${esc(pageTitle)}</h1>
          </div>
        </section>
          <div id="page" class="page"></div>
        </main>
      </div>
    `;
    bindThemeToggle(root);
    bindHeaderSearch(root);
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
    statIcons,
    applyTheme,
    teamTheme,
    teamThemeStyle
  };
})();
