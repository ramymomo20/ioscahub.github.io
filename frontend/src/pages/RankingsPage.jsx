import { useEffect, useMemo, useState } from 'react'
import { FormPills, PageIntro, PageTrail, PlayerInlineLink, TeamInlineLink, Widget } from '../components/ui'
import { listMatches, listPlayers, listTeams } from '../data/repository'

export function RankingsPage() {
  const players = listPlayers()
  const teams = listTeams()
  const matches = listMatches()
  const [category, setCategory] = useState('overall')
  const [homeTeamId, setHomeTeamId] = useState('')
  const [awayTeamId, setAwayTeamId] = useState('')
  const [leftPlayerId, setLeftPlayerId] = useState('')
  const [rightPlayerId, setRightPlayerId] = useState('')

  useEffect(() => {
    if (!teams.length) return

    if (!teams.some((team) => team.id === homeTeamId)) {
      setHomeTeamId(teams[0]?.id ?? '')
    }
    if (!teams.some((team) => team.id === awayTeamId)) {
      setAwayTeamId(teams[1]?.id ?? teams[0]?.id ?? '')
    }
  }, [teams, homeTeamId, awayTeamId])

  useEffect(() => {
    if (!players.length) return

    if (!players.some((player) => player.id === leftPlayerId)) {
      setLeftPlayerId(players[0]?.id ?? '')
    }
    if (!players.some((player) => player.id === rightPlayerId)) {
      setRightPlayerId(players[1]?.id ?? players[0]?.id ?? '')
    }
  }, [players, leftPlayerId, rightPlayerId])

  const playerRows = useMemo(() => {
    const sorted = [...players]

    if (category === 'attackers') return sorted.filter((player) => ['LW', 'RW', 'CF'].includes(player.position)).sort((a, b) => b.rating - a.rating)
    if (category === 'midfielders') return sorted.filter((player) => ['CM', 'LM', 'RM'].includes(player.position)).sort((a, b) => b.rating - a.rating)
    if (category === 'defenders') return sorted.filter((player) => ['LB', 'CB', 'RB'].includes(player.position)).sort((a, b) => b.rating - a.rating || b.stats.interceptions - a.stats.interceptions)
    if (category === 'goalkeepers') return sorted.filter((player) => player.position === 'GK').sort((a, b) => b.rating - a.rating || b.stats.saves - a.stats.saves)
    if (category === 'passers') return sorted.sort((a, b) => b.stats.passAccuracy - a.stats.passAccuracy)
    if (category === 'goals') return sorted.sort((a, b) => b.stats.goals - a.stats.goals)
    if (category === 'interceptions') return sorted.sort((a, b) => b.stats.interceptions - a.stats.interceptions)
    if (category === 'worst') return sorted.sort((a, b) => a.rating - b.rating)
    return sorted.sort((a, b) => b.rating - a.rating)
  }, [category, players])

  const teamHome = teams.find((team) => team.id === homeTeamId)
  const teamAway = teams.find((team) => team.id === awayTeamId)
  const playerLeft = players.find((player) => player.id === leftPlayerId)
  const playerRight = players.find((player) => player.id === rightPlayerId)
  const headToHeadMatches = matches
    .filter((match) => (
      (match.homeTeamId === homeTeamId && match.awayTeamId === awayTeamId)
      || (match.homeTeamId === awayTeamId && match.awayTeamId === homeTeamId)
    ))
    .slice()
    .sort((left, right) => new Date(right.date) - new Date(left.date))
  const headToHeadSummary = headToHeadMatches.reduce((accumulator, match) => {
    const homePerspective = match.homeTeamId === homeTeamId
    const homeGoals = homePerspective ? match.homeScore : match.awayScore
    const awayGoals = homePerspective ? match.awayScore : match.homeScore

    accumulator.homeGoals += homeGoals
    accumulator.awayGoals += awayGoals

    if (homeGoals > awayGoals) accumulator.homeWins += 1
    else if (homeGoals < awayGoals) accumulator.awayWins += 1
    else accumulator.draws += 1

    return accumulator
  }, {
    homeWins: 0,
    awayWins: 0,
    draws: 0,
    homeGoals: 0,
    awayGoals: 0,
  })

  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="Rankings"
        title="PLAYER, TEAM, AND HEAD TO HEAD HUB"
        description=""
        aside={<PageTrail items={[{ label: 'Home', to: '/' }, { label: 'Rankings' }]} />}
      />

      <section className="dashboard-grid">
        <Widget title="Player Rankings" className="span-two">
          <div className="category-pill-row">
            {[
              ['overall', 'Best overall'],
              ['attackers', 'Best attackers'],
              ['midfielders', 'Best midfielders'],
              ['defenders', 'Best defenders'],
              ['goalkeepers', 'Best goalkeepers'],
              ['passers', 'Best passers'],
              ['goals', 'Most goals'],
              ['interceptions', 'Most interceptions'],
              ['worst', 'Worst overall'],
            ].map(([value, label]) => (
              <button key={value} className={`category-pill ${category === value ? 'is-active' : ''}`} type="button" onClick={() => setCategory(value)}>
                {label}
              </button>
            ))}
          </div>

          <div className="ranking-stack">
            {playerRows.slice(0, 8).map((player, index) => (
              <article key={player.id} className="ranking-item ranking-item-rich">
                <strong>#{index + 1}</strong>
                <PlayerInlineLink playerId={player.id} />
                <span>{player.position}</span>
                <b>{category === 'goals' ? player.stats.goals : category === 'interceptions' ? player.stats.interceptions : player.rating}</b>
              </article>
            ))}
          </div>
        </Widget>

        <Widget title="Team Rankings">
          <div className="ranking-stack">
            {[...teams].sort((left, right) => left.rank - right.rank || right.avgRating - left.avgRating).map((team, index) => (
              <article key={team.id} className="ranking-item ranking-item-rich">
                <strong>#{index + 1}</strong>
                <div className="ranking-team-block">
                  <TeamInlineLink teamId={team.id} />
                  <FormPills values={team.form} />
                </div>
                <b>{team.avgRating.toFixed(1)}</b>
              </article>
            ))}
          </div>
        </Widget>

        <Widget title="Team Head to Head" className="span-two">
          <div className="compare-controls">
            <select value={homeTeamId} onChange={(event) => setHomeTeamId(event.target.value)}>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
            <select value={awayTeamId} onChange={(event) => setAwayTeamId(event.target.value)}>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </div>
          <div className="comparison-card comparison-card-team">
            <div className="comparison-card-team-side">
              <TeamInlineLink teamId={teamHome?.id} compact />
            </div>
            <div className="comparison-card-team-center">
              <strong>Last 5 meetings</strong>
              <small>{headToHeadSummary.homeWins} wins | {headToHeadSummary.awayWins} wins | {headToHeadSummary.draws} draws</small>
            </div>
            <div className="comparison-card-team-side">
              <TeamInlineLink teamId={teamAway?.id} compact />
            </div>
          </div>
          <div className="comparison-grid">
            <div className="comparison-row comparison-row-standalone"><strong>{teamHome?.avgRating?.toFixed(1)}</strong><span>Average rating</span><strong>{teamAway?.avgRating?.toFixed(1)}</strong></div>
            <div className="comparison-row comparison-row-standalone"><strong>{Math.round((teamHome?.wins / teamHome?.appearances) * 100) || 0}%</strong><span>Win rate</span><strong>{Math.round((teamAway?.wins / teamAway?.appearances) * 100) || 0}%</strong></div>
            <div className="comparison-row comparison-row-standalone"><strong>{teamHome?.wins}</strong><span>Overall wins</span><strong>{teamAway?.wins}</strong></div>
            <div className="comparison-row comparison-row-standalone"><strong>{headToHeadMatches.length}</strong><span>Meetings played</span><strong>{headToHeadMatches.length}</strong></div>
            <div className="comparison-row comparison-row-standalone"><strong>{headToHeadSummary.homeGoals}</strong><span>Goals in meetings</span><strong>{headToHeadSummary.awayGoals}</strong></div>
          </div>
        </Widget>

        <Widget title="Player Head to Head">
          <div className="compare-controls">
            <select value={leftPlayerId} onChange={(event) => setLeftPlayerId(event.target.value)}>
              {players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
            </select>
            <select value={rightPlayerId} onChange={(event) => setRightPlayerId(event.target.value)}>
              {players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
            </select>
          </div>
          <div className="comparison-grid">
            <div className="comparison-row comparison-row-standalone"><strong>{playerLeft?.stats.goals}</strong><span>Goals</span><strong>{playerRight?.stats.goals}</strong></div>
            <div className="comparison-row comparison-row-standalone"><strong>{playerLeft?.stats.assists}</strong><span>Assists</span><strong>{playerRight?.stats.assists}</strong></div>
            <div className="comparison-row comparison-row-standalone"><strong>{playerLeft?.stats.secondAssists}</strong><span>2nd assists</span><strong>{playerRight?.stats.secondAssists}</strong></div>
            <div className="comparison-row comparison-row-standalone"><strong>{playerLeft?.stats.apasses}</strong><span>Passes</span><strong>{playerRight?.stats.apasses}</strong></div>
            <div className="comparison-row comparison-row-standalone"><strong>{playerLeft?.stats.passAccuracy}%</strong><span>Pass completion</span><strong>{playerRight?.stats.passAccuracy}%</strong></div>
            <div className="comparison-row comparison-row-standalone"><strong>{playerLeft?.stats.interceptions}</strong><span>Interceptions</span><strong>{playerRight?.stats.interceptions}</strong></div>
            <div className="comparison-row comparison-row-standalone"><strong>{playerLeft?.stats.saves}</strong><span>Saves</span><strong>{playerRight?.stats.saves}</strong></div>
            <div className="comparison-row comparison-row-standalone"><strong>{playerLeft?.stats.shots}</strong><span>Shots</span><strong>{playerRight?.stats.shots}</strong></div>
            <div className="comparison-row comparison-row-standalone"><strong>{playerLeft?.stats.shotAccuracy}%</strong><span>Shot accuracy</span><strong>{playerRight?.stats.shotAccuracy}%</strong></div>
            <div className="comparison-row comparison-row-standalone"><strong>{playerLeft?.stats.fouls}</strong><span>Fouls</span><strong>{playerRight?.stats.fouls}</strong></div>
            <div className="comparison-row comparison-row-standalone"><strong>{playerLeft?.stats.yellowCards}</strong><span>Yellow cards</span><strong>{playerRight?.stats.yellowCards}</strong></div>
          </div>
        </Widget>
      </section>
    </div>
  )
}
