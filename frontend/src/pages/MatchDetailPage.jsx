import { Link, Navigate, useParams } from 'react-router-dom'
import { Crest, EventIcon, PageTrail, PlayerInlineLink, Widget } from '../components/ui'
import { FullPlayerStatsWidget, HeadToHeadWidget, LineupsWidget, ShotMapWidget, ShotZonesWidget } from '../components/matchVisualWidgets'
import { getMatchById, getPlayerById, getTeamById, useHubMatchDetail } from '../data/repository'

export function MatchDetailPage() {
  const { matchId } = useParams()
  const { loading } = useHubMatchDetail(matchId)
  const match = getMatchById(matchId)

  if (!match && loading) {
    return null
  }

  if (!match) {
    return <Navigate to="/matches" replace />
  }

  const homeTeam = getTeamById(match.homeTeamId) ?? buildTransientMatchTeam(match.homeTeamId, match.homeTeamName, 'HM', match.homeCrestUrl)
  const awayTeam = getTeamById(match.awayTeamId) ?? buildTransientMatchTeam(match.awayTeamId, match.awayTeamName, 'AW', match.awayCrestUrl)
  const mvp = getPlayerById(match.mvpId)

  return (
    <div className="page-stack">
      <PageTrail items={[{ label: 'Home', to: '/' }, { label: 'Matches', to: '/matches' }, { label: `${homeTeam?.shortName} vs ${awayTeam?.shortName}` }]} />

      <section className="match-hero card match-hero-expanded">
        <div className="match-hero-topbar">
          <div className="match-hero-topbar-spacer" />
          <span className="eyebrow match-hero-competition">{match.competition}</span>
          <div className="match-hero-topbar-spacer" />
        </div>

        <div className="match-hero-grid">
          <div className="match-hero-team-column match-hero-team-column-left">
            <MatchHeroTeam team={homeTeam} isWinner={match.homeScore > match.awayScore} />
            <EventStack entries={match.homeEventStack} align="left" />
          </div>

          <div className="match-hero-center match-hero-center-expanded">
            <div className="match-mvp-link">
              <span>Player of the Match</span>
              <PlayerInlineLink playerId={mvp?.id} compact />
            </div>
            <h1>{match.homeScore} : {match.awayScore}</h1>
            <div className="match-hero-meta-row">
              <span>{match.date}</span>
              <span>{match.time}</span>
              <span>{match.format}</span>
            </div>
            <div className="match-hero-flags-bottom">
              {match.flags.map((flag) => (
                <span key={flag} className="flag-pill">{flag}</span>
              ))}
              <span className={`status-pill ${match.status.toLowerCase().includes('live') ? 'is-live' : ''}`}>{match.status}</span>
            </div>
          </div>

          <div className="match-hero-team-column match-hero-team-column-right">
            <EventStack entries={match.awayEventStack} align="right" />
            <MatchHeroTeam team={awayTeam} isWinner={match.awayScore > match.homeScore} />
          </div>
        </div>
      </section>

      <section className="dashboard-grid match-detail-layout">
        <LineupsWidget match={match} homeTeam={homeTeam} awayTeam={awayTeam} />
        <ShotMapWidget match={match} homeTeam={homeTeam} awayTeam={awayTeam} />
        <ShotZonesWidget match={match} homeTeam={homeTeam} awayTeam={awayTeam} />
        <HeadToHeadWidget match={match} homeTeam={homeTeam} awayTeam={awayTeam} />

        <Widget title="Game Highlights" className="match-detail-sidecard highlights-widget">
          <div className="highlights-list">
            {match.gameHighlights.filter((item) => item.type !== 'assist').map((item) => (
              <div key={`${item.minute}-${item.type}-${item.playerName ?? item.text}`} className="highlight-row">
                <strong>{item.minute}&apos;</strong>
                <EventIcon type={item.type} />
                <span>{formatHighlightText(item)}</span>
              </div>
            ))}
          </div>
        </Widget>

        <FullPlayerStatsWidget match={match} homeTeam={homeTeam} awayTeam={awayTeam} />
      </section>
    </div>
  )
}

function MatchHeroTeam({ team, isWinner = false }) {
  if (!team) {
    return null
  }

  const content = (
    <>
      <div className="match-hero-crest-shell">
        <Crest teamId={team.id} team={team} large />
      </div>
      <strong className="match-hero-team-name">{team.name}</strong>
    </>
  )

  if (!getTeamById(team.id)) {
    return <div className={`match-hero-team-link${isWinner ? ' is-winner' : ''}`}>{content}</div>
  }

  return <Link className={`match-hero-team-link${isWinner ? ' is-winner' : ''}`} to={`/teams/${team.id}`}>{content}</Link>
}

function buildTransientMatchTeam(teamId, teamName, fallbackShortName, crestUrl = null) {
  const safeName = String(teamName ?? '').trim() || 'Unknown Team'
  const safeId = teamId != null ? String(teamId) : `transient-${safeName.toLowerCase().replace(/\s+/g, '-')}`

  return {
    id: safeId,
    name: safeName,
    shortName: safeName.slice(0, 3).toUpperCase() || fallbackShortName,
    crest: safeName.slice(0, 2).toUpperCase() || fallbackShortName,
    crestUrl,
    colors: ['#46d7ff', '#1e63ff'],
  }
}

function EventStack({ entries, align = 'left' }) {
  const filteredEntries = entries
    .flatMap((entry) => groupKeyEvents(entry.events).map((group) => ({ playerName: entry.playerName, group })))
    .filter(Boolean)

  return (
    <div className={`event-stack event-stack-${align}`}>
      {filteredEntries.map((entry) => (
        <div key={`${entry.playerName}-${entry.group.type}-${entry.group.minutes}`} className="event-stack-row event-stack-row-plain">
          {align === 'right' ? (
            <>
              <div className="event-stack-events event-stack-events-inline">
                <EventIcon type={entry.group.type} />
                <small>{formatMinutes(entry.group.minutes)}</small>
              </div>
              <div className="event-stack-player">
                <strong>{entry.playerName}</strong>
              </div>
            </>
          ) : (
            <>
              <div className="event-stack-player">
                <strong>{entry.playerName}</strong>
              </div>
              <div className="event-stack-events event-stack-events-inline">
                <EventIcon type={entry.group.type} />
                <small>{formatMinutes(entry.group.minutes)}</small>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

function groupKeyEvents(events = []) {
  const allowed = ['goal', 'own-goal', 'yellow-card', 'second_yellow', 'red-card']
  const groups = new Map()

  events
    .filter((event) => allowed.includes(event.type))
    .forEach((event) => {
      const current = groups.get(event.type) ?? []
      current.push(event.minute)
      groups.set(event.type, current)
    })

  return Array.from(groups.entries()).map(([type, minutes]) => ({
    type,
    minutes,
  }))
}

function formatMinutes(minutes) {
  return minutes.map((minute) => `${minute}'`).join(', ')
}

function formatHighlightText(item) {
  if (item.type === 'goal') {
    return item.assistName ? `${item.playerName}. Assist from ${item.assistName}.` : `${item.playerName}.`
  }

  return item.playerName ?? item.text
}
