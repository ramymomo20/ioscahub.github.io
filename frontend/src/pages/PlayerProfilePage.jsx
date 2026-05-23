import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { FormPills, PageTrail, PlayerAvatar, StatChip, TeamInlineLink, Widget } from '../components/ui'
import { getPlayerById, getPlayerPerformance, listPlayerMatchLogs, useHubPlayerDetail } from '../data/repository'
import { getRatingToneClass } from '../utils/rating'

export function PlayerProfilePage() {
  const { playerId } = useParams()
  const { loading } = useHubPlayerDetail(playerId)
  const player = getPlayerById(playerId)
  const [page, setPage] = useState(0)
  const steamIcon = `${import.meta.env.BASE_URL}icons/steam-icon.png`
  const steamProfileUrl = getSteamProfileUrl(playerId)

  if (!player && loading) {
    return null
  }

  if (!player) {
    return <Navigate to="/players" replace />
  }

  const matchLogs = listPlayerMatchLogs(player.id)
  const pagedLogs = matchLogs.slice(page * 3, page * 3 + 3)

  return (
    <div className="page-stack">
      <PageTrail items={[{ label: 'Home', to: '/' }, { label: 'Players', to: '/players' }, { label: player.name }]} />

      <section className="profile-hero card profile-hero-reworked">
        <div className="profile-portrait-column">
          <div className="profile-top-badges">
            <div className="profile-badge-stack">
              <small>OVR</small>
              <span className={`profile-big-badge ${getRatingToneClass(player.rating)}`}>{player.rating}</span>
            </div>
            <div className="profile-badge-stack">
              <small>POS</small>
              <span className="profile-big-badge profile-position-badge">{player.position}</span>
            </div>
          </div>
          <PlayerAvatar player={player} className={`profile-portrait profile-portrait-rated ${getRatingToneClass(player.rating)}`} />
        </div>

        <div className="profile-center">
          <span className="eyebrow">Player Profile</span>
          <h1>{player.name}</h1>
          <div className="profile-badges">
            <TeamInlineLink teamId={player.teamId} />
            <FormPills values={getPlayerForm(matchLogs, player.id)} />
            {steamProfileUrl ? (
              <a
                className="steam-redirect-badge steam-redirect-badge-wide"
                href={steamProfileUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open Steam profile"
              >
                <img src={steamIcon} alt="" />
                <span>Steam Profile</span>
              </a>
            ) : null}
          </div>
          <div className="profile-focus-grid">
            <div className="profile-focus-card">
              <span>Goals</span>
              <strong>{player.stats.goals}</strong>
            </div>
            <div className="profile-focus-card">
              <span>Assists</span>
              <strong>{player.stats.assists}</strong>
            </div>
            <div className="profile-focus-card">
              <span>Passes</span>
              <strong>{player.stats.apasses}</strong>
            </div>
            <div className="profile-focus-card">
              <span>Interceptions</span>
              <strong>{player.stats.interceptions}</strong>
            </div>
          </div>
        </div>

        <div className="profile-summary">
          <StatChip label="Matches" value={player.stats.appearances} tone="neutral" />
          <StatChip label="Win Rate" value={`${player.stats.winRate}%`} tone="success" />
          <StatChip label="MOTM" value={player.stats.motm} tone="positive" />
          <StatChip label="Avg Rating" value={player.stats.avgRating} tone="premium" />
        </div>
      </section>

      <section className="dashboard-grid">
        <Widget title="Records" className="span-two">
          {player.records.length ? (
            <div className="record-link-list">
              {player.records.map((record) => (
                <Link key={record.label} className="record-link-card" to={`/matches/${record.matchId}`}>
                  <strong>{record.label}</strong>
                  <span>{record.value}</span>
                  <small>{record.summary}</small>
                </Link>
              ))}
            </div>
          ) : (
            <p>No per-match record log has been synced for this player yet.</p>
          )}
        </Widget>

        <Widget title="Activity Map">
          <ActivityMap values={player.activity} />
        </Widget>

        <Widget title="Rating Change">
          <RatingTrendChart values={buildRatingHistory(player)} />
        </Widget>

        <Widget title="Statistics" className="span-full">
          <div className="stats-section-grid">
            <StatSection title="General" items={[
              ['Appearances', player.stats.appearances],
              ['As subs', player.stats.subAppearances],
              ['Wins', player.stats.wins],
              ['Draws', player.stats.draws],
              ['Losses', player.stats.losses],
              ['Win rate', `${player.stats.winRate}%`],
            ]} />
            <StatSection title="Teamplay" items={[
              ['Assists', player.stats.assists],
              ['Passes', player.stats.apasses],
              ['Passes completed', player.stats.passesCompleted],
              ['Pass accuracy', `${player.stats.passAccuracy}%`],
              ['Key passes', player.stats.keyPasses],
              ['Chances created', player.stats.chancesCreated],
              ['Second assists', player.stats.secondAssists],
            ]} />
            <StatSection title="Discipline" items={[
              ['Fouls', player.stats.fouls],
              ['Fouls suffered', player.stats.foulsSuffered],
              ['Yellow cards', player.stats.yellowCards],
              ['Red cards', player.stats.redCards],
              ['Offsides', player.stats.offsides],
            ]} />
            <StatSection title="Goalkeeping" items={[
              ['Saves', player.stats.saves],
              ['Saves caught', player.stats.savesCaught],
              ['Save percentage', player.stats.savePercentage ? `${player.stats.savePercentage}%` : '0%'],
              ['Goals conceded', player.stats.goalsConceded],
              ['Own goals', player.stats.ownGoals],
            ]} />
            <StatSection title="Defending" items={[
              ['Interceptions', player.stats.interceptions],
              ['Tackles', player.stats.tackles],
              ['Tackles completed', player.stats.tacklesCompleted],
              ['Tackle accuracy', `${player.stats.tackleAccuracy}%`],
              ['Average distance ran', `${player.stats.distanceRan} km`],
              ['Total distance ran', `${player.stats.totalDistanceRan} km`],
            ]} />
            <StatSection title="Attacking" items={[
              ['Goals', player.stats.goals],
              ['Shots', player.stats.shots],
              ['Shots on target', player.stats.shotsOnTarget],
              ['Shot accuracy', `${player.stats.shotAccuracy}%`],
              ['Goals per game', player.stats.goalsPerGame],
            ]} />
          </div>
        </Widget>

        <Widget title="Match Directory" className="span-two">
          <div className="results-stack">
            {pagedLogs.map((match) => {
              const performance = getPlayerPerformance(match.id, player.id)
              return (
                <Link key={match.id} className="log-card log-card-link" to={`/matches/${match.id}`}>
                  <div>
                    <strong>{match.competition}</strong>
                    <p>{match.date} | {match.time}</p>
                  </div>
                  <div className="log-card-score">{match.homeScore} : {match.awayScore}</div>
                  <div>
                    <strong>{performance?.rating ?? '-'}</strong>
                    <p>{performance?.goals ?? 0}G | {performance?.assists ?? 0}A | {performance?.yellowCards ?? 0}YC</p>
                  </div>
                </Link>
              )
            })}
          </div>
          <div className="pager-row">
            <button className="ghost-button" type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Prev</button>
            <button className="ghost-button" type="button" disabled={(page + 1) * 3 >= matchLogs.length} onClick={() => setPage((current) => current + 1)}>Next</button>
          </div>
        </Widget>

        <Widget title="Tournament Form">
          {player.tournamentSummary?.current ? (
            <div className="tournament-summary-card">
              <strong>{player.tournamentSummary.current.tournamentId.replaceAll('-', ' ')}</strong>
              <p>Team place: {player.tournamentSummary.current.teamPlace}</p>
              <small>{player.tournamentSummary.current.stats}</small>
            </div>
          ) : (
            <p>No synced tournament placement data for this player yet.</p>
          )}
        </Widget>

        <Widget title="Previous Tournaments">
          {player.tournamentSummary?.history?.length ? (
            <div className="timeline">
              {player.tournamentSummary.history.map((item) => (
                <div key={`${item.tournamentId}-${item.teamPlace}`} className="timeline-item">
                  <strong>{item.tournamentId.replaceAll('-', ' ')}</strong>
                  <p>Team place {item.teamPlace}</p>
                  <small>{item.stats}</small>
                  {item.won ? <span className="crown-marker">Crown</span> : null}
                </div>
              ))}
            </div>
          ) : (
            <p>No historical tournament archive has been synced for this player yet.</p>
          )}
        </Widget>
      </section>
    </div>
  )
}

function getSteamProfileUrl(value) {
  const text = String(value ?? '').trim()
  if (!text) {
    return null
  }
  if (/^\d{17,20}$/.test(text)) {
    return `https://steamcommunity.com/profiles/${text}`
  }
  return `https://steamcommunity.com/id/${encodeURIComponent(text)}`
}

function ActivityMap({ values }) {
  const cells = buildActivityCells(values)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="activity-map-shell">
      <div className="activity-map-axis-top">
        {months.map((month) => <span key={month}>{month}</span>)}
      </div>
      <div className="activity-map-legend">
        <span>Low</span>
        <div className="activity-map-legend-scale">
          {[0, 1, 2, 3, 4, 5].map((value) => (
            <span key={value} className={`activity-cell level-${value}`} />
          ))}
        </div>
        <span>High</span>
      </div>

      <div className="activity-map-scroll">
        <div className="activity-map-wrap">
          <div className="activity-map-axis-side">
            {days.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="activity-map-year">
            {cells.map((cell) => (
              <button
                key={cell.date}
                className={`activity-cell activity-cell-button level-${cell.level}${cell.tooltipClass ? ` ${cell.tooltipClass}` : ''}`}
                type="button"
                title={`${cell.label}: ${cell.value} matches played`}
                aria-label={`${cell.label}: ${cell.value} matches`}
              >
                <span className="activity-cell-tooltip">{cell.label} | {cell.value} matches</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function buildActivityCells(values) {
  if (!Array.isArray(values) || !values.length) {
    return []
  }

  const totalColumns = Math.max(1, Math.ceil(values.length / 7))
  return values.map((entry, index) => {
    const rowIndex = index % 7
    const columnIndex = Math.floor(index / 7)
    const tooltipClasses = []

    if (columnIndex <= 1) tooltipClasses.push('tooltip-right')
    if (columnIndex >= totalColumns - 2) tooltipClasses.push('tooltip-left')
    if (rowIndex <= 1) tooltipClasses.push('tooltip-down')

    return {
      ...entry,
      tooltipClass: tooltipClasses.join(' '),
    }
  })
}

function RatingTrendChart({ values }) {
  const width = 420
  const height = 180
  const minRating = Math.max(0, Math.floor((Math.min(...values.map((entry) => entry.rating), 6) - 0.3) * 10) / 10)
  const maxRating = Math.min(10, Math.ceil((Math.max(...values.map((entry) => entry.rating), 10) + 0.3) * 10) / 10)
  const ratingRange = Math.max(0.1, maxRating - minRating)
  const stepX = width / Math.max(1, values.length - 1)
  const points = values.map((entry, index) => {
    const x = index * stepX
    const y = height - ((entry.rating - minRating) / ratingRange) * height
    return `${x},${y}`
  }).join(' ')
  const yTicks = Array.from({ length: 5 }, (_, index) => Number((minRating + (((maxRating - minRating) / 4) * index)).toFixed(1))).reverse()

  return (
    <div className="rating-trend-chart">
      <div className="rating-trend-shell">
        <div className="rating-trend-y-axis">
          {yTicks.map((tick) => <span key={tick}>{tick.toFixed(1)}</span>)}
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="rating-trend-svg" aria-hidden="true">
          {yTicks.map((tick) => {
          const y = height - ((tick - minRating) / ratingRange) * height
          return <line key={tick} x1="0" y1={y} x2={width} y2={y} className="rating-grid-line" />
        })}
        <polyline points={points} className="rating-trend-line" />
        {values.map((entry, index) => {
          const x = index * stepX
          const y = height - ((entry.rating - minRating) / ratingRange) * height
          return <circle key={entry.date} cx={x} cy={y} r="4" className="rating-trend-point" />
        })}
        </svg>
      </div>
      <div className="rating-trend-axis">
        {values.map((entry) => <span key={entry.date}>{entry.label}</span>)}
      </div>
    </div>
  )
}

function buildRatingHistory(player) {
  const logs = (player.matchLogs ?? [])
    .filter((match) => match.performances?.[0]?.rating != null)
    .slice()
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
    .slice(-8)

  if (!logs.length) {
    return [{ label: 'No data', date: 'no-data', rating: player.stats.avgRating || player.rating }]
  }

  return logs.map((match) => ({
    label: new Date(match.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    date: match.date,
    rating: match.performances[0].rating,
  }))
}

function getPlayerForm(matchLogs, playerId) {
  return matchLogs.slice(0, 5).map((match) => {
    const isHome = match.homeTeamId === getPlayerById(playerId)?.teamId
    const scoredFor = isHome ? match.homeScore : match.awayScore
    const scoredAgainst = isHome ? match.awayScore : match.homeScore
    if (scoredFor > scoredAgainst) return 'W'
    if (scoredFor < scoredAgainst) return 'L'
    return 'D'
  })
}

function StatSection({ title, items }) {
  return (
    <div className="stats-section-card">
      <h3>{title}</h3>
      <div className="stats-pair-list">
        {items.map(([label, value]) => (
          <div key={label} className="stats-pair-row">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}
