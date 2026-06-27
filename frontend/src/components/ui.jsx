import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getPlayerById, getTeamById, getTeamName } from '../data/repository'
import { getRatingToneClass } from '../utils/rating'

const ICON_BASE = `${import.meta.env.BASE_URL}icons/`
const ICON_MAP = {
  goal: `${ICON_BASE}soccer-ball-icon.png`,
  'own-goal': `${ICON_BASE}owngoal_image.png`,
  'yellow-card': `${ICON_BASE}yellow-card-icon.png`,
  'second-yellow': `${ICON_BASE}second-yellow-card-icon.png`,
  second_yellow: `${ICON_BASE}second-yellow-card-icon.png`,
  'red-card': `${ICON_BASE}red-card-icon.png`,
  assist: `${ICON_BASE}cleats-icon.png`,
  save: `${ICON_BASE}glove-icon.png`,
  mvp: `${ICON_BASE}gold-medal-icon.png`,
  W: `${ICON_BASE}form-w.svg`,
  D: `${ICON_BASE}form-d.svg`,
  L: `${ICON_BASE}form-l.svg`,
}

export function PageIntro({ eyebrow, title, description, aside }) {
  return (
    <section className="page-intro card">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description ? <p className="lede">{description}</p> : null}
      </div>
      {aside ? <div className="intro-aside">{aside}</div> : null}
    </section>
  )
}

export function PageTrail({ items }) {
  return (
    <nav className="page-trail" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="trail-item">
          {item.to ? <Link to={item.to}>{item.label}</Link> : <strong>{item.label}</strong>}
          {index < items.length - 1 ? <i>/</i> : null}
        </span>
      ))}
    </nav>
  )
}

export function Widget({ title, action, className = '', children }) {
  return (
    <section className={`card widget ${className}`}>
      <div className="widget-head">
        <h2>{title}</h2>
        {action ? <div className="widget-action">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function StatChip({ label, value, tone = 'neutral' }) {
  return (
    <div className={`stat-chip tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function buildFallbackTeam(teamId, name, shortName = 'TM', crestUrl = null) {
  const safeName = String(name ?? '').trim() || 'Unknown Team'
  const compact = safeName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase()

  return {
    id: teamId != null ? String(teamId) : `transient-${safeName.toLowerCase().replace(/\s+/g, '-')}`,
    name: safeName,
    shortName: compact || shortName,
    crest: compact || shortName,
    crestUrl,
    colors: ['#46d7ff', '#1e63ff'],
  }
}

export function Crest({ teamId, team = null, large = false }) {
  const resolvedTeam = team ?? getTeamById(teamId)

  if (!resolvedTeam) {
    return <span className="crest">?</span>
  }

  return (
    <span
      className={`crest${large ? ' crest-large' : ''}`}
      style={{ '--crest-start': resolvedTeam.colors[0], '--crest-end': resolvedTeam.colors[1] }}
    >
      {resolvedTeam.crestUrl ? <img src={resolvedTeam.crestUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : resolvedTeam.crest}
    </span>
  )
}

export function TeamInlineLink({ teamId, compact = false }) {
  const team = getTeamById(teamId)

  if (!team) {
    return null
  }

  return (
    <Link className={`team-inline-link${compact ? ' is-compact' : ''}`} to={`/teams/${team.id}`}>
      <Crest teamId={team.id} />
      <span>{team.name}</span>
    </Link>
  )
}

export function PlayerInlineLink({ playerId, compact = false }) {
  const player = getPlayerById(playerId)

  if (!player) {
    return null
  }

  return (
    <Link className={`player-inline-link${compact ? ' is-compact' : ''}`} to={`/players/${player.id}`}>
      <PlayerAvatar player={player} className="avatar-circle" />
      <span>{player.name}</span>
    </Link>
  )
}

export function PlayerBadge({ player, compact = false }) {
  return (
    <article className={`player-card ${getRatingTierClass(player.rating)}${compact ? ' player-card-compact' : ''}`}>
      <div className="player-card-top">
        <span className={`rating-pill ${getRatingToneClass(player.rating)}`}>{player.rating}</span>
        <span className="position-pill">{player.position}</span>
      </div>

      <Link className="player-avatar-link" to={`/players/${player.id}`}>
        <PlayerAvatar player={player} className="player-avatar player-avatar-small" />
      </Link>

      <Link className="player-name-link" to={`/players/${player.id}`}>
        <h3>{player.name}</h3>
      </Link>

      <Link className="player-team-ribbon" to={`/teams/${player.teamId}`}>
        <Crest teamId={player.teamId} />
        <span>{getTeamName(player.teamId)}</span>
      </Link>

      <div className="player-card-stats">
        <span>Apps {player.appearances}</span>
        <span>MVPs {player.mvps}</span>
      </div>
    </article>
  )
}

export function PlayerAvatar({ player, className = '' }) {
  const sources = useMemo(() => {
    const values = []
    if (player?.avatarUrl) {
      values.push(player.avatarUrl)
    }
    if (player?.discordId) {
      values.push(`https://unavatar.io/discord/${player.discordId}`)
    }
    return values
  }, [player?.avatarUrl, player?.discordId])
  const [sourceIndex, setSourceIndex] = useState(0)

  useEffect(() => {
    setSourceIndex(0)
  }, [sources])

  if (sources[sourceIndex]) {
    return (
      <span className={`${className} has-image`.trim()}>
        <img
          src={sources[sourceIndex]}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            setSourceIndex((current) => (current + 1 < sources.length ? current + 1 : sources.length))
          }}
        />
      </span>
    )
  }

  return <span className={className}>{player?.portrait ?? '?'}</span>
}

