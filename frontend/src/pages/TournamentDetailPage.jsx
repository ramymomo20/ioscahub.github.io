import { Navigate, useParams } from 'react-router-dom'
import { FormPills, PageTrail, Pitch, PlayerInlineLink, TeamInlineLink, Widget } from '../components/ui'
import { getTournamentById, getTournamentFixtures, useHubTournamentDetail } from '../data/repository'

export function TournamentDetailPage() {
  const { tournamentId } = useParams()
  const { loading } = useHubTournamentDetail(tournamentId)
  const tournament = getTournamentById(tournamentId)

  if (!tournament && loading) {
    return null
  }

  if (!tournament) {
    return <Navigate to="/tournaments" replace />
  }

  const fixtures = getTournamentFixtures(tournament.id)
  const fixturesByLeague = groupFixturesByLeague(fixtures)
  const analytics = tournament.analytics ?? null
  const leaderboards = analytics?.leaderboards ?? []
  const insights = analytics?.insights ?? {}
  const teamOfWeek = analytics?.teamOfTheWeek ?? null
  const showBracket = tournament.bracket?.some((item) => item !== 'League Table')
  const standingsWidgetClass = tournament.standingsGroups.length > 1 ? 'tournament-span-6' : 'tournament-span-12'

  return (
    <div className="page-stack">
      <PageTrail items={[{ label: 'Home', to: '/' }, { label: 'Tournaments', to: '/tournaments' }, { label: tournament.name }]} />

      <section className="page-intro card">
        <div>
          <span className="eyebrow">{tournament.status}</span>
          <h1>{tournament.name}</h1>
          <p className="lede">{tournament.description}</p>
          {tournament.winnerTeamId ? (
            <div className="winner-banner">
              <span>Winner</span>
              <TeamInlineLink teamId={tournament.winnerTeamId} />
            </div>
          ) : null}
        </div>
        <div className="intro-aside tournament-mark">{tournament.logo}</div>
      </section>

      <section className="dashboard-grid tournament-dashboard-grid">
        {tournament.standingsGroups.map((group) => (
          <Widget key={group.name} title={group.name} className={standingsWidgetClass}>
            <div className="table-shell standings-table-shell">
              <table className="standings-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Team</th>
                    <th>MP</th>
                    <th>W</th>
                    <th>D</th>
                    <th>L</th>
                    <th>GF</th>
                    <th>GA</th>
                    <th>GD</th>
                    <th>PTS</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, index) => (
                    <tr key={`${group.name}-${row.teamId}`} className={index === 0 ? 'standing-first' : index === 1 ? 'standing-second' : ''}>
                      <td>{index + 1}</td>
                      <td>
                        <div className="standings-team-cell">
                          {row.teamId ? <TeamInlineLink teamId={row.teamId} compact /> : <span>{row.teamName}</span>}
                          <FormPills values={row.form} />
                        </div>
                      </td>
                      <td>{row.played}</td>
                      <td>{row.wins}</td>
                      <td>{row.draws}</td>
                      <td>{row.losses}</td>
                      <td>{row.goalsFor}</td>
                      <td>{row.goalsAgainst}</td>
                      <td className={row.gd > 0 ? 'gd-positive' : row.gd < 0 ? 'gd-negative' : 'gd-neutral'}>{row.gd}</td>
                      <td><strong>{row.points}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Widget>
        ))}

        <Widget title="Tournament Signals" className="tournament-span-8">
          <div className="tournament-insight-grid">
            <InsightCard
              label="Best Team So Far"
              entity={insights.bestTeam}
              entityType="team"
              value={insights.bestTeam ? `${insights.bestTeam.points} pts` : null}
              detail={insights.bestTeam ? `${(insights.bestTeam.points / Math.max(1, insights.bestTeam.played)).toFixed(2)} pts/match | ${formatSigned(insights.bestTeam.gd)} GD` : 'No standings yet'}
            />
            <InsightCard
              label="Best Attack"
              entity={insights.bestAttack}
              entityType="team"
              value={insights.bestAttack ? `${insights.bestAttack.goalsFor} GF` : null}
              detail={insights.bestAttack ? `${(insights.bestAttack.goalsFor / Math.max(1, insights.bestAttack.played)).toFixed(2)} goals/match` : 'No standings yet'}
            />
            <InsightCard
              label="Best Defense"
              entity={insights.bestDefense}
              entityType="team"
              value={insights.bestDefense ? `${insights.bestDefense.goalsAgainst} GA` : null}
              detail={insights.bestDefense ? `${(insights.bestDefense.goalsAgainst / Math.max(1, insights.bestDefense.played)).toFixed(2)} conceded/match` : 'No standings yet'}
            />
            <InsightCard
              label="Highest Team Rating"
              entity={insights.highestTeamRating}
              entityType="team"
              value={insights.highestTeamRating ? formatRating(insights.highestTeamRating.avgMatchRating) : null}
              detail={insights.highestTeamRating ? 'Average player rating across tournament matches' : 'No rating data yet'}
            />
          </div>
        </Widget>

        <Widget title="Rating Stories" className="tournament-span-4">
          <div className="tournament-insight-grid">
            <InsightCard
              label="Highest Avg Rating"
              entity={insights.highestAverage}
              entityType="player"
              value={insights.highestAverage ? formatRating(insights.highestAverage.avgRating) : null}
              detail={insights.highestAverage ? `${insights.highestAverage.appearances} matches played` : 'No rating data yet'}
            />
            <InsightCard
              label="Lowest Avg Rating"
              entity={insights.lowestAverage}
              entityType="player"
              value={insights.lowestAverage ? formatRating(insights.lowestAverage.avgRating) : null}
              detail={insights.lowestAverage ? `${insights.lowestAverage.appearances} matches played` : 'No rating data yet'}
            />
            <InsightCard
              label="Best Single Match"
              entity={insights.bestMatchRating}
              entityType="player"
              value={insights.bestMatchRating ? formatRating(insights.bestMatchRating.rating) : null}
              detail={insights.bestMatchRating?.summary ?? 'No rating data yet'}
            />
            <InsightCard
              label="Worst Single Match"
              entity={insights.worstMatchRating}
              entityType="player"
              value={insights.worstMatchRating ? formatRating(insights.worstMatchRating.rating) : null}
              detail={insights.worstMatchRating?.summary ?? 'No rating data yet'}
            />
          </div>
        </Widget>

        {teamOfWeek ? (
          <Widget title={`Team of the Week | ${teamOfWeek.title}`} className="tournament-span-8">
            <Pitch mode="match" lineups={teamOfWeek.lineup} format="6v6" />
          </Widget>
        ) : null}

        <Widget title="Fixtures" className={teamOfWeek ? 'tournament-span-4' : 'tournament-span-12'}>
          <div className="results-stack">
            {fixturesByLeague.map((group) => (
              <div key={group.leagueKey} className="fixture-league-group">
                <strong>{group.label}</strong>
                {group.fixtures.map((match) => (
                  <div key={`${group.leagueKey}-${match.id}-${match.fixtureId}`} className="log-card">
                    <div>
                      <strong>{match.homeTeamName} vs {match.awayTeamName}</strong>
                      <p>{match.date} | {match.time}</p>
                    </div>
                    <div className="log-card-score">{match.homeScore} : {match.awayScore}</div>
                    <div>
                      <strong>{match.status}</strong>
                      <p>{[match.format, ...match.flags].filter(Boolean).join(' | ')}</p>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Widget>

        <Widget title="Tournament Records" className="tournament-span-12">
          <div className="tournament-leaderboard-grid">
            {leaderboards.map((board) => (
              <LeaderboardBlock key={board.key} board={board} />
            ))}
          </div>
        </Widget>

        {showBracket ? (
          <Widget title="Bracket" className="tournament-span-12">
            <div className="bracket-card">
              {(tournament.bracket ?? ['League Table']).map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </Widget>
        ) : null}
      </section>
    </div>
  )
}

function InsightCard({ label, entity, entityType, value, detail }) {
  return (
    <article className="tournament-insight-card">
      <span className="eyebrow">{label}</span>
      <div className="tournament-insight-body">
        {entityType === 'player' && entity?.playerId ? <PlayerInlineLink playerId={entity.playerId} /> : null}
        {entityType === 'team' && entity?.teamId ? <TeamInlineLink teamId={entity.teamId} /> : null}
        {!entity?.playerId && !entity?.teamId ? <strong className="tournament-insight-fallback">Awaiting data</strong> : null}
        <strong className="tournament-insight-value">{value ?? '-'}</strong>
      </div>
      <p>{detail}</p>
    </article>
  )
}

function LeaderboardBlock({ board }) {
  return (
    <div className="tournament-leaderboard-block">
      <div className="widget-head tournament-leaderboard-head">
        <h3>{board.label}</h3>
      </div>
      <div className="top-three-list">
        {board.entries.length ? board.entries.map((entry, index) => (
          <div key={`${board.key}-${entry.playerId}-${index}`} className={`top-three-item ${getPlacementClass(index)}`}>
            <div className="top-three-left tournament-leaderboard-player">
              <span className="top-three-rank">{index + 1}.</span>
              <div className="tournament-leaderboard-copy">
                {entry.playerId ? <PlayerInlineLink playerId={entry.playerId} /> : <span>{entry.playerName}</span>}
                <small>
                  {entry.teamId ? <TeamInlineLink teamId={entry.teamId} compact /> : (entry.teamName ?? 'No team')}
                  <span>{entry.appearances} match{entry.appearances === 1 ? '' : 'es'}</span>
                </small>
              </div>
            </div>
            <strong>{formatLeaderboardValue(board.key, entry.value)}</strong>
          </div>
        )) : <p>No synced data yet.</p>}
      </div>
    </div>
  )
}

function formatLeaderboardValue(key, value) {
  if (key === 'rating') {
    return formatRating(value)
  }
  return String(value ?? 0)
}

function formatRating(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '-'
}

function formatSigned(value) {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) {
    return '0'
  }
  return numeric > 0 ? `+${numeric}` : String(numeric)
}

function getPlacementClass(index) {
  if (index === 0) return 'place-1'
  if (index === 1) return 'place-2'
  if (index === 2) return 'place-3'
  return ''
}

function groupFixturesByLeague(fixtures) {
  const groups = new Map()

  fixtures.forEach((fixture) => {
    const leagueKey = fixture.leagueKey || 'Table'
    const current = groups.get(leagueKey) ?? {
      leagueKey,
      label: leagueKey === 'Table' ? 'Main Schedule' : `League ${leagueKey}`,
      fixtures: [],
    }
    current.fixtures.push(fixture)
    groups.set(leagueKey, current)
  })

  return Array.from(groups.values()).sort((left, right) => left.leagueKey.localeCompare(right.leagueKey, undefined, { numeric: true, sensitivity: 'base' }))
}
