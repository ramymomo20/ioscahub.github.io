import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AccentLink, Crest, MatchCard, Pitch, PlayerAvatar, PlayerBadge, PlayerInlineLink, Widget } from '../components/ui'
import { getMatchmakingLeaders, getTopRatedPlayers, getTrendingPlayers, listHomeFeatures, listMatches, listPlayers, listQuickStats, listTeams } from '../data/repository'

export function HomePage() {
  const homeFeatures = listHomeFeatures()
  const quickStats = listQuickStats()
  const players = listPlayers()
  const matches = listMatches()
  const teams = listTeams()
  const topThree = getTopRatedPlayers(3)
  const trendingPlayers = getTrendingPlayers(6, 2)
  const matchmakingLeaders = getMatchmakingLeaders()
  const featureCount = homeFeatures.length
  const [featureIndex, setFeatureIndex] = useState(0)
  const activeFeature = homeFeatures[featureIndex]
  const featuredPlayer = topThree[0] ?? null
  const topTeam = [...teams].sort((left, right) => left.rank - right.rank || right.avgRating - left.avgRating)[0] ?? null
  const teamOfWeek = useMemo(() => buildTeamOfWeekLineup(players, matches), [players, matches])
  const totalPlayersStat = quickStats.find((stat) => stat.label === 'Total Players')
  const matchesLast7DaysStat = quickStats.find((stat) => stat.label === 'Matches Last 7 Days')

  useEffect(() => {
    const handle = window.setInterval(() => {
      setFeatureIndex((current) => (current + 1) % featureCount)
    }, 5000)

    return () => window.clearInterval(handle)
  }, [featureCount])

  return (
    <div className="page-stack">
      <section className={`hero hero-${activeFeature.accent}`}>
        <div className="hero-copy">
          <span className="eyebrow">IOSCA Hub</span>
          <h1>{activeFeature.title}</h1>
          <p className="lede">{activeFeature.description}</p>
          <div className="hero-actions">
            <AccentLink to={activeFeature.action} label="Open feature" />
          </div>
        </div>

        <div className="hero-meta card">
          <span className="feature-tag">{activeFeature.label}</span>
          <div className="hero-pager">
            {homeFeatures.map((feature, index) => (
              <button
                key={feature.title}
                className={`hero-dot${index === featureIndex ? ' is-active' : ''}`}
                type="button"
                onClick={() => setFeatureIndex(index)}
                aria-label={feature.title}
              />
            ))}
          </div>
          <div className="broadcast-lines">
            <span />
            <span />
            <span />
          </div>
        </div>
      </section>

      <section className="quick-stats-grid">
        <article className="card quick-stat">
          <span>Total Players</span>
          <strong>{totalPlayersStat?.value ?? players.length}</strong>
          <small>{totalPlayersStat?.delta}</small>
        </article>

        <article className="card quick-stat">
          <span>Matches Last 7 Days</span>
          <strong>{matchesLast7DaysStat?.value ?? matches.length}</strong>
          <small>{matchesLast7DaysStat?.delta}</small>
        </article>

        <article className="card quick-stat quick-stat-rich">
          <span>Highest Rated Player</span>
          {featuredPlayer ? (
            <Link className="quick-stat-inline-link" to={`/players/${featuredPlayer.id}`}>
              <PlayerAvatar player={featuredPlayer} className="avatar-circle quick-stat-avatar" />
              <span className="quick-stat-copy">
                <strong className="quick-stat-name-link">{featuredPlayer.name}</strong>
                <small>{featuredPlayer.position} | {featuredPlayer.rating} OVR</small>
              </span>
            </Link>
          ) : (
            <strong>-</strong>
          )}
        </article>

        <article className="card quick-stat quick-stat-rich">
          <span>#1 Team</span>
          {topTeam ? (
            <Link className="quick-stat-inline-link" to={`/teams/${topTeam.id}`}>
              <Crest teamId={topTeam.id} />
              <span className="quick-stat-copy">
                <strong className="quick-stat-name-link">{topTeam.name}</strong>
                <small>{topTeam.avgRating.toFixed(1)} avg rating</small>
              </span>
            </Link>
          ) : (
            <strong>-</strong>
          )}
        </article>
      </section>

      <section className="dashboard-grid">
        <Widget title="Trending Players" className="span-two">
          <div className="horizontal-rail">
            {trendingPlayers.map((player) => (
              <PlayerBadge key={player.id} player={player} />
            ))}
          </div>
        </Widget>

        <Widget title="Top 3 Rated Players">
          <div className="top-three-list">
            {topThree.map((player, index) => (
              <div key={player.id} className={`top-three-item place-${index + 1}`}>
                <div className="top-three-left">
                  <span className="top-three-rank">{index + 1}.</span>
                  <PlayerInlineLink playerId={player.id} />
                </div>
                <strong>{player.position}</strong>
              </div>
            ))}
          </div>
        </Widget>

        <Widget title="Matchmaking Leaders This Month">
          <div className="results-stack">
            <LeaderboardMiniSection title="Goals" entries={matchmakingLeaders.scorers} />
            <LeaderboardMiniSection title="Assists" entries={matchmakingLeaders.assisters} />
            <LeaderboardMiniSection title="Saves" entries={matchmakingLeaders.saves} />
          </div>
        </Widget>

        <Widget title="Latest Results Feed" className="span-two">
          <div className="results-stack">
            {matches.slice(0, 3).map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        </Widget>

        <Widget title="Team of the Week" className="span-two">
          <Pitch mode="match" lineups={teamOfWeek} format="8v8" />
        </Widget>
      </section>
    </div>
  )
}

function buildTeamOfWeekLineup(players, matches) {
  const slots = ['GK', 'LB', 'CB', 'RB', 'CM', 'LW', 'CF', 'RW']
  const roleGroups = {
    GK: ['GK'],
    LB: ['LB', 'CB', 'RB'],
    CB: ['CB', 'LB', 'RB'],
    RB: ['RB', 'CB', 'LB'],
    CM: ['CM', 'LM', 'RM'],
    LW: ['LW', 'LM', 'RW'],
    CF: ['CF', 'CM', 'RW', 'LW'],
    RW: ['RW', 'RM', 'LW'],
  }
  const latestPlayerActivity = players.reduce((latest, player) => {
    const parsed = player.lastMatchAt ? new Date(player.lastMatchAt) : null
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed < latest) {
      return latest
    }
    return parsed
  }, new Date('2026-05-01T00:00:00'))
  const latestMatchDate = matches.reduce((latest, match) => {
    const parsed = new Date(match.date)
    return Number.isNaN(parsed.getTime()) || parsed < latest ? latest : parsed
  }, latestPlayerActivity)
  const threshold = new Date(latestMatchDate)
  threshold.setDate(threshold.getDate() - 7)

  const activePlayers = players
    .filter((player) => {
      const parsed = player.lastMatchAt ? new Date(player.lastMatchAt) : null
      return (!parsed || Number.isNaN(parsed.getTime()) ? true : parsed >= threshold)
        && (player.recent?.appearances ?? 0) > 0
    })
    .sort((left, right) => {
      const ratingGap = (right.recent?.avgRating ?? 0) - (left.recent?.avgRating ?? 0)
      if (ratingGap !== 0) return ratingGap
      const productionGap = ((right.recent?.goals ?? 0) + (right.recent?.assists ?? 0))
        - ((left.recent?.goals ?? 0) + (left.recent?.assists ?? 0))
      if (productionGap !== 0) return productionGap
      return right.rating - left.rating
    })
  const used = new Set()

  return slots.map((slot) => {
    const preferredRoles = roleGroups[slot] ?? [slot]
    const player = activePlayers.find((entry) => !used.has(entry.id) && preferredRoles.includes(entry.position))
      ?? activePlayers.find((entry) => !used.has(entry.id))

    if (!player) {
      return { player: '', role: slot, rating: null, badges: [] }
    }

    used.add(player.id)

    return {
      playerId: player.id,
      role: slot,
      rating: Number(player.recent?.avgRating?.toFixed ? player.recent.avgRating.toFixed(1) : player.recent?.avgRating) || player.stats.avgRating || player.rating / 10,
      badges: buildTeamOfWeekBadges(player),
    }
  })
}

