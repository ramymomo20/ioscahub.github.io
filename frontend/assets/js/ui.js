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
    const palettes = [
      {
        accent: '#179fff',
        accentStrong: '#8af3ff',
        accentSoft: 'rgba(23, 159, 255, 0.16)',
        accentBorder: 'rgba(138, 243, 255, 0.28)',
        accentGlow: 'rgba(23, 159, 255, 0.2)',
        accentSurface: 'linear-gradient(160deg, rgba(8, 35, 76, 0.98), rgba(8, 16, 36, 0.98))'
      },
      {
        accent: '#00d4ff',
        accentStrong: '#9bf7ff',
        accentSoft: 'rgba(0, 212, 255, 0.16)',
        accentBorder: 'rgba(155, 247, 255, 0.28)',
        accentGlow: 'rgba(0, 212, 255, 0.22)',
        accentSurface: 'linear-gradient(160deg, rgba(5, 46, 74, 0.98), rgba(6, 20, 34, 0.98))'
      },
      {
        accent: '#34d399',
        accentStrong: '#9cfccf',
        accentSoft: 'rgba(52, 211, 153, 0.16)',
        accentBorder: 'rgba(156, 252, 207, 0.28)',
        accentGlow: 'rgba(52, 211, 153, 0.2)',
        accentSurface: 'linear-gradient(160deg, rgba(10, 49, 40, 0.98), rgba(7, 19, 22, 0.98))'
      },
      {
        accent: '#f5cf45',
        accentStrong: '#fff1a9',
        accentSoft: 'rgba(245, 207, 69, 0.16)',
        accentBorder: 'rgba(255, 241, 169, 0.3)',
        accentGlow: 'rgba(245, 207, 69, 0.18)',
        accentSurface: 'linear-gradient(160deg, rgba(56, 42, 9, 0.98), rgba(19, 16, 9, 0.98))'
      },
      {
        accent: '#ff6b6b',
        accentStrong: '#ffb1b1',
        accentSoft: 'rgba(255, 107, 107, 0.14)',
        accentBorder: 'rgba(255, 177, 177, 0.28)',
        accentGlow: 'rgba(255, 107, 107, 0.18)',
        accentSurface: 'linear-gradient(160deg, rgba(60, 16, 21, 0.98), rgba(20, 10, 14, 0.98))'
      }
    ];
    return palettes[hash % palettes.length];
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
    if (href === 'players.html') return ['players.html', 'player.html', 'hall-of-fame.html'].includes(activePage);
    if (href === 'teams.html') return ['teams.html', 'team.html'].includes(activePage);
    if (href === 'matches.html') return ['matches.html', 'match.html'].includes(activePage);
    if (href === 'tournaments.html') return ['tournaments.html', 'tournament.html'].includes(activePage);
    if (href === 'rankings.html') return ['rankings.html'].includes(activePage);
    if (href === 'hall-of-fame.html') return ['hall-of-fame.html'].includes(activePage);
    if (href === 'h2h.html') return ['h2h.html'].includes(activePage);
    return activePage === href;
  }

  function applyTheme() {
    document.documentElement.classList.remove('light');
    document.documentElement.setAttribute('data-theme', 'dark');
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

  function scoreLabel(match) {
    const home = Number(match && match.home_score);
    const away = Number(match && match.away_score);
    const homeScore = Number.isFinite(home) ? home : 0;
    const awayScore = Number.isFinite(away) ? away : 0;
    return `${homeScore} - ${awayScore}`;
  }

  function resultRibbonItem(match) {
    const id = match && match.id !== undefined && match.id !== null ? String(match.id) : '';
    const tournament = String(match && match.tournament_name || match && match.game_type || 'Community Match').trim();
    return `
      <a class="results-ribbon-item" href="match.html?id=${encodeURIComponent(id)}">
        <span class="results-ribbon-team">${esc(match && match.home_team_name || 'Home')}</span>
        <strong class="results-ribbon-score">${esc(scoreLabel(match))}</strong>
        <span class="results-ribbon-team">${esc(match && match.away_team_name || 'Away')}</span>
        <span class="results-ribbon-meta">${esc(tournament)}</span>
      </a>
    `;
  }

  async function initResultsTicker(root) {
    const host = root.querySelector('[data-results-ribbon]');
    if (!host || !window.HubApi || typeof window.HubApi.matches !== 'function') return;
    try {
      const payload = await window.HubApi.matches({ limit: 18 });
      const matches = Array.isArray(payload && payload.matches) ? payload.matches.slice(0, 12) : [];
      if (!matches.length) {
        host.innerHTML = '<div class="results-ribbon-empty">No recent results available.</div>';
        return;
      }
      const track = matches.map(resultRibbonItem).join('');
      host.innerHTML = `
        <div class="results-ribbon-marquee">
          <div class="results-ribbon-track">
            ${track}
            ${track}
          </div>
        </div>
      `;
    } catch (_) {
      host.innerHTML = '<div class="results-ribbon-empty">Results ribbon offline.</div>';
    }
  }

  function navTemplate(activePage) {
    const nav = [
      { href: 'index.html', label: 'Home', tone: '#ff3aa7' },
      {
        href: 'players.html',
        label: 'Players',
        tone: '#ff5fb9',
        children: [
          {
            href: 'players.html',
            label: 'Browser',
            description: 'Search the full player pool with filters and form cues'
          },
          {
            href: 'rankings.html',
            label: 'Leaderboards',
            description: 'Top performers and position leaders'
          },
          {
            href: 'hall-of-fame.html',
            label: 'Hall Of Fame',
            description: 'Prestige, trophies, awards, and long-term legacy'
          }
        ]
      },
      {
        href: 'teams.html',
        label: 'Teams',
        tone: '#ff7a72',
        children: [
          {
            href: 'teams.html',
            label: 'Club Browser',
            description: 'Browse every club and compare squad strength'
          },
          {
            href: 'h2h.html',
            label: 'Head To Head',
            description: 'Compare clubs and recent meetings'
          }
        ]
      },
      {
        href: 'matches.html',
        label: 'Matches',
        tone: '#f9a43a',
        children: [
          {
            href: 'matches.html',
            label: 'Archive',
            description: 'Browse the full match archive with filters'
          },
          {
            href: 'match.html',
            label: 'Match Detail',
            description: 'Deep dive into a single fixture'
          }
        ]
      },
      {
        href: 'tournaments.html',
        label: 'Tournaments',
        tone: '#58d6a6',
        children: [
          {
            href: 'tournaments.html',
            label: 'Tournaments',
            description: 'Track active competitions, tables, and fixtures'
          },
          {
            href: 'builder.html',
            label: 'Lineup Builder',
            description: 'Build and preview community XIs'
          }
        ]
      },
      { href: 'servers.html', label: 'Servers', tone: '#53b5ff' },
      { href: 'discord.html', label: 'Discord', tone: '#8b9dff' }
    ];

    return `
      <header class="topbar-stack">
        <div class="topbar">
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
                      ${item.children.map((child) => `
                        <a class="${pageIsActive(activePage, child.href) ? 'active' : ''}" href="${child.href}">
                          <strong>${child.label}</strong>
                          <span>${child.description || 'Open section'}</span>
                        </a>
                      `).join('')}
                    </div>
                  </div>
                `;
              }).join('')}
            </nav>

            <div class="topbar-actions">
              <form class="header-search" data-hub-search-form>
                <span>&#9906;</span>
                <input data-hub-search-input type="search" placeholder="Search players or teams" autocomplete="off" spellcheck="false">
                <select data-hub-search-target aria-label="Search category">
                  <option value="players">Players</option>
                  <option value="teams">Teams</option>
                </select>
              </form>
            </div>
          </div>
        </div>
        <div class="results-ribbon" aria-label="Latest results">
          <div class="results-ribbon-shell">
            <span class="results-ribbon-status">Latest Results</span>
            <div class="results-ribbon-feed" data-results-ribbon>
              <div class="results-ribbon-empty">Loading results...</div>
            </div>
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
    applyTheme();
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
    bindHeaderSearch(root);
    initResultsTicker(root);
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
    const goals = Number(stats && stats.goals || 0);
    const assists = Number(stats && stats.assists || 0);
    const saves = Number(stats && stats.keeper_saves || 0);
    const rc = Number(stats && stats.red_cards || 0);
    const yc = Number(stats && stats.yellow_cards || 0);
    if (goals > 0) bits.push('<span class="icon goal" title="Goals">G</span>');
    if (assists > 0) bits.push('<span class="icon assist" title="Assists">A</span>');
    if (saves > 0) bits.push('<span class="icon save" title="Saves">S</span>');
    if (rc > 0) bits.push('<span class="icon card-red" title="Red card">R</span>');
    else if (yc > 0) bits.push('<span class="icon card-yellow" title="Yellow card">Y</span>');
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
    teamTheme,
    teamThemeStyle
  };
})();
