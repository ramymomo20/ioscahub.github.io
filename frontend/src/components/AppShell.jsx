import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useHubData } from '../data/repository'

const navItems = [
  { to: '/', label: 'Home', end: true },
  { to: '/players', label: 'Players' },
  { to: '/teams', label: 'Teams' },
  { to: '/matches', label: 'Matches' },
  { to: '/rankings', label: 'Rankings' },
  { to: '/tournaments', label: 'Tournaments' },
  { to: '/records', label: 'Records' },
  { to: '/media', label: 'Media' },
  { href: 'https://discord.gg/HxAJHK9qW9', label: 'Discord', external: true },
]

export function AppShell() {
  const { loading, error } = useHubData()
  const location = useLocation()
  const brandIcon = `${import.meta.env.BASE_URL}icons/iosca-icon.png`
  const discordIcon = `${import.meta.env.BASE_URL}icons/discord-icon.png`
  const githubIcon = `${import.meta.env.BASE_URL}icons/github-icon.png`
  const steamIcon = `${import.meta.env.BASE_URL}icons/steam-icon.png`
  const socialLinks = [
    { href: '/', label: 'About', internal: true },
    { href: 'https://discord.gg/HxAJHK9qW9', label: 'Discord', icon: discordIcon },
    { href: 'https://github.com/ramymomo20/exhub.github-io', label: 'GitHub', icon: githubIcon },
    { href: 'https://store.steampowered.com/app/673560/IOSoccer/', label: 'Steam', icon: steamIcon },
  ]
  const isTournamentDetailRoute = /^\/tournaments\/[^/]+$/.test(location.pathname)

  return (
    <div className="site-shell">
      <div className="site-glow site-glow-left" />
      <div className="site-glow site-glow-right" />

      <header className="topbar">
        <NavLink className="brand" to="/">
          <span className="brand-mark brand-mark-image">
            <img src={brandIcon} alt="IOSCA Hub" />
          </span>
          <span>
            <strong>IOSCA Hub</strong>
            <small>Neo Football Intelligence</small>
          </span>
        </NavLink>

        <nav className="main-nav" aria-label="Primary">
          {navItems.map((item) => (
            item.external ? (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="nav-link nav-link-discord"
              >
                {item.label}
              </a>
            ) : (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}
              >
                {item.label}
              </NavLink>
            )
          ))}
        </nav>
      </header>

      <main className={`page-wrap${isTournamentDetailRoute ? ' page-wrap-wide' : ''}`}>
        {loading ? (
          <div className="page-stack">
            <section className="card widget">
              <div className="widget-head">
                <h2>Loading Hub Data</h2>
              </div>
              <p>Connecting the site to the live hub read model.</p>
            </section>
          </div>
        ) : error ? (
          <div className="page-stack">
            <section className="card widget">
              <div className="widget-head">
                <h2>Hub Data Unavailable</h2>
              </div>
              <p>{error}</p>
            </section>
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      <footer className="site-footer">
        <div className="footer-brand">
          <strong>IOSoccer Central America</strong>
          <p>All rights reserved.</p>
        </div>
        <div className="footer-nav">
          {socialLinks.map((link) => (
            link.internal ? (
              <NavLink key={link.label} className="footer-link footer-link-icon" to={link.href}>
                <span>{link.label}</span>
              </NavLink>
            ) : (
              <a key={link.label} className="footer-link footer-link-icon" href={link.href} target="_blank" rel="noreferrer">
                <span className="footer-link-mark">
                  <img src={link.icon} alt="" />
                </span>
                <span>{link.label}</span>
              </a>
            )
          ))}
        </div>
      </footer>
    </div>
  )
}
