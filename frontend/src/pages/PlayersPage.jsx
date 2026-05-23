import { useState } from 'react'
import { PageIntro, PageTrail, PlayerBadge } from '../components/ui'
import { listPlayers, listPositionOptions, listTeams } from '../data/repository'

export function PlayersPage() {
  const players = listPlayers()
  const teams = listTeams()
  const positions = listPositionOptions()
  const [search, setSearch] = useState('')
  const [teamFilter, setTeamFilter] = useState('all')
  const [positionFilter, setPositionFilter] = useState('all')
  const [sortBy, setSortBy] = useState('rating')

  const filteredPlayers = [...players]
    .filter((player) => Boolean(player.discordId))
    .filter((player) => player.name.toLowerCase().includes(search.toLowerCase()))
    .filter((player) => teamFilter === 'all' || player.teamId === teamFilter)
    .filter((player) => positionFilter === 'all' || player.position === positionFilter)
    .sort((left, right) => {
      if (sortBy === 'goals') return right.stats.goals - left.stats.goals
      if (sortBy === 'assists') return right.stats.assists - left.stats.assists
      if (sortBy === 'interceptions') return right.stats.interceptions - left.stats.interceptions
      if (sortBy === 'saves') return right.stats.saves - left.stats.saves
      if (sortBy === 'appearances') return right.stats.appearances - left.stats.appearances
      return right.rating - left.rating
    })

  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="Players"
        title="PLAYER DIRECTORY & SCOUTING BOARD"
        description=""
        aside={<PageTrail items={[{ label: 'Home', to: '/' }, { label: 'Players' }]} />}
      />

      <section className="card filter-bar">
        <label>
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a player" />
        </label>
        <label>
          Team
          <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
            <option value="all">All teams</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </label>
        <label>
          Position
          <select value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)}>
            <option value="all">All positions</option>
            {positions.map((position) => (
              <option key={position} value={position}>{position}</option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="rating">Rating</option>
            <option value="goals">Goals</option>
            <option value="assists">Assists</option>
            <option value="interceptions">Interceptions</option>
            <option value="saves">Saves</option>
            <option value="appearances">Appearances</option>
          </select>
        </label>
      </section>

      <section className="player-grid">
        {filteredPlayers.map((player) => (
          <PlayerBadge key={player.id} player={player} />
        ))}
      </section>
    </div>
  )
}