export function TeamCard({ team }) {
  return (
    <article className="team-card card">
      <div className="team-card-top" style={{ '--team-a': team.colors[0], '--team-b': team.colors[1] }}>
        <Link className="team-crest-link" to={`/teams/${team.id}`}>
          <Crest teamId={team.id} large />
        </Link>
      </div>

      <div className="team-card-body">
        <div className="team-card-title-row">
          <span className={`team-rating-badge ${getRatingToneClass(team.avgRating)}`}>{team.avgRating.toFixed(1)}</span>
          <Link className="team-name-link" to={`/teams/${team.id}`}>
            <h3>{team.name}</h3>
          </Link>
        </div>

        <div className="team-meta-grid team-meta-grid-expanded">
          <span>Captain <strong>{team.captain}</strong></span>
          <span>Rank <strong>#{team.rank}</strong></span>
          <span>Played <strong>{team.appearances}</strong></span>
          <span>Record <strong>{team.wins} | {team.draws} | {team.losses}</strong></span>
          <span>Players <strong>{team.playerCount}</strong></span>
          <span>Competition <strong>{team.competition}</strong></span>
        </div>
      </div>
    </article>
  )
}

export function MatchCard({ match }) {
  const navigate = useNavigate()
  const existingHomeTeam = getTeamById(match.homeTeamId)
  const existingAwayTeam = getTeamById(match.awayTeamId)
  const homeTeam = existingHomeTeam ?? buildFallbackTeam(match.homeTeamId, match.homeTeamName, 'HM', match.homeCrestUrl)
  const awayTeam = existingAwayTeam ?? buildFallbackTeam(match.awayTeamId, match.awayTeamName, 'AW', match.awayCrestUrl)
  const mvp = getPlayerById(match.mvpId)
  const homeWon = match.homeScore > match.awayScore
  const awayWon = match.awayScore > match.homeScore

  function openMatch() {
    navigate(`/matches/${match.id}`)
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openMatch()
    }
  }

  function stopCardOpen(event) {
    event.stopPropagation()
  }

  return (
    <article className="match-card card match-card-clickable" role="link" tabIndex={0} onClick={openMatch} onKeyDown={handleKeyDown}>
      <div className="match-card-head">
        <span className="match-tag">{match.competition}</span>
        <div className="match-card-datetime">
          <strong>{match.date}</strong>
          <small>{match.time}</small>
        </div>
        <div className="match-card-flags">
          {match.flags.map((flag) => (
            <span key={flag} className="flag-pill">{flag}</span>
          ))}
        </div>
      </div>

      <div className="scoreboard scoreboard-expanded">
        <div className={`score-team score-team-home ${homeWon ? 'is-winner' : ''}`}>
          {existingHomeTeam ? (
            <Link className="team-score-link team-score-link-home" to={`/teams/${match.homeTeamId}`} onClick={stopCardOpen}>
              <Crest teamId={match.homeTeamId} team={homeTeam} large />
              <strong className="team-score-name">{homeTeam.name}</strong>
            </Link>
          ) : (
            <div className="team-score-link team-score-link-home">
              <Crest teamId={match.homeTeamId} team={homeTeam} large />
              <strong className="team-score-name">{homeTeam.name}</strong>
            </div>
          )}
        </div>

        <div className="score-center score-center-link">
          <span className="scoreline">{match.homeScore} : {match.awayScore}</span>
        </div>

        <div className={`score-team score-team-away ${awayWon ? 'is-winner' : ''}`}>
          {existingAwayTeam ? (
            <Link className="team-score-link team-score-link-right team-score-link-away" to={`/teams/${match.awayTeamId}`} onClick={stopCardOpen}>
              <Crest teamId={match.awayTeamId} team={awayTeam} large />
              <strong className="team-score-name">{awayTeam.name}</strong>
            </Link>
          ) : (
            <div className="team-score-link team-score-link-right team-score-link-away">
              <Crest teamId={match.awayTeamId} team={awayTeam} large />
              <strong className="team-score-name">{awayTeam.name}</strong>
            </div>
          )}
        </div>
      </div>

      <div className="match-card-foot">
        <span>{match.format}</span>
        <span onClick={stopCardOpen}>
          <PlayerInlineLink playerId={mvp?.id} compact />
        </span>
      </div>
    </article>
  )
}

