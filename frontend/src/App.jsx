import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AccountPage } from './pages/AccountPage'
import { HomePage } from './pages/HomePage'
import { DiscordPage } from './pages/DiscordPage'
import { MatchDetailPage } from './pages/MatchDetailPage'
import { MatchesPage } from './pages/MatchesPage'
import { MediaPage } from './pages/MediaPage'
import { PlayerProfilePage } from './pages/PlayerProfilePage'
import { PlayersPage } from './pages/PlayersPage'
import { RankingsPage } from './pages/RankingsPage'
import { RecordsPage } from './pages/RecordsPage'
import { TeamProfilePage } from './pages/TeamProfilePage'
import { TeamsPage } from './pages/TeamsPage'
import { TournamentDetailPage } from './pages/TournamentDetailPage'
import { TournamentsPage } from './pages/TournamentsPage'

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<AccountPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/players" element={<PlayersPage />} />
        <Route path="/players/:playerId" element={<PlayerProfilePage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/:teamId" element={<TeamProfilePage />} />
        <Route path="/matches" element={<MatchesPage />} />
        <Route path="/matches/:matchId" element={<MatchDetailPage />} />
        <Route path="/rankings" element={<RankingsPage />} />
        <Route path="/tournaments" element={<TournamentsPage />} />
        <Route path="/tournaments/:tournamentId" element={<TournamentDetailPage />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/media" element={<MediaPage />} />
        <Route path="/discord" element={<DiscordPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App