function LeaderboardMiniSection({ title, entries }) {
  return (
    <div className="top-three-list">
      <strong>{title}</strong>
      {entries.length ? entries.map((entry, index) => (
        <div key={`${title}-${entry.playerId}-${index}`} className="top-three-item place-1">
          <div className="top-three-left">
            <span className="top-three-rank">{index + 1}.</span>
            <PlayerInlineLink playerId={entry.playerId} />
          </div>
          <strong>{entry.value}</strong>
        </div>
      )) : <p>No data yet.</p>}
    </div>
  )
}

function buildTeamOfWeekBadges(player) {
  const badges = []

  if (player.position === 'GK' && (player.recent?.saves ?? 0) > 0) {
    badges.push({ type: 'save', count: Math.min(player.recent?.saves ?? 0, 9) })
  } else {
    if ((player.recent?.goals ?? 0) > 0) badges.push({ type: 'goal', count: Math.min(player.recent.goals, 9) })
    if ((player.recent?.assists ?? 0) > 0) badges.push({ type: 'assist', count: Math.min(player.recent.assists, 9) })
  }

  if ((player.recent?.yellowCards ?? 0) > 0) badges.push({ type: 'yellow-card', count: Math.min(player.recent.yellowCards, 3) })
  if ((player.recent?.mvps ?? 0) > 0) badges.push({ type: 'mvp', count: 1 })

  return badges
}