export function SimpleTable({ rows, columns }) {
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id || row.teamId || row.label}>
              {columns.map((column) => (
                <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Pitch({ playersOnPitch, mode = 'summary', lineups = null, tooltips = {}, format = '5v5', shirtColors = null }) {
  const rawItems = lineups ?? playersOnPitch
  const items = mode === 'match' ? mapLineupToFormation(rawItems, format) : rawItems
  const shirtStyle = shirtColors ? { '--shirt-a': shirtColors[0], '--shirt-b': shirtColors[1] ?? shirtColors[0] } : {}
  const darkText = shirtColors && isLightColor(shirtColors[0])

  return (
    <div className={`pitch-shell ${mode === 'match' ? 'pitch-shell-match' : ''}`}>
      <div className="pitch">
        <div className="pitch-box pitch-box-top" />
        <div className="pitch-box pitch-box-bottom" />
        <div className="pitch-goal-box pitch-goal-box-top" />
        <div className="pitch-goal-box pitch-goal-box-bottom" />
        <div className="pitch-spot pitch-spot-top" />
        <div className="pitch-spot pitch-spot-bottom" />
        <div className="pitch-line pitch-line-half" />
        <div className="pitch-circle" />
        {items.map((entry, index) => {
          const player = entry.playerId ? getPlayerById(entry.playerId) : null
          const tooltipLines = entry.playerId ? (tooltips[entry.playerId] ?? []) : []
          const ratingClass = getMatchRatingClass(entry.rating, entry.badges)
          const hoverClass = getPitchHoverClass(entry)
          const isMvp = entry.badges?.some((badge) => badge.type === 'mvp')
          const avatarLabel = getPitchAvatarLabel(entry, player)

          return (
            <div
              key={`${entry.playerId ?? entry.player ?? index}-${entry.role}`}
              className={`pitch-player pitch-marker${isMvp ? ' is-mvp' : ''}${hoverClass ? ` ${hoverClass}` : ''}`}
              style={{ left: `${entry.x}%`, top: `${entry.y}%` }}
            >
              {entry.rating ? <span className={`pitch-rating ${ratingClass}`}>{entry.rating}</span> : null}
              {isMvp ? <span className="pitch-mvp-crown" title="MVP">+</span> : null}
              <div className={`pitch-avatar-marker ${darkText ? 'pitch-avatar-marker-dark' : ''}`} style={shirtStyle}>
                <span>{avatarLabel}</span>
              </div>
              <span className="pitch-role-label">{entry.role}</span>
              {player ? (
                <Link className="pitch-player-name pitch-player-name-link" to={`/players/${player.id}`}>
                  <span>{player.name}</span>
                </Link>
              ) : (
                <span className="pitch-player-name">{entry.player ?? entry.playerId}</span>
              )}
              <PitchStatChips badges={entry.badges} />
              {tooltipLines.length ? (
                <div className="pitch-hover-card pitch-tooltip">
                  <div className="pitch-hover-head">
                    <strong>{player?.name ?? entry.player ?? entry.playerId}</strong>
                    <span>{entry.role}</span>
                  </div>
                  <div className="pitch-hover-grid">
                    {tooltipLines.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function EventIcon({ type }) {
  const src = ICON_MAP[type]

  if (src) {
    return <img className={`event-icon event-icon-${type}`} src={src} alt="" />
  }

  if (type === 'miss') return <span className="icon-miss" />
  return <span className="icon-dot" />
}

export function AccentLink({ to, label }) {
  return <Link className="accent-link" to={to}>{label}</Link>
}

export function FormPills({ values }) {
  return (
    <div className="form-pills">
      {values.map((value, index) => (
        <span key={`${value}-${index}`} className={`form-pill result-${value.toLowerCase()}`} title={value}>
          <img src={ICON_MAP[value] ?? ''} alt={value} />
        </span>
      ))}
    </div>
  )
}

const FORMATIONS = {
  '5v5': [
    { pos: 'GK', x: 50, y: 84 },
    { pos: 'CB', x: 50, y: 64 },
    { pos: 'LM', x: 24, y: 28 },
    { pos: 'CF', x: 50, y: 24 },
    { pos: 'RM', x: 76, y: 28 },
  ],
  '6v6': [
    { pos: 'GK', x: 50, y: 85 },
    { pos: 'LB', x: 22, y: 65 },
    { pos: 'RB', x: 78, y: 65 },
    { pos: 'CM', x: 50, y: 48 },
    { pos: 'LW', x: 26, y: 24 },
    { pos: 'RW', x: 74, y: 24 },
  ],
  '8v8': [
    { pos: 'GK', x: 50, y: 86 },
    { pos: 'LB', x: 18, y: 68 },
    { pos: 'CB', x: 50, y: 66.2 },
    { pos: 'RB', x: 82, y: 68 },
    { pos: 'CM', x: 50, y: 47.4 },
    { pos: 'LW', x: 22, y: 26 },
    { pos: 'CF', x: 50, y: 21 },
    { pos: 'RW', x: 78, y: 26 },
  ],
}

function mapLineupToFormation(items, format) {
  const slots = FORMATIONS[format] ?? FORMATIONS['5v5']
  const normalized = (items ?? []).map((entry) => ({ ...entry, role: normalizeRole(entry.role) }))
  const used = new Set()
  const mapped = []

  for (const slot of slots) {
    const directIndex = normalized.findIndex((entry, index) => !used.has(index) && normalizeRole(entry.role) === slot.pos)
    if (directIndex >= 0) {
      used.add(directIndex)
      mapped.push({ ...normalized[directIndex], x: slot.x, y: slot.y, role: slot.pos })
      continue
    }

    const fallbackIndex = normalized.findIndex((_, index) => !used.has(index))
    if (fallbackIndex >= 0) {
      used.add(fallbackIndex)
      mapped.push({ ...normalized[fallbackIndex], x: slot.x, y: slot.y, role: slot.pos })
      continue
    }

    mapped.push({ player: '', role: slot.pos, x: slot.x, y: slot.y, badges: [] })
  }

  return mapped
}

function normalizeRole(role) {
  return String(role ?? '').trim().toUpperCase()
}

function getMatchRatingClass(rating, badges = []) {
  if (badges.some((badge) => badge.type === 'mvp')) return 'rating-mvp'
  if (typeof rating !== 'number') return 'rating-neutral'
  if (rating >= 7.5) return 'rating-good'
  if (rating >= 6) return 'rating-mid'
  return 'rating-bad'
}

function PitchStatChips({ badges = [] }) {
  const visible = badges.filter((badge) => ['goal', 'save', 'yellow-card', 'red-card', 'own-goal'].includes(badge.type) && badge.count > 0)

  if (!visible.length) {
    return null
  }

  return (
    <div className="pitch-player-stats">
      {visible.map((badge) => (
        <span key={`${badge.type}-${badge.count}`} className="pitch-stat-chip">
          <EventIcon type={badge.type} />
          <em>{badge.count}</em>
        </span>
      ))}
    </div>
  )
}

function getPitchHoverClass(entry) {
  const classes = []

  if (entry.x <= 24) classes.push('hover-left')
  if (entry.x >= 76) classes.push('hover-right')
  if (entry.y >= 68) classes.push('hover-up')

  return classes.join(' ')
}

function getPitchAvatarLabel(entry, player) {
  const raw = player?.portrait || entry.player || entry.playerId || entry.role
  const compact = String(raw).trim()

  if (!compact) {
    return '?'
  }

  if (compact.length <= 3) {
    return compact.toUpperCase()
  }

  return compact
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
}

function isLightColor(hex) {
  if (!hex || !hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) return false
  const normalized = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex
  const r = Number.parseInt(normalized.slice(1, 3), 16)
  const g = Number.parseInt(normalized.slice(3, 5), 16)
  const b = Number.parseInt(normalized.slice(5, 7), 16)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness > 165
}

function getRatingTierClass(rating) {
  if (rating >= 85) return 'tier-light-gold'
  if (rating >= 75) return 'tier-dark-gold'
  if (rating >= 65) return 'tier-silver'
  return 'tier-bronze'
}
