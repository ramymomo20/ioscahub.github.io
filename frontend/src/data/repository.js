import { useEffect, useSyncExternalStore } from 'react'

const positionOptions = ['GK', 'LB', 'CB', 'RB', 'CM', 'LM', 'RM', 'LW', 'RW', 'CF']

const listeners = new Set()
const DEFAULT_PAGE_SIZE = 200
const TEAM_PAGE_SIZE = 250
const MAX_PAGINATION_PAGES = 50
const API_RESPONSE_CACHE_TTL_MS = 2 * 60 * 1000
const BOOTSTRAP_REFRESH_INTERVAL_MS = 30 * 1000
const API_RESPONSE_CACHE_PREFIX = 'iosca-hub-response:v2:'

let bootstrapPromise = null
const playerDetailPromises = new Map()
const matchDetailPromises = new Map()
const teamDetailPromises = new Map()
const tournamentDetailPromises = new Map()
const apiRequestPromises = new Map()

let state = buildInitialState()

function buildInitialState() {
  return {
    bootstrapStatus: 'idle',
    bootstrapError: null,
    bootstrapLoadedAt: 0,
    detailStatus: {
      players: {},
      matches: {},
      teams: {},
      tournaments: {},
    },
    detailErrors: {
      players: {},
      matches: {},
      teams: {},
      tournaments: {},
    },
    teams: [],
    players: [],
    matches: [],
    tournaments: [],
    media: [],
    summary: null,
    matchmakingLeaders: {
      scorers: [],
      assisters: [],
      saves: [],
    },
    records: [],
    quickStats: [],
    homeFeatures: [],
    discordOverview: buildDiscordOverview([], [], [], []),
    teamIndex: new Map(),
    playerIndex: new Map(),
    matchIndex: new Map(),
    tournamentIndex: new Map(),
  }
}

function emit() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

function setState(updater) {
  state = typeof updater === 'function' ? updater(state) : updater
  emit()
}

function useRepositorySnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function normalizeBaseUrl(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function getApiBaseUrl() {
  const configured = String(import.meta.env.VITE_HUB_API_BASE_URL ?? '').trim()
  if (configured) {
    return normalizeBaseUrl(configured)
  }

  if (typeof window !== 'undefined') {
    const { hostname } = window.location
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:8000'
    }
    if (hostname === 'ramymomo20.github.io') {
      return 'https://iosca-api.sparked.network'
    }
  }

  return ''
}

const API_BASE_URL = getApiBaseUrl()

function getStorage() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function getApiCacheKey(path) {
  return `${API_RESPONSE_CACHE_PREFIX}${path}`
}

function shouldBypassClientCache(path) {
  const normalizedPath = String(path ?? '').split('?')[0]
  return (
    normalizedPath === '/api/bootstrap'
    || normalizedPath === '/api/summary'
    || normalizedPath === '/api/matchmaking/leaders'
    || normalizedPath.startsWith('/api/players')
    || normalizedPath.startsWith('/api/teams')
    || normalizedPath.startsWith('/api/matches')
    || normalizedPath.startsWith('/api/tournaments')
  )
}

function readCachedApiResponse(path) {
  if (shouldBypassClientCache(path)) {
    return null
  }
  const storage = getStorage()
  if (!storage) {
    return null
  }

  try {
    const raw = storage.getItem(getApiCacheKey(path))
    if (!raw) {
      return null
    }

    const cached = JSON.parse(raw)
    if (!cached || typeof cached !== 'object') {
      return null
    }

    if (Date.now() - Number(cached.cachedAt ?? 0) > API_RESPONSE_CACHE_TTL_MS) {
      storage.removeItem(getApiCacheKey(path))
      return null
    }

    return cached.data ?? null
  } catch {
    return null
  }
}

function writeCachedApiResponse(path, data) {
  if (shouldBypassClientCache(path)) {
    return
  }
  const storage = getStorage()
  if (!storage) {
    return
  }

  try {
    storage.setItem(
      getApiCacheKey(path),
      JSON.stringify({
        cachedAt: Date.now(),
        data,
      })
    )
  } catch {
    // Ignore storage quota and serialization failures.
  }
}

function clearCachedApiResponse(path) {
  if (shouldBypassClientCache(path)) {
    return
  }
  const storage = getStorage()
  if (!storage) {
    return
  }

  try {
    storage.removeItem(getApiCacheKey(path))
  } catch {
    // Ignore storage access failures.
  }
}

async function fetchJson(path, options = {}) {
  const { bypassCache = false } = options
  if (!bypassCache) {
    const cached = readCachedApiResponse(path)
    if (cached !== null) {
      return cached
    }
  } else {
    clearCachedApiResponse(path)
  }

  if (apiRequestPromises.has(path)) {
    return apiRequestPromises.get(path)
  }

  const promise = fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Accept: 'application/json',
    },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      writeCachedApiResponse(path, data)
      return data
    })
    .finally(() => {
      apiRequestPromises.delete(path)
    })

  apiRequestPromises.set(path, promise)
  return promise
}

async function fetchJsonOrDefault(path, fallbackValue) {
  const cached = readCachedApiResponse(path)
  if (cached !== null) {
    return cached
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (response.status === 404) {
    return fallbackValue
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  writeCachedApiResponse(path, data)
  return data
}

async function fetchJsonSettled(path, fallbackValue = []) {
  try {
    return await fetchJson(path)
  } catch (error) {
    return { __hubFetchError: error, __hubFallback: fallbackValue }
  }
}

async function settleTask(task, fallbackValue = []) {
  try {
    return await task
  } catch (error) {
    return { __hubFetchError: error, __hubFallback: fallbackValue }
  }
}

function withPagination(path, limit, offset) {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}limit=${limit}&offset=${offset}`
}

async function fetchAllPages(path, pageSize = DEFAULT_PAGE_SIZE) {
  const items = []

  for (let pageIndex = 0; pageIndex < MAX_PAGINATION_PAGES; pageIndex += 1) {
    const offset = pageIndex * pageSize
    const page = await fetchJson(withPagination(path, pageSize, offset))

    if (!Array.isArray(page)) {
      throw new Error(`Paged request for ${path} did not return an array.`)
    }

    items.push(...page)
    if (page.length < pageSize) {
      break
    }
  }

  return items
}

async function fetchAllPagesOrDefault(path, fallbackValue = [], pageSize = DEFAULT_PAGE_SIZE) {
  const firstPage = await fetchJsonOrDefault(withPagination(path, pageSize, 0), fallbackValue)
  if (!Array.isArray(firstPage)) {
    return fallbackValue
  }
  if (firstPage.length < pageSize) {
    return firstPage
  }

  const items = [...firstPage]
  for (let pageIndex = 1; pageIndex < MAX_PAGINATION_PAGES; pageIndex += 1) {
    const offset = pageIndex * pageSize
    const page = await fetchJson(withPagination(path, pageSize, offset))
    if (!Array.isArray(page) || page.length === 0) {
      break
    }
    items.push(...page)
    if (page.length < pageSize) {
      break
    }
  }

  return items
}

function indexById(items) {
  return new Map(items.map((item) => [item.id, item]))
}

function replaceById(items, item) {
  const next = items.slice()
  const index = next.findIndex((entry) => entry.id === item.id)
  if (index >= 0) {
    next[index] = item
  } else {
    next.push(item)
  }
  return next
}

function applyDerivedState(baseState) {
  const teams = enrichTeams(baseState.teams, baseState.matches)
  const players = enrichPlayers(baseState.players, teams)
  const tournaments = enrichTournaments(baseState.tournaments, teams, players)
  const records = buildRecords(players, teams)
  const quickStats = buildQuickStats(players, teams, baseState.matches, baseState.media, baseState.summary)
  const homeFeatures = buildHomeFeatures(baseState.matches, tournaments, teams)
  const discordOverview = buildDiscordOverview(players, teams, baseState.matches, baseState.media)

  return {
    ...baseState,
    teams,
    players,
    tournaments,
    records,
    quickStats,
    homeFeatures,
    discordOverview,
    teamIndex: indexById(teams),
    playerIndex: indexById(players),
    matchIndex: indexById(baseState.matches),
    tournamentIndex: indexById(tournaments),
  }
}

function isBootstrapStale() {
  return !state.bootstrapLoadedAt || (Date.now() - state.bootstrapLoadedAt) >= BOOTSTRAP_REFRESH_INTERVAL_MS
}

async function ensureBootstrapLoaded(options = {}) {
  const { force = false } = options
  if (state.bootstrapStatus === 'loaded' && !force && !isBootstrapStale()) {
    return state
  }

  if (bootstrapPromise) {
    return bootstrapPromise
  }

  if (!(force && state.bootstrapStatus === 'loaded')) {
    setState((current) => ({
      ...current,
      bootstrapStatus: 'loading',
      bootstrapError: null,
    }))
  }

  bootstrapPromise = settleTask(fetchJson('/api/bootstrap', { bypassCache: force }), null)
    .then(async (bootstrapResult) => {
      if (bootstrapResult && !bootstrapResult.__hubFetchError && typeof bootstrapResult === 'object') {
        const mappedState = applyDerivedState({
          ...state,
          bootstrapStatus: 'loaded',
          bootstrapError: null,
          bootstrapLoadedAt: Date.now(),
          teams: Array.isArray(bootstrapResult.teams) ? bootstrapResult.teams.map(mapTeamSummary) : [],
          players: Array.isArray(bootstrapResult.players) ? bootstrapResult.players.map(mapPlayerSummary) : [],
          matches: Array.isArray(bootstrapResult.matches) ? bootstrapResult.matches.map(mapMatchSummary) : [],
          tournaments: Array.isArray(bootstrapResult.tournaments) ? bootstrapResult.tournaments.map(mapTournamentSummary) : [],
          media: Array.isArray(bootstrapResult.media) ? bootstrapResult.media.map(mapMediaItem) : [],
          summary: bootstrapResult.summary ?? null,
          matchmakingLeaders: mapMatchmakingLeaders(bootstrapResult.matchmaking_leaders),
        })

        setState(mappedState)
        return mappedState
      }

      return Promise.all([
        settleTask(fetchJson(withPagination('/api/teams', TEAM_PAGE_SIZE, 0), { bypassCache: force })),
        settleTask(fetchAllPages('/api/players', DEFAULT_PAGE_SIZE)),
        settleTask(fetchAllPages('/api/matches', DEFAULT_PAGE_SIZE)),
        settleTask(fetchJson(withPagination('/api/tournaments', 100, 0), { bypassCache: force })),
        fetchAllPagesOrDefault('/api/media', [], DEFAULT_PAGE_SIZE),
        settleTask(fetchJson('/api/summary', { bypassCache: force }), null),
      ])
    })
    .then((bootstrapOrLegacy) => {
      if (!Array.isArray(bootstrapOrLegacy)) {
        return bootstrapOrLegacy
      }

      const [teamsResult, playersResult, matchesResult, tournamentsResult, rawMedia, summaryResult] = bootstrapOrLegacy
      const failedResults = [teamsResult, playersResult, matchesResult, tournamentsResult]
        .filter((result) => result && result.__hubFetchError)
      if (failedResults.length === 4) {
        throw failedResults[0].__hubFetchError
      }

      const rawTeams = teamsResult?.__hubFetchError ? [] : teamsResult
      const rawPlayers = playersResult?.__hubFetchError ? [] : playersResult
      const rawMatches = matchesResult?.__hubFetchError ? [] : matchesResult
      const rawTournaments = tournamentsResult?.__hubFetchError ? [] : tournamentsResult
      const rawSummary = summaryResult?.__hubFetchError ? null : summaryResult
      const mappedState = applyDerivedState({
        ...state,
        bootstrapStatus: 'loaded',
        bootstrapError: null,
        bootstrapLoadedAt: Date.now(),
        teams: rawTeams.map(mapTeamSummary),
        players: rawPlayers.map(mapPlayerSummary),
        matches: rawMatches.map(mapMatchSummary),
        tournaments: rawTournaments.map(mapTournamentSummary),
        media: rawMedia.map(mapMediaItem),
        summary: rawSummary,
        matchmakingLeaders: { scorers: [], assisters: [], saves: [] },
      })

      setState(mappedState)
      return mappedState
    })
    .catch((error) => {
      setState((current) => ({
        ...current,
        bootstrapStatus: force && current.bootstrapStatus === 'loaded' ? 'loaded' : 'error',
        bootstrapError: error instanceof Error ? error.message : 'Failed to load hub data.',
      }))
      throw error
    })
    .finally(() => {
      bootstrapPromise = null
    })

  return bootstrapPromise
}

async function ensurePlayerDetailLoaded(playerId) {
  if (!playerId) return null
  if (state.playerIndex.get(playerId)?.isDetailed) {
    return state.playerIndex.get(playerId)
  }
  if (playerDetailPromises.has(playerId)) {
    return playerDetailPromises.get(playerId)
  }

  setDetailStatus('players', playerId, 'loading')

  const promise = fetchJson(`/api/players/${encodeURIComponent(playerId)}`)
    .then((rawPlayer) => {
      const detailedPlayer = mapPlayerDetail(rawPlayer, state.playerIndex.get(playerId))
      setState((current) => applyDerivedState({
        ...current,
        players: replaceById(current.players, detailedPlayer),
        detailStatus: {
          ...current.detailStatus,
          players: {
            ...current.detailStatus.players,
            [playerId]: 'loaded',
          },
        },
        detailErrors: {
          ...current.detailErrors,
          players: {
            ...current.detailErrors.players,
            [playerId]: null,
          },
        },
      }))
      return detailedPlayer
    })
    .catch((error) => {
      setDetailError('players', playerId, error)
      throw error
    })
    .finally(() => {
      playerDetailPromises.delete(playerId)
    })

  playerDetailPromises.set(playerId, promise)
  return promise
}

async function ensureMatchDetailLoaded(matchId) {
  if (!matchId) return null
  if (state.matchIndex.get(matchId)?.isDetailed) {
    return state.matchIndex.get(matchId)
  }
  if (matchDetailPromises.has(matchId)) {
    return matchDetailPromises.get(matchId)
  }

  setDetailStatus('matches', matchId, 'loading')

  const promise = fetchJson(`/api/matches/${encodeURIComponent(matchId)}`)
    .then((rawMatch) => {
      const detailedMatch = mapMatchDetail(rawMatch)
      setState((current) => applyDerivedState({
        ...current,
        matches: replaceById(current.matches, detailedMatch),
        detailStatus: {
          ...current.detailStatus,
          matches: {
            ...current.detailStatus.matches,
            [matchId]: 'loaded',
          },
        },
        detailErrors: {
          ...current.detailErrors,
          matches: {
            ...current.detailErrors.matches,
            [matchId]: null,
          },
        },
      }))
      return detailedMatch
    })
    .catch((error) => {
      setDetailError('matches', matchId, error)
      throw error
    })
    .finally(() => {
      matchDetailPromises.delete(matchId)
    })

  matchDetailPromises.set(matchId, promise)
  return promise
}

async function ensureTeamDetailLoaded(teamId) {
  if (!teamId) return null
  if (state.teamIndex.get(teamId)?.isDetailed) {
    return state.teamIndex.get(teamId)
  }
  if (teamDetailPromises.has(teamId)) {
    return teamDetailPromises.get(teamId)
  }

  setDetailStatus('teams', teamId, 'loading')

  const promise = fetchJson(`/api/teams/${encodeURIComponent(teamId)}`)
    .then((rawTeam) => {
      const detailedTeam = mapTeamDetail(rawTeam, state.teamIndex.get(teamId))
      setState((current) => applyDerivedState({
        ...current,
        teams: replaceById(current.teams, detailedTeam),
        detailStatus: {
          ...current.detailStatus,
          teams: {
            ...current.detailStatus.teams,
            [teamId]: 'loaded',
          },
        },
        detailErrors: {
          ...current.detailErrors,
          teams: {
            ...current.detailErrors.teams,
            [teamId]: null,
          },
        },
      }))
      return detailedTeam
    })
    .catch((error) => {
      setDetailError('teams', teamId, error)
      throw error
    })
    .finally(() => {
      teamDetailPromises.delete(teamId)
    })

  teamDetailPromises.set(teamId, promise)
  return promise
}

async function ensureTournamentDetailLoaded(tournamentId) {
  if (!tournamentId) return null
  if (state.tournamentIndex.get(tournamentId)?.isDetailed) {
    return state.tournamentIndex.get(tournamentId)
  }
  if (tournamentDetailPromises.has(tournamentId)) {
    return tournamentDetailPromises.get(tournamentId)
  }

  setDetailStatus('tournaments', tournamentId, 'loading')

  const promise = fetchJson(`/api/tournaments/${encodeURIComponent(tournamentId)}`)
    .then((rawTournament) => {
      const detailedTournament = mapTournamentDetail(rawTournament, state.players)
      setState((current) => applyDerivedState({
        ...current,
        tournaments: replaceById(current.tournaments, detailedTournament),
        detailStatus: {
          ...current.detailStatus,
          tournaments: {
            ...current.detailStatus.tournaments,
            [tournamentId]: 'loaded',
          },
        },
        detailErrors: {
          ...current.detailErrors,
          tournaments: {
            ...current.detailErrors.tournaments,
            [tournamentId]: null,
          },
        },
      }))
      return detailedTournament
    })
    .catch((error) => {
      setDetailError('tournaments', tournamentId, error)
      throw error
    })
    .finally(() => {
      tournamentDetailPromises.delete(tournamentId)
    })

  tournamentDetailPromises.set(tournamentId, promise)
  return promise
}

function setDetailStatus(scope, itemId, status) {
  setState((current) => ({
    ...current,
    detailStatus: {
      ...current.detailStatus,
      [scope]: {
        ...current.detailStatus[scope],
        [itemId]: status,
      },
    },
    detailErrors: {
      ...current.detailErrors,
      [scope]: {
        ...current.detailErrors[scope],
        [itemId]: null,
      },
    },
  }))
}

function setDetailError(scope, itemId, error) {
  const message = error instanceof Error ? error.message : 'Failed to load detail data.'
  setState((current) => ({
    ...current,
    detailStatus: {
      ...current.detailStatus,
      [scope]: {
        ...current.detailStatus[scope],
        [itemId]: 'error',
      },
    },
    detailErrors: {
      ...current.detailErrors,
      [scope]: {
        ...current.detailErrors[scope],
        [itemId]: message,
      },
    },
  }))
}

export function useHubData() {
  const snapshot = useRepositorySnapshot()

  useEffect(() => {
    if (snapshot.bootstrapStatus === 'idle') {
      void ensureBootstrapLoaded()
    }
  }, [snapshot.bootstrapStatus])

  useEffect(() => {
    if (snapshot.bootstrapStatus !== 'loaded') {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      void ensureBootstrapLoaded({ force: true })
    }, BOOTSTRAP_REFRESH_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [snapshot.bootstrapStatus])

  return {
    loading: snapshot.bootstrapStatus === 'idle' || snapshot.bootstrapStatus === 'loading',
    ready: snapshot.bootstrapStatus === 'loaded',
    error: snapshot.bootstrapError,
  }
}

export function useHubPlayerDetail(playerId) {
  const snapshot = useRepositorySnapshot()

  useEffect(() => {
    if (!playerId) return
    if (snapshot.bootstrapStatus === 'idle') {
      void ensureBootstrapLoaded()
    }
  }, [playerId, snapshot.bootstrapStatus])

  useEffect(() => {
    if (!playerId || snapshot.bootstrapStatus !== 'loaded') return
    if (!snapshot.playerIndex.get(playerId)?.isDetailed) {
      void ensurePlayerDetailLoaded(playerId)
    }
  }, [playerId, snapshot.bootstrapStatus, snapshot.playerIndex])

  return {
    loading: snapshot.bootstrapStatus !== 'loaded' || snapshot.detailStatus.players[playerId] === 'loading',
    error: snapshot.detailErrors.players[playerId] ?? null,
  }
}

export function useHubMatchDetail(matchId) {
  const snapshot = useRepositorySnapshot()

  useEffect(() => {
    if (!matchId) return
    if (snapshot.bootstrapStatus === 'idle') {
      void ensureBootstrapLoaded()
    }
  }, [matchId, snapshot.bootstrapStatus])

  useEffect(() => {
    if (!matchId || snapshot.bootstrapStatus !== 'loaded') return
    if (!snapshot.matchIndex.get(matchId)?.isDetailed) {
      void ensureMatchDetailLoaded(matchId)
    }
  }, [matchId, snapshot.bootstrapStatus, snapshot.matchIndex])

  return {
    loading: snapshot.bootstrapStatus !== 'loaded' || snapshot.detailStatus.matches[matchId] === 'loading',
    error: snapshot.detailErrors.matches[matchId] ?? null,
  }
}

export function useHubTeamDetail(teamId) {
  const snapshot = useRepositorySnapshot()

  useEffect(() => {
    if (!teamId) return
    if (snapshot.bootstrapStatus === 'idle') {
      void ensureBootstrapLoaded()
    }
  }, [teamId, snapshot.bootstrapStatus])

  useEffect(() => {
    if (!teamId || snapshot.bootstrapStatus !== 'loaded') return
    if (!snapshot.teamIndex.get(teamId)?.isDetailed) {
      void ensureTeamDetailLoaded(teamId)
    }
  }, [teamId, snapshot.bootstrapStatus, snapshot.teamIndex])

  return {
    loading: snapshot.bootstrapStatus !== 'loaded' || snapshot.detailStatus.teams[teamId] === 'loading',
    error: snapshot.detailErrors.teams[teamId] ?? null,
  }
}

export function useHubTournamentDetail(tournamentId) {
  const snapshot = useRepositorySnapshot()

  useEffect(() => {
    if (!tournamentId) return
    if (snapshot.bootstrapStatus === 'idle') {
      void ensureBootstrapLoaded()
    }
  }, [tournamentId, snapshot.bootstrapStatus])

  useEffect(() => {
    if (!tournamentId || snapshot.bootstrapStatus !== 'loaded') return
    if (!snapshot.tournamentIndex.get(tournamentId)?.isDetailed) {
      void ensureTournamentDetailLoaded(tournamentId)
    }
  }, [tournamentId, snapshot.bootstrapStatus, snapshot.tournamentIndex])

  return {
    loading: snapshot.bootstrapStatus !== 'loaded' || snapshot.detailStatus.tournaments[tournamentId] === 'loading',
    error: snapshot.detailErrors.tournaments[tournamentId] ?? null,
  }
}

export const listTeams = () => state.teams
export const getTeamById = (teamId) => state.teamIndex.get(String(teamId)) ?? null
export const getTeamName = (teamId) => getTeamById(teamId)?.name ?? teamId
export const listPlayers = () => state.players
export const getPlayerById = (playerId) => state.playerIndex.get(String(playerId)) ?? null
export const listPlayersByTeamId = (teamId) => state.players.filter((player) => player.teamId === teamId)
export const listMatches = () => state.matches
export const getMatchById = (matchId) => state.matchIndex.get(String(matchId)) ?? null
export const listMatchesByTeamId = (teamId) => state.matches.filter((match) => match.homeTeamId === teamId || match.awayTeamId === teamId)
export const listPlayersByIds = (playerIds) => playerIds.map((playerId) => getPlayerById(playerId)).filter(Boolean)
export const listTournaments = () => state.tournaments
export const getTournamentById = (tournamentId) => state.tournamentIndex.get(String(tournamentId)) ?? null
export const listRecords = () => state.records
export const listMedia = () => state.media
export const listHomeFeatures = () => state.homeFeatures
export const listQuickStats = () => state.quickStats
export const listPositionOptions = () => positionOptions
export const getDiscordOverview = () => state.discordOverview
export const getMatchmakingLeaders = () => state.matchmakingLeaders

export function listPlayerMatchLogs(playerId) {
  const player = getPlayerById(playerId)
  if (player?.matchLogs?.length) {
    return player.matchLogs
  }

  return state.matches.filter((match) => match.performances?.some((entry) => entry.playerId === playerId))
}

export function getTopRatedPlayers(limit = 3) {
  return [...state.players].sort((left, right) => right.rating - left.rating).slice(0, limit)
}

export function getTrendingPlayers(limit = 6, minimumAppearances = 2) {
  return [...state.players]
    .filter((player) => toNumber(player.recent?.appearances) >= minimumAppearances)
    .sort((left, right) => {
      const recentRatingGap = toNumber(right.recent?.avgRating) - toNumber(left.recent?.avgRating)
      if (recentRatingGap !== 0) return recentRatingGap
      const outputGap = (toNumber(right.recent?.goals) + toNumber(right.recent?.assists))
        - (toNumber(left.recent?.goals) + toNumber(left.recent?.assists))
      if (outputGap !== 0) return outputGap
      const mvpGap = toNumber(right.recent?.mvps) - toNumber(left.recent?.mvps)
      if (mvpGap !== 0) return mvpGap
      return right.rating - left.rating
    })
    .slice(0, limit)
}

export function getPlayerPerformance(matchId, playerId) {
  const match = getMatchById(matchId)
  const direct = match?.performances?.find((entry) => entry.playerId === playerId)
  if (direct) {
    return direct
  }

  const player = getPlayerById(playerId)
  const matchLog = player?.matchLogs?.find((entry) => entry.id === String(matchId))
  return matchLog?.performances?.find((entry) => entry.playerId === playerId) ?? null
}

export function getTournamentFixtures(tournamentId) {
  const tournament = getTournamentById(tournamentId)
  return tournament?.fixtures ?? []
}

function mapTeamSummary(raw) {
  return {
    id: String(raw.guild_id),
    name: raw.name ?? 'Unknown Team',
    shortName: raw.short_name || abbreviateLabel(raw.name, 3),
    crest: abbreviateLabel(raw.short_name || raw.name, 2),
    crestUrl: raw.crest_url ?? null,
    captain: raw.captain_name || 'Unassigned',
    captainDiscordId: raw.captain_discord_id ?? null,
    avgRating: toNumber(raw.average_rating),
    rank: 0,
    colors: generateTeamColors(raw.guild_id || raw.name || 'team'),
    form: [],
    createdOn: formatIsoDate(raw.created_at),
    competition: raw.is_national_team ? 'National Team' : raw.is_mix_team ? 'Mix Team' : 'Hub Team',
    playerCount: toNumber(raw.player_count),
    appearances: toNumber(raw.matches_played),
    wins: toNumber(raw.wins),
    draws: toNumber(raw.draws),
    losses: toNumber(raw.losses),
    goalsFor: toNumber(raw.goals_for),
    goalsAgainst: toNumber(raw.goals_against),
    isNationalTeam: Boolean(raw.is_national_team),
    isMixTeam: Boolean(raw.is_mix_team),
  }
}

function mapPlayerSummary(raw) {
  const appearances = toNumber(raw.appearances)
  const wins = toNumber(raw.wins)
  const draws = toNumber(raw.draws)
  const losses = toNumber(raw.losses)
  const shots = toNumber(raw.shots)
  const shotsOnTarget = toNumber(raw.shots_on_goal)
  const passesCompleted = toNumber(raw.passes_completed)
  const passesAttempted = toNumber(raw.passes_attempted || raw.passes_completed)
  const tackles = toNumber(raw.tackles)
  const slidingTacklesCompleted = toNumber(raw.sliding_tackles_completed)
  const saves = toNumber(raw.keeper_saves)
  const goalsConceded = toNumber(raw.goals_conceded)
  const goals = toNumber(raw.goals)
  const distanceCovered = toKilometers(raw.distance_covered)
  const recentAppearances = toNumber(raw.recent_appearances)
  const playerName = raw.display_name || raw.steam_id

  return {
    id: String(raw.steam_id),
    discordId: normalizeRegisteredDiscordId(raw.discord_id),
    name: playerName,
    teamId: raw.current_team_guild_id ? String(raw.current_team_guild_id) : null,
    teamName: raw.current_team_name ?? null,
    avatarUrl: raw.avatar_url ?? null,
    rating: toNumber(raw.rating),
    position: normalizePosition(raw.primary_position, raw),
    portrait: abbreviateLabel(playerName, 2),
    appearances,
    mvps: toNumber(raw.mvp_awards),
    lastMatchAt: raw.last_match_at ?? null,
    recent: {
      appearances: recentAppearances,
      goals: toNumber(raw.recent_goals),
      assists: toNumber(raw.recent_assists),
      yellowCards: toNumber(raw.recent_yellow_cards),
      saves: toNumber(raw.recent_saves),
      mvps: toNumber(raw.recent_mvp_awards),
      avgRating: Number(toNumber(raw.recent_avg_match_rating).toFixed(1)),
      totalDistanceRan: Number(toKilometers(raw.recent_distance_covered).toFixed(1)),
      distanceRan: recentAppearances > 0 ? Number((toKilometers(raw.recent_distance_covered) / recentAppearances).toFixed(1)) : 0,
    },
    stats: {
      appearances,
      subAppearances: 0,
      wins,
      draws,
      losses,
      winRate: appearances > 0 ? Math.round((wins / appearances) * 100) : 0,
      goals,
      assists: toNumber(raw.assists),
      apasses: passesAttempted,
      passesCompleted,
      passAccuracy: toNumber(raw.pass_accuracy),
      keyPasses: toNumber(raw.key_passes),
      chancesCreated: toNumber(raw.chances_created),
      secondAssists: toNumber(raw.second_assists),
      fouls: toNumber(raw.fouls),
      foulsSuffered: toNumber(raw.fouls_suffered),
      yellowCards: toNumber(raw.yellow_cards),
      redCards: toNumber(raw.red_cards),
      offsides: toNumber(raw.offsides),
      saves,
      savesCaught: toNumber(raw.keeper_saves_caught),
      savePercentage: saves + goalsConceded > 0 ? Math.round((saves / (saves + goalsConceded)) * 100) : 0,
      goalsConceded,
      ownGoals: toNumber(raw.own_goals),
      corners: toNumber(raw.corners),
      freeKicks: toNumber(raw.free_kicks),
      penalties: toNumber(raw.penalties),
      throwIns: toNumber(raw.throw_ins),
      goalKicks: toNumber(raw.goal_kicks),
      interceptions: toNumber(raw.interceptions),
      tackles,
      tacklesCompleted: slidingTacklesCompleted,
      tackleAccuracy: tackles > 0 ? Math.round((slidingTacklesCompleted / tackles) * 100) : 0,
      distanceRan: appearances > 0 ? Number((distanceCovered / appearances).toFixed(1)) : 0,
      totalDistanceRan: Number(distanceCovered.toFixed(1)),
      shots,
      shotsOnTarget,
      shotAccuracy: shots > 0 ? Math.round((shotsOnTarget / shots) * 100) : 0,
      goalsPerGame: appearances > 0 ? Number((goals / appearances).toFixed(2)) : 0,
      avgRating: Number(toNumber(raw.avg_match_rating).toFixed(1)),
      motm: toNumber(raw.mvp_awards),
      possession: Number(toNumber(raw.possession).toFixed(1)),
      totalMinutes: toNumber(raw.time_played || raw.total_minutes),
    },
    records: [],
    activity: [],
    tournamentSummary: null,
    matchLogs: [],
    isDetailed: false,
  }
}

function mapPlayerDetail(rawPlayer, currentPlayer) {
  const basePlayer = {
    ...(currentPlayer ?? mapPlayerSummary(rawPlayer)),
    ...mapPlayerSummary(rawPlayer),
  }
  const matchLogs = (rawPlayer.recent_matches ?? []).map((entry) => mapPlayerMatchLog(entry, basePlayer.id))
  const activity = buildPlayerActivity(matchLogs)
  const records = buildPlayerRecords(matchLogs)

  return {
    ...basePlayer,
    matchLogs,
    activity,
    records,
    tournamentSummary: null,
    isDetailed: true,
  }
}

function mapTeamDetail(rawTeam, currentTeam) {
  const baseTeam = {
    ...(currentTeam ?? mapTeamSummary(rawTeam)),
    ...mapTeamSummary(rawTeam),
  }

  return {
    ...baseTeam,
    recentMatches: (rawTeam.recent_matches ?? []).map(mapMatchSummary),
    aggregateStats: mapTeamAggregateStats(rawTeam.aggregate_player_stats),
    isDetailed: true,
  }
}

function mapMatchSummary(raw) {
  const competition = raw.tournament_name || formatGameType(raw.game_type)

  return {
    id: String(raw.match_stats_id),
    sourceMatchId: raw.match_id,
    homeTeamId: raw.home_guild_id ? String(raw.home_guild_id) : null,
    awayTeamId: raw.away_guild_id ? String(raw.away_guild_id) : null,
    homeScore: toNumber(raw.home_score),
    awayScore: toNumber(raw.away_score),
    status: 'Final',
    flags: buildMatchFlags(raw),
    competition,
    competitionType: inferCompetitionType(competition),
    format: formatGameType(raw.game_type),
    date: formatLongDate(raw.match_datetime),
    time: formatTime(raw.match_datetime),
    duration: null,
    mvpId: raw.mvp_steam_id ? String(raw.mvp_steam_id) : null,
    mvpName: raw.mvp_player_name ?? null,
    homeEventStack: [],
    awayEventStack: [],
    comparisonStats: [],
    gameHighlights: [],
    shotMap: [],
    shotZoneMaps: null,
    shotZones: [],
    lineups: {
      home: [],
      away: [],
    },
    lineupTooltips: {},
    mvpSummary: [],
    performances: [],
    tournamentId: raw.tournament_id != null ? String(raw.tournament_id) : null,
    tournamentName: raw.tournament_name ?? null,
    weekNumber: raw.week_number ?? null,
    leagueKey: raw.league_key ?? null,
    homeTeamName: raw.home_team_name ?? '',
    awayTeamName: raw.away_team_name ?? '',
    isDetailed: false,
  }
}

function mapMatchDetail(rawMatch) {
  const summary = mapMatchSummary(rawMatch)
  const lineupSideByPlayer = buildLineupSideLookup(rawMatch.lineups ?? [])
  const playerStats = (rawMatch.player_stats ?? []).map((entry) => mapPerformance(entry, summary, lineupSideByPlayer))
  const statsByPlayer = new Map(playerStats.map((entry) => [entry.playerId, entry]))
  const namesByPlayer = new Map(playerStats.map((entry) => [entry.playerId, entry.playerName]))

  const events = (rawMatch.events ?? []).map((entry) => mapEvent(entry, namesByPlayer, summary, lineupSideByPlayer))
  const groupedEvents = groupEventsByPlayer(events)
  const lineups = buildDetailedLineups(rawMatch.lineups ?? [], statsByPlayer, groupedEvents)

  return {
    ...summary,
    homeEventStack: buildEventStack(groupedEvents.home),
    awayEventStack: buildEventStack(groupedEvents.away),
    comparisonStats: buildComparisonStats(playerStats),
    gameHighlights: buildGameHighlights(events),
    shotMap: buildShotMap(events),
    shotZoneMaps: buildShotZoneMaps(events),
    lineups,
    lineupTooltips: buildLineupTooltips(playerStats),
    mvpSummary: buildMvpSummary(summary.mvpId, statsByPlayer),
    performances: playerStats,
    isDetailed: true,
  }
}

function mapTournamentSummary(raw) {
  return {
    id: String(raw.tournament_id),
    numericId: toNumber(raw.tournament_id),
    name: raw.name ?? 'Tournament',
    logo: abbreviateLabel(raw.name, 2),
    status: toTitleCase(raw.status || 'Unknown'),
    teams: toNumber(raw.num_teams),
    prestige: formatTournamentPrestige(raw.format),
    schedule: formatIsoDate(raw.created_at) || 'Season archive',
    description: buildTournamentDescription(raw),
    winnerTeamId: null,
    standingsGroups: [],
    leaders: {},
    fixtures: [],
    bracket: raw.format === 'cup' ? ['Knockout'] : ['League Table'],
    isDetailed: false,
  }
}

function mapTournamentDetail(rawTournament, players) {
  const summary = mapTournamentSummary(rawTournament)
  const fixtures = (rawTournament.fixtures ?? []).map((entry) => mapTournamentFixture(entry, summary))
  const standingsGroups = buildTournamentStandingsGroups(rawTournament, fixtures)
  const teamIds = new Set((rawTournament.teams ?? []).map((entry) => String(entry.guild_id)).filter(Boolean))

  return {
    ...summary,
    winnerTeamId: pickTournamentWinner(summary.status, standingsGroups),
    standingsGroups,
    leaders: buildTournamentLeaders(players, teamIds),
    fixtures,
    bracket: summary.prestige.toLowerCase().includes('cup') ? ['Knockout'] : ['League Table'],
    isDetailed: true,
  }
}

function mapMediaItem(raw) {
  const group = classifyMediaGroup(raw.media_type)
  const duration = toNumber(raw.duration_seconds)

  return {
    id: String(raw.media_id),
    title: raw.title ?? 'Media Item',
    type: formatMediaType(raw.media_type),
    group,
    length: duration > 0 ? formatDuration(duration) : 'External asset',
    lengthBucket: duration <= 30 ? 'short' : duration <= 90 ? 'medium' : 'long',
    accent: mediaAccentForGroup(group),
    uploader: 'Community',
    assetUrl: raw.public_url ?? '#',
  }
}

function mapMatchmakingLeaders(raw) {
  return {
    scorers: Array.isArray(raw?.scorers) ? raw.scorers.map(mapLeaderboardEntry) : [],
    assisters: Array.isArray(raw?.assisters) ? raw.assisters.map(mapLeaderboardEntry) : [],
    saves: Array.isArray(raw?.saves) ? raw.saves.map(mapLeaderboardEntry) : [],
  }
}

function mapLeaderboardEntry(raw) {
  return {
    playerId: raw?.steam_id != null ? String(raw.steam_id) : null,
    value: toNumber(raw?.value),
    appearances: toNumber(raw?.appearances),
  }
}

function mapTeamAggregateStats(raw) {
  if (!raw) {
    return null
  }

  const appearances = Math.max(1, toNumber(raw.appearances))
  const passesAttempted = toNumber(raw.passes_attempted)
  const shots = toNumber(raw.shots)
  const tackles = toNumber(raw.tackles)
  const savesFaced = toNumber(raw.keeper_saves) + toNumber(raw.goals_conceded)
  const totalDistanceRan = toKilometers(raw.distance_covered)

  return {
    appearances,
    assists: toNumber(raw.assists),
    apasses: passesAttempted,
    passesCompleted: toNumber(raw.passes_completed),
    passAccuracy: passesAttempted > 0 ? Math.round((toNumber(raw.passes_completed) / passesAttempted) * 100) : 0,
    keyPasses: toNumber(raw.key_passes),
    chancesCreated: toNumber(raw.chances_created),
    secondAssists: toNumber(raw.second_assists),
    fouls: toNumber(raw.fouls),
    foulsSuffered: toNumber(raw.fouls_suffered),
    yellowCards: toNumber(raw.yellow_cards),
    redCards: toNumber(raw.red_cards),
    offsides: toNumber(raw.offsides),
    saves: toNumber(raw.keeper_saves),
    savesCaught: toNumber(raw.keeper_saves_caught),
    savePercentage: savesFaced > 0 ? Math.round((toNumber(raw.keeper_saves) / savesFaced) * 100) : 0,
    goalsConceded: toNumber(raw.goals_conceded),
    ownGoals: toNumber(raw.own_goals),
    interceptions: toNumber(raw.interceptions),
    tackles,
    tacklesCompleted: toNumber(raw.sliding_tackles_completed),
    tackleAccuracy: tackles > 0 ? Math.round((toNumber(raw.sliding_tackles_completed) / tackles) * 100) : 0,
    distanceRan: Number((totalDistanceRan / appearances).toFixed(1)),
    totalDistanceRan: Number(totalDistanceRan.toFixed(1)),
    goals: toNumber(raw.goals),
    shots,
    shotsOnTarget: toNumber(raw.shots_on_goal),
    shotAccuracy: shots > 0 ? Math.round((toNumber(raw.shots_on_goal) / shots) * 100) : 0,
    goalsPerGame: Number((toNumber(raw.goals) / appearances).toFixed(2)),
    avgRating: Number(toNumber(raw.avg_match_rating).toFixed(1)),
  }
}

function mapPlayerMatchLog(rawMatch, playerId) {
  const performance = mapPerformance(rawMatch)
  const competition = rawMatch.tournament_name || formatGameType(rawMatch.game_type)

  return {
    id: String(rawMatch.match_stats_id),
    sourceMatchId: rawMatch.match_id,
    homeTeamId: rawMatch.home_guild_id ? String(rawMatch.home_guild_id) : null,
    awayTeamId: rawMatch.away_guild_id ? String(rawMatch.away_guild_id) : null,
    homeScore: toNumber(rawMatch.home_score),
    awayScore: toNumber(rawMatch.away_score),
    status: 'Final',
    flags: buildMatchFlags(rawMatch),
    competition,
    competitionType: inferCompetitionType(competition),
    format: formatGameType(rawMatch.game_type),
    date: formatLongDate(rawMatch.match_datetime),
    time: formatTime(rawMatch.match_datetime),
    mvpId: rawMatch.is_match_mvp ? playerId : null,
    performances: [performance],
  }
}

function mapPerformance(raw, matchSummary = null, lineupSideByPlayer = null) {
  const teamSide = inferEntitySide(
    {
      rawSide: raw.team_side,
      teamId: raw.team_guild_id,
      teamName: raw.guild_team_name,
      playerId: raw.steam_id,
    },
    matchSummary,
    lineupSideByPlayer
  )

  return {
    playerId: raw.steam_id ? String(raw.steam_id) : null,
    playerName: raw.player_name ?? '',
    rating: Number(toNumber(raw.match_rating).toFixed(1)),
    goals: toNumber(raw.goals),
    shots: toNumber(raw.shots),
    onTarget: toNumber(raw.shots_on_goal),
    assists: toNumber(raw.assists),
    secondAssists: toNumber(raw.second_assists),
    keyPasses: toNumber(raw.key_passes),
    chancesCreated: toNumber(raw.chances_created),
    passes: toNumber(raw.passes_attempted),
    completed: toNumber(raw.passes_completed),
    completionPct: toNumber(raw.pass_accuracy),
    interceptions: toNumber(raw.interceptions),
    possessions: Number(toNumber(raw.possession).toFixed(1)),
    saves: toNumber(raw.keeper_saves),
    offsides: toNumber(raw.offsides),
    distance: `${Number(toKilometers(raw.distance_covered).toFixed(2))}km`,
    fouls: toNumber(raw.fouls),
    foulsSuffered: toNumber(raw.fouls_suffered),
    ownGoals: toNumber(raw.own_goals),
    goalsConceded: toNumber(raw.goals_conceded),
    corners: toNumber(raw.corners),
    throwIns: toNumber(raw.throw_ins),
    freeKicks: toNumber(raw.free_kicks),
    goalKicks: toNumber(raw.goal_kicks),
    penalties: toNumber(raw.penalties),
    yellowCards: toNumber(raw.yellow_cards),
    redCards: toNumber(raw.red_cards),
    position: normalizePosition(raw.position_code),
    teamSide,
    isMatchMvp: Boolean(raw.is_match_mvp),
  }
}

function mapEvent(raw, namesByPlayer, matchSummary = null, lineupSideByPlayer = null) {
  const type = normalizeEventType(raw.event_type || raw.raw_event)
  const player1 = raw.player1_steam_id ? String(raw.player1_steam_id) : null
  const player2 = raw.player2_steam_id ? String(raw.player2_steam_id) : null
  const side = inferEntitySide(
    {
      rawSide: raw.team_side,
      teamId: raw.team_guild_id,
      playerId: player1,
    },
    matchSummary,
    lineupSideByPlayer
  )

  return {
    id: String(raw.source_event_id),
    side,
    teamId: raw.team_guild_id ? String(raw.team_guild_id) : null,
    type,
    minute: toNumber(raw.minute || 0),
    matchSecond: toNumber(raw.match_second),
    period: String(raw.period ?? '').trim().toUpperCase(),
    playerId: player1,
    playerName: namesByPlayer.get(player1) ?? player1 ?? 'Unknown',
    assistId: player2,
    assistName: namesByPlayer.get(player2) ?? player2 ?? null,
    normX: toUnitCoordinate(raw.norm_x, raw.x),
    normY: toUnitCoordinate(raw.norm_y, raw.y),
  }
}

function enrichTeams(teams, matches) {
  const enriched = teams.map((team) => {
    const teamMatches = matches
      .filter((match) => match.homeTeamId === team.id || match.awayTeamId === team.id)
      .sort(compareMatchDates)

    return {
      ...team,
      rank: 0,
      form: buildForm(team.id, teamMatches),
      competition: deriveTeamCompetition(team, teamMatches),
    }
  })

  const sorted = enriched.slice().sort(compareTeamsForRanking)
  const rankById = new Map(sorted.map((team, index) => [team.id, index + 1]))

  return sorted.map((team) => ({
    ...team,
    rank: rankById.get(team.id) ?? 0,
  }))
}

function enrichPlayers(players, teams) {
  const teamIds = new Set(teams.map((team) => team.id))
  return players.map((player) => ({
    ...player,
    teamId: teamIds.has(player.teamId) ? player.teamId : null,
  }))
}

function enrichTournaments(tournaments, teams, players) {
  return tournaments.map((tournament) => {
    const relatedTeams = teams.filter((team) => team.competition === tournament.name)
    const teamIds = new Set(relatedTeams.map((team) => team.id))

    return {
      ...tournament,
      leaders: tournament.isDetailed ? tournament.leaders : buildTournamentLeaders(players, teamIds),
    }
  })
}

function buildLineupSideLookup(rawLineups = []) {
  return rawLineups.reduce((accumulator, entry) => {
    const playerId = entry.steam_id != null ? String(entry.steam_id) : null
    const side = normalizeSide(entry.side)

    if (playerId && side) {
      accumulator.set(playerId, side)
    }

    return accumulator
  }, new Map())
}

function inferEntitySide(entity, matchSummary = null, lineupSideByPlayer = null) {
  const explicitSide = normalizeSide(entity?.rawSide)
  if (explicitSide) {
    return explicitSide
  }

  const playerId = entity?.playerId != null ? String(entity.playerId) : null
  if (playerId && lineupSideByPlayer?.has(playerId)) {
    return lineupSideByPlayer.get(playerId) ?? null
  }

  const teamId = entity?.teamId != null ? String(entity.teamId) : null
  if (teamId && matchSummary) {
    if (matchSummary.homeTeamId && teamId === String(matchSummary.homeTeamId)) {
      return 'home'
    }
    if (matchSummary.awayTeamId && teamId === String(matchSummary.awayTeamId)) {
      return 'away'
    }
  }

  const comparableTeamName = normalizeComparableLabel(entity?.teamName)
  if (comparableTeamName && matchSummary) {
    if (comparableTeamName === normalizeComparableLabel(matchSummary.homeTeamName)) {
      return 'home'
    }
    if (comparableTeamName === normalizeComparableLabel(matchSummary.awayTeamName)) {
      return 'away'
    }
  }

  return null
}

function buildDetailedLineups(rawLineups, statsByPlayer, groupedEvents) {
  const lineups = {
    home: [],
    away: [],
  }

  rawLineups.forEach((entry) => {
    const playerId = entry.steam_id ? String(entry.steam_id) : null
    const statLine = playerId ? statsByPlayer.get(playerId) : null
    const side = normalizeSide(entry.side, 'home')
    const events = side === 'away' ? groupedEvents.away : groupedEvents.home
    const eventSummary = playerId ? events.get(playerId) : null

    lineups[side].push({
      playerId,
      player: entry.player_name ?? playerId ?? 'Player',
      role: normalizePosition(entry.position_code),
      rating: typeof statLine?.rating === 'number' ? statLine.rating : null,
      badges: buildBadgeSummary(statLine, eventSummary),
      started: Boolean(entry.started),
      slotOrder: toNumber(entry.slot_order),
    })
  })

  lineups.home.sort((left, right) => left.slotOrder - right.slotOrder || left.role.localeCompare(right.role))
  lineups.away.sort((left, right) => left.slotOrder - right.slotOrder || left.role.localeCompare(right.role))
  return lineups
}

function buildEventStack(groupedSideEvents) {
  return Array.from(groupedSideEvents.values())
    .map((entry) => ({
      playerName: entry.playerName,
      events: entry.events.sort((left, right) => left.minute - right.minute),
    }))
    .filter((entry) => entry.events.length)
}

function groupEventsByPlayer(events) {
  const grouped = {
    home: new Map(),
    away: new Map(),
  }

  events.forEach((event) => {
    if (!event.side || !event.playerId || !['goal', 'own-goal', 'yellow-card', 'second_yellow', 'red-card', 'save', 'miss'].includes(event.type)) {
      return
    }

    const bucket = grouped[event.side]
    const current = bucket.get(event.playerId) ?? {
      playerId: event.playerId,
      playerName: event.playerName,
      events: [],
    }
    current.events.push({
      minute: event.minute,
      type: event.type,
    })
    bucket.set(event.playerId, current)
  })

  return grouped
}

function buildBadgeSummary(statLine, eventSummary) {
  const badges = []

  if (statLine?.goals) badges.push({ type: 'goal', count: statLine.goals })
  if (statLine?.assists) badges.push({ type: 'assist', count: statLine.assists })
  if (statLine?.saves) badges.push({ type: 'save', count: statLine.saves })
  if (statLine?.yellowCards) badges.push({ type: 'yellow-card', count: statLine.yellowCards })
  if (statLine?.redCards) badges.push({ type: 'red-card', count: statLine.redCards })
  if (statLine?.ownGoals) badges.push({ type: 'own-goal', count: statLine.ownGoals })
  if (statLine?.isMatchMvp) badges.push({ type: 'mvp', count: 1 })

  if (eventSummary?.events.some((event) => event.type === 'second_yellow')) {
    badges.push({ type: 'second_yellow', count: 1 })
  }

  return badges
}

function buildLineupTooltips(playerStats) {
  return playerStats.reduce((accumulator, player) => {
    if (!player.playerId) return accumulator

    const lines = [
      `${player.rating.toFixed(1)} match rating`,
      `${player.goals} goals`,
      `${player.assists} assists`,
      `${player.completed}/${player.passes} passes`,
      `${player.interceptions} interceptions`,
    ].filter(Boolean)

    accumulator[player.playerId] = lines
    return accumulator
  }, {})
}

function buildMvpSummary(playerId, statsByPlayer) {
  if (!playerId) return []
  const player = statsByPlayer.get(playerId)
  if (!player) return []

  return [
    { label: 'Goals', value: player.goals },
    { label: 'Assists', value: player.assists },
    { label: 'Key passes', value: player.keyPasses },
  ]
}

function buildComparisonStats(playerStats) {
  const sides = {
    home: aggregateSideStats(playerStats.filter((entry) => entry.teamSide === 'home')),
    away: aggregateSideStats(playerStats.filter((entry) => entry.teamSide === 'away')),
  }
  const possessionTotal = sides.home.possessionRaw + sides.away.possessionRaw
  const homePossession = possessionTotal > 0 ? Math.round((sides.home.possessionRaw / possessionTotal) * 100) : 0
  const awayPossession = possessionTotal > 0 ? Math.max(0, 100 - homePossession) : 0

  return [
    ['Possession', homePossession, awayPossession],
    ['Shots', sides.home.shots, sides.away.shots],
    ['Shots on target', sides.home.shotsOnTarget, sides.away.shotsOnTarget],
    ['Saves', sides.home.saves, sides.away.saves],
    ['Passes', sides.home.passes, sides.away.passes],
    ['Passes completed', sides.home.completed, sides.away.completed],
    ['Pass accuracy', sides.home.passAccuracy, sides.away.passAccuracy],
    ['Interceptions', sides.home.interceptions, sides.away.interceptions],
    ['Corners', sides.home.corners, sides.away.corners],
    ['Fouls', sides.home.fouls, sides.away.fouls],
    ['Offsides', sides.home.offsides, sides.away.offsides],
    ['Yellow Cards', sides.home.yellowCards, sides.away.yellowCards],
    ['Red Cards', sides.home.redCards, sides.away.redCards],
  ]
}

function aggregateSideStats(rows) {
  if (!rows.length) {
    return {
      possessionRaw: 0,
      shots: 0,
      shotsOnTarget: 0,
      saves: 0,
      passes: 0,
      completed: 0,
      passAccuracy: 0,
      interceptions: 0,
      corners: 0,
      fouls: 0,
      offsides: 0,
      yellowCards: 0,
      redCards: 0,
    }
  }

  const total = rows.reduce((accumulator, row) => ({
    possessionRaw: accumulator.possessionRaw + row.possessions,
    shots: accumulator.shots + row.shots,
    shotsOnTarget: accumulator.shotsOnTarget + row.onTarget,
    saves: accumulator.saves + row.saves,
    passes: accumulator.passes + row.passes,
    completed: accumulator.completed + row.completed,
    interceptions: accumulator.interceptions + row.interceptions,
    corners: accumulator.corners + row.corners,
    fouls: accumulator.fouls + row.fouls,
    offsides: accumulator.offsides + row.offsides,
    yellowCards: accumulator.yellowCards + row.yellowCards,
    redCards: accumulator.redCards + row.redCards,
  }), {
    possessionRaw: 0,
    shots: 0,
    shotsOnTarget: 0,
    saves: 0,
    passes: 0,
    completed: 0,
    interceptions: 0,
    corners: 0,
    fouls: 0,
    offsides: 0,
    yellowCards: 0,
    redCards: 0,
  })

  return {
    ...total,
    passAccuracy: total.passes > 0 ? Math.round((total.completed / total.passes) * 100) : 0,
  }
}

function buildGameHighlights(events) {
  return events
    .filter((event) => ['goal', 'own-goal', 'yellow-card', 'second_yellow', 'red-card', 'save'].includes(event.type))
    .sort((left, right) => right.minute - left.minute)
    .map((event) => ({
      minute: String(event.minute),
      type: event.type,
      playerName: event.playerName,
      assistName: event.assistName,
      text: event.playerName,
    }))
}

function buildShotMap(events) {
  return events
    .filter((event) => event.side && ['goal', 'save', 'miss', 'own-goal'].includes(event.type))
    .map((event) => {
      const coordinates = toShotMapCoordinates(event)
      if (!coordinates) {
        return null
      }

      return {
      id: event.id,
      teamId: event.teamId,
      playerName: event.playerName,
      minute: event.minute,
      x: coordinates.x,
      y: coordinates.y,
      type: event.type,
      }
    })
    .filter(Boolean)
}

function buildShotZoneMaps(events) {
  const homeShots = events.filter((event) => event.side === 'home' && ['goal', 'save', 'miss', 'own-goal'].includes(event.type))
  const awayShots = events.filter((event) => event.side === 'away' && ['goal', 'save', 'miss', 'own-goal'].includes(event.type))

  return {
    home: buildShotZoneSummary('home', homeShots),
    away: buildShotZoneSummary('away', awayShots),
  }
}

function buildTournamentStandingsGroups(rawTournament, fixtures) {
  const teamLeagueById = new Map()
  const teamLeagueByName = new Map()
  const explicitLeagueKeys = new Set()

  ;(rawTournament.teams ?? []).forEach((entry) => {
    const leagueKey = normalizeTournamentLeagueKey(entry.league_key)
    const teamId = entry.guild_id != null ? String(entry.guild_id) : null
    const teamName = normalizeComparableLabel(entry.team_name)

    if (leagueKey !== 'Table') {
      explicitLeagueKeys.add(leagueKey)
    }
    if (teamId) {
      teamLeagueById.set(teamId, leagueKey)
    }
    if (teamName) {
      teamLeagueByName.set(teamName, leagueKey)
    }
  })

  fixtures.forEach((fixture) => {
    const leagueKey = normalizeTournamentLeagueKey(fixture.leagueKey)
    const homeId = fixture.homeTeamId ? String(fixture.homeTeamId) : null
    const awayId = fixture.awayTeamId ? String(fixture.awayTeamId) : null
    const homeName = normalizeComparableLabel(fixture.homeTeamName)
    const awayName = normalizeComparableLabel(fixture.awayTeamName)

    if (leagueKey !== 'Table') {
      explicitLeagueKeys.add(leagueKey)
    }
    if (homeId && !teamLeagueById.has(homeId)) {
      teamLeagueById.set(homeId, leagueKey)
    }
    if (awayId && !teamLeagueById.has(awayId)) {
      teamLeagueById.set(awayId, leagueKey)
    }
    if (homeName && !teamLeagueByName.has(homeName)) {
      teamLeagueByName.set(homeName, leagueKey)
    }
    if (awayName && !teamLeagueByName.has(awayName)) {
      teamLeagueByName.set(awayName, leagueKey)
    }
  })

  const fixturesByLeague = groupBy(fixtures, (fixture) => fixture.leagueKey || 'Table')
  const standingsByLeague = (rawTournament.standings ?? []).reduce((accumulator, row) => {
    const leagueKey = resolveTournamentStandingsLeagueKey(row, teamLeagueById, teamLeagueByName, explicitLeagueKeys)
    if (!leagueKey) {
      return accumulator
    }

    accumulator[leagueKey] = accumulator[leagueKey] ?? []
    accumulator[leagueKey].push(row)
    return accumulator
  }, {})

  return Object.entries(standingsByLeague)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, undefined, { numeric: true, sensitivity: 'base' }))
    .map(([leagueKey, rows]) => ({
      name: formatTournamentLeagueLabel(leagueKey),
      leagueKey,
      rows: rows
        .slice()
        .sort(compareTournamentStandingsRows)
        .map((row) => ({
          teamId: row.guild_id ? String(row.guild_id) : null,
          teamName: row.team_name ?? 'Unknown Team',
          played: toNumber(row.matches_played),
          wins: toNumber(row.wins),
          draws: toNumber(row.draws),
          losses: toNumber(row.losses),
          goalsFor: toNumber(row.goals_for),
          goalsAgainst: toNumber(row.goals_against),
          gd: toNumber(row.goal_diff),
          points: toNumber(row.points),
          form: buildTournamentForm(row.guild_id ? String(row.guild_id) : null, fixturesByLeague[leagueKey] ?? []),
        })),
    }))
}

function buildTournamentForm(teamId, fixtures) {
  if (!teamId) return []

  return fixtures
    .filter((fixture) => fixture.status === 'Final')
    .filter((fixture) => fixture.homeTeamId === teamId || fixture.awayTeamId === teamId)
    .sort(compareMatchDates)
    .slice(0, 5)
    .map((fixture) => resultForTeam(teamId, fixture))
}

function mapTournamentFixture(rawFixture, tournament) {
  const leagueKey = normalizeTournamentLeagueKey(rawFixture.league_key)
  const played = isTournamentFixtureFinal(rawFixture)
  const matchDate = rawFixture.played_match_datetime || rawFixture.played_at || rawFixture.created_at
  const homeTeamName = rawFixture.played_home_team_name || rawFixture.home_name || 'Home Team'
  const awayTeamName = rawFixture.played_away_team_name || rawFixture.away_name || 'Away Team'
  const homeScore = resolveTournamentFixtureScore(rawFixture, 'home')
  const awayScore = resolveTournamentFixtureScore(rawFixture, 'away')
  const homeResult = resolveTournamentFixtureSideResult(rawFixture, 'home', homeScore, awayScore)
  const awayResult = resolveTournamentFixtureSideResult(rawFixture, 'away', homeScore, awayScore)
  const status = describeTournamentFixtureStatus(rawFixture, homeTeamName, awayTeamName)
  const flags = buildTournamentFixtureFlags(rawFixture)

  return {
    id: String(rawFixture.played_match_stats_id ?? rawFixture.fixture_id),
    fixtureId: toNumber(rawFixture.fixture_id),
    homeTeamId: rawFixture.home_guild_id ? String(rawFixture.home_guild_id) : null,
    awayTeamId: rawFixture.away_guild_id ? String(rawFixture.away_guild_id) : null,
    homeTeamName,
    awayTeamName,
    homeScore,
    awayScore,
    homeResult,
    awayResult,
    status,
    flags,
    competition: tournament.name,
    competitionType: inferCompetitionType(tournament.prestige),
    format: played ? formatGameType(rawFixture.played_game_type) : tournament.prestige,
    date: formatLongDate(matchDate),
    time: formatTime(matchDate),
    leagueKey,
    weekNumber: rawFixture.week_number ?? null,
  }
}

function pickTournamentWinner(status, standingsGroups) {
  if (String(status).toLowerCase() !== 'completed') return null
  const firstGroup = standingsGroups[0]
  return firstGroup?.rows?.[0]?.teamId ?? null
}

function buildTournamentLeaders(players, teamIds) {
  const pool = teamIds.size
    ? players.filter((player) => teamIds.has(player.teamId))
    : players

  return {
    scorers: pool.slice().sort((left, right) => right.stats.goals - left.stats.goals).slice(0, 3).map((player) => player.name),
    assisters: pool.slice().sort((left, right) => right.stats.assists - left.stats.assists).slice(0, 3).map((player) => player.name),
    mvps: pool.slice().sort((left, right) => right.mvps - left.mvps).slice(0, 3).map((player) => player.name),
    goalkeepers: pool.filter((player) => player.position === 'GK').sort((left, right) => right.stats.saves - left.stats.saves).slice(0, 3).map((player) => player.name),
    defenders: pool.filter((player) => ['LB', 'CB', 'RB'].includes(player.position)).sort((left, right) => right.stats.interceptions - left.stats.interceptions).slice(0, 3).map((player) => player.name),
  }
}

function buildRecords(players, teams) {
  const teamNameById = new Map(teams.map((team) => [team.id, team.name]))
  const records = []

  const topGoals = players.slice().sort((left, right) => right.stats.goals - left.stats.goals)[0]
  const topAssists = players.slice().sort((left, right) => right.stats.assists - left.stats.assists)[0]
  const topInterceptions = players.slice().sort((left, right) => right.stats.interceptions - left.stats.interceptions)[0]
  const topSaves = players.filter((player) => player.position === 'GK').sort((left, right) => right.stats.saves - left.stats.saves)[0]
  const topPasses = players.slice().sort((left, right) => right.stats.apasses - left.stats.apasses)[0]
  const topSecondAssists = players.slice().sort((left, right) => right.stats.secondAssists - left.stats.secondAssists)[0]
  const topRedCards = players.slice().sort((left, right) => right.stats.redCards - left.stats.redCards)[0]
  const topPlayer = players.slice().sort((left, right) => right.rating - left.rating)[0]
  const topTeam = teams.slice().sort(compareTeamsForRanking)[0]

  if (topGoals) records.push({ label: 'Most Goals', holder: topGoals.name, value: topGoals.stats.goals, context: 'Across synced official hub matches' })
  if (topAssists) records.push({ label: 'Most Assists', holder: topAssists.name, value: topAssists.stats.assists, context: 'Across synced official hub matches' })
  if (topInterceptions) records.push({ label: 'Most Interceptions', holder: topInterceptions.name, value: topInterceptions.stats.interceptions, context: 'Across synced official hub matches' })
  if (topSaves) records.push({ label: 'Most Saves', holder: topSaves.name, value: topSaves.stats.saves, context: 'Across synced official hub matches' })
  if (topPasses) records.push({ label: 'Most Passes', holder: topPasses.name, value: topPasses.stats.apasses, context: 'Across synced official hub matches' })
  if (topSecondAssists) records.push({ label: 'Most 2nd Assists', holder: topSecondAssists.name, value: topSecondAssists.stats.secondAssists, context: 'Across synced official hub matches' })
  if (topRedCards) records.push({ label: 'Most Red Cards', holder: topRedCards.name, value: topRedCards.stats.redCards, context: 'Across synced official hub matches' })
  if (topPlayer) records.push({ label: 'Highest Rated Player', holder: topPlayer.name, value: topPlayer.rating, context: topPlayer.teamId ? (teamNameById.get(topPlayer.teamId) ?? topPlayer.teamId) : 'Active hub player' })
  if (topTeam) records.push({ label: 'Highest Rated Team', holder: topTeam.name, value: topTeam.avgRating.toFixed(1), context: `${topTeam.wins} wins | ${topTeam.draws} draws | ${topTeam.losses} losses` })

  return records
}

function buildQuickStats(players, teams, matches, media, summary) {
  const now = Date.now()
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)
  const activePlayersLast7Days = summary?.active_players_last_7_days ?? players.filter((player) => {
    const parsed = parseDisplayDate(player.lastMatchAt)
    return parsed && parsed >= sevenDaysAgo
  }).length
  const matchesLast7Days = summary?.matches_last_7_days ?? matches.filter((match) => {
    const parsed = parseDisplayDate(match.date)
    return parsed && parsed >= sevenDaysAgo
  }).length
  const totalPlayers = summary?.total_players ?? players.length
  const totalTeams = summary?.total_teams ?? teams.length
  const totalMatches = summary?.total_matches ?? matches.length
  const totalMediaAssets = summary?.total_media_assets ?? media.length

  return [
    { label: 'Total Players', value: String(totalPlayers), delta: `${activePlayersLast7Days} active in last 7 days` },
    { label: 'Matches Last 7 Days', value: String(matchesLast7Days), delta: `${totalMatches} total synced` },
    { label: 'Media Assets', value: String(totalMediaAssets), delta: 'Public hub library' },
    { label: 'Tracked Teams', value: String(totalTeams), delta: 'Hub read model' },
  ]
}

function buildHomeFeatures(matches, tournaments, teams) {
  const teamNameById = new Map(teams.map((team) => [team.id, team.name]))
  const latestMatch = matches.slice().sort(compareMatchDates)[0]
  const latestTournament = tournaments[0]

  return [
    latestMatch ? {
      label: 'Latest Match',
      title: `${teamNameById.get(latestMatch.homeTeamId) ?? latestMatch.homeTeamName ?? latestMatch.homeTeamId} ${latestMatch.homeScore} : ${latestMatch.awayScore} ${teamNameById.get(latestMatch.awayTeamId) ?? latestMatch.awayTeamName ?? latestMatch.awayTeamId}`,
      description: 'Open the most recent synced result and review the lineups, events, and player statistics.',
      action: `/matches/${latestMatch.id}`,
      accent: 'cyan',
    } : null,
    latestTournament ? {
      label: 'Latest Tournament',
      title: latestTournament.name,
      description: 'Review the most recent synced tournament table, fixtures, and team placements.',
      action: `/tournaments/${latestTournament.id}`,
      accent: 'blue',
    } : null,
    { label: 'Rankings', title: 'Track who is rising across players and teams', description: 'Compare top performers, team power levels, and head to head summaries in one place.', action: '/rankings', accent: 'gold' },
    { label: 'Records', title: 'The historical archive is now based on live hub data', description: 'View current leaders for goals, assists, saves, interceptions, and rating.', action: '/records', accent: 'green' },
    { label: 'Media', title: 'Highlights and uploaded assets live here', description: 'Browse the synced public media library from the hub database.', action: '/media', accent: 'purple' },
    { label: 'Discord', title: 'The community still runs through Discord', description: 'Use the hub to bridge league data with scheduling, announcements, and match chatter.', action: '/discord', accent: 'red' },
  ].filter(Boolean)
}

function buildDiscordOverview(players, teams, matches, media) {
  return {
    serverName: 'IOSCA Discord',
    inviteLabel: 'Community operations, league announcements, match scheduling, and media drops.',
    stats: [
      { label: 'Tracked Teams', value: String(teams.length) },
      { label: 'Tracked Players', value: String(players.length) },
      { label: 'Synced Matches', value: String(matches.length) },
      { label: 'Public Media', value: String(media.length) },
    ],
    channels: ['#announcements', '#matchday', '#transfers', '#highlights', '#support'],
  }
}

function buildPlayerActivity(matchLogs) {
  const countsByDate = new Map()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  matchLogs.forEach((match) => {
    const parsed = parseDisplayDate(match.date)
    if (!parsed) return
    parsed.setHours(0, 0, 0, 0)
    const key = parsed.toISOString().slice(0, 10)
    countsByDate.set(key, (countsByDate.get(key) ?? 0) + 1)
  })

  return Array.from({ length: 365 }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (364 - index))
    const key = date.toISOString().slice(0, 10)
    const value = countsByDate.get(key) ?? 0

    return {
      date: key,
      label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      value,
      level: Math.min(Math.max(value, 0), 5),
    }
  })
}

function buildPlayerRecords(matchLogs) {
  if (!matchLogs.length) {
    return []
  }

  const performances = matchLogs
    .map((match) => ({
      matchId: match.id,
      summary: `${getTeamName(match.homeTeamId)} ${match.homeScore} : ${match.awayScore} ${getTeamName(match.awayTeamId)}`,
      performance: match.performances[0],
    }))
    .filter((entry) => entry.performance)

  const topGoals = performances.slice().sort((left, right) => right.performance.goals - left.performance.goals)[0]
  const topAssists = performances.slice().sort((left, right) => right.performance.assists - left.performance.assists)[0]
  const topSecondAssists = performances.slice().sort((left, right) => right.performance.secondAssists - left.performance.secondAssists)[0]
  const topPasses = performances.slice().sort((left, right) => right.performance.passes - left.performance.passes)[0]
  const topRedCards = performances.slice().sort((left, right) => right.performance.redCards - left.performance.redCards)[0]
  const topRating = performances.slice().sort((left, right) => right.performance.rating - left.performance.rating)[0]
  const lowRating = performances.slice().sort((left, right) => left.performance.rating - right.performance.rating)[0]

  return [
    topGoals ? { label: 'Most goals in a match', value: String(topGoals.performance.goals), matchId: topGoals.matchId, summary: topGoals.summary } : null,
    topAssists ? { label: 'Most assists in a match', value: String(topAssists.performance.assists), matchId: topAssists.matchId, summary: topAssists.summary } : null,
    topSecondAssists ? { label: 'Most 2nd assists in a match', value: String(topSecondAssists.performance.secondAssists), matchId: topSecondAssists.matchId, summary: topSecondAssists.summary } : null,
    topPasses ? { label: 'Most passes in a match', value: String(topPasses.performance.passes), matchId: topPasses.matchId, summary: topPasses.summary } : null,
    topRedCards ? { label: 'Most red cards in a match', value: String(topRedCards.performance.redCards), matchId: topRedCards.matchId, summary: topRedCards.summary } : null,
    topRating ? { label: 'Highest match rating', value: String(topRating.performance.rating), matchId: topRating.matchId, summary: topRating.summary } : null,
    lowRating ? { label: 'Lowest match rating', value: String(lowRating.performance.rating), matchId: lowRating.matchId, summary: lowRating.summary } : null,
  ].filter(Boolean)
}

function buildForm(teamId, matches) {
  return matches
    .slice()
    .sort(compareMatchDates)
    .slice(0, 5)
    .map((match) => resultForTeam(teamId, match))
}

function resultForTeam(teamId, match) {
  if (match.homeResult && match.awayResult) {
    return match.homeTeamId === teamId ? match.homeResult : match.awayResult
  }
  const isHome = match.homeTeamId === teamId
  const goalsFor = isHome ? match.homeScore : match.awayScore
  const goalsAgainst = isHome ? match.awayScore : match.homeScore
  if (goalsFor > goalsAgainst) return 'W'
  if (goalsFor < goalsAgainst) return 'L'
  return 'D'
}

function deriveTeamCompetition(team, matches) {
  if (team.isNationalTeam) return 'National Team'
  if (team.isMixTeam) return 'Mix Team'
  return matches[0]?.competition ?? 'Hub Team'
}

function compareMatchDates(left, right) {
  const leftDate = parseDisplayDate(left.date)
  const rightDate = parseDisplayDate(right.date)
  return (rightDate?.getTime() ?? 0) - (leftDate?.getTime() ?? 0)
}

function parseDisplayDate(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatLongDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatIsoDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatGameType(value) {
  return String(value ?? '').trim().toUpperCase() || 'Match'
}

function formatTournamentPrestige(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'cup') return 'Elite Cup'
  if (normalized === 'league') return 'League'
  return toTitleCase(value || 'Tournament')
}

function buildTournamentDescription(raw) {
  const formatLabel = formatTournamentPrestige(raw.format)
  return `${formatLabel} competition with ${toNumber(raw.num_teams)} tracked teams.`
}

function inferCompetitionType(value) {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized.includes('cup')) return 'Cup'
  if (normalized.includes('league')) return 'League'
  return 'Competition'
}

function buildMatchFlags(raw) {
  const flags = []
  if (raw.extratime) flags.push('ET')
  if (raw.penalties) flags.push('PEN')
  if (raw.comeback_flag) flags.push('COMEBACK')
  return flags
}

function classifyMediaGroup(mediaType) {
  const normalized = String(mediaType ?? '').toLowerCase()
  if (normalized.includes('screen')) return 'screenshots'
  if (normalized.includes('goal')) return 'goal-clips'
  if (normalized.includes('compilation')) return 'compilations'
  return 'highlights'
}

function formatMediaType(mediaType) {
  return toTitleCase(String(mediaType ?? 'media').replaceAll('_', ' '))
}

function mediaAccentForGroup(group) {
  if (group === 'goal-clips') return 'gold'
  if (group === 'screenshots') return 'red'
  if (group === 'compilations') return 'blue'
  return 'cyan'
}

function normalizePosition(position, rawPlayer = null) {
  const normalized = String(position ?? '').trim().toUpperCase()
  if (positionOptions.includes(normalized)) {
    return normalized
  }

  if (rawPlayer) {
    const roleScores = [
      ['GK', toNumber(rawPlayer.gk_rating)],
      ['CB', toNumber(rawPlayer.def_rating)],
      ['CM', toNumber(rawPlayer.mid_rating)],
      ['CF', toNumber(rawPlayer.atk_rating)],
    ]
    roleScores.sort((left, right) => right[1] - left[1])
    return roleScores[0][0]
  }

  return 'CM'
}

function normalizeRegisteredDiscordId(value) {
  const text = String(value ?? '').trim()
  if (!text || text.startsWith('unregistered:')) {
    return null
  }

  const numeric = Number(text)
  if (Number.isFinite(numeric) && numeric <= 0) {
    return null
  }

  return text
}

function normalizeSide(value, fallback = null) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'home' || normalized === 'away') {
    return normalized
  }
  return fallback
}

function normalizeEventType(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replaceAll(' ', '_')
  if (normalized.includes('own')) return 'own-goal'
  if (normalized.includes('second_yellow')) return 'second_yellow'
  if (normalized.includes('yellow')) return 'yellow-card'
  if (normalized.includes('red')) return 'red-card'
  if (normalized.includes('save')) return 'save'
  if (normalized.includes('goal')) return 'goal'
  if (normalized.includes('shot') || normalized.includes('miss')) return 'miss'
  return normalized
}

function toUnitCoordinate(normalizedValue, rawValue) {
  if (normalizedValue != null) {
    const numeric = Number(normalizedValue)
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.min(1, numeric <= 1 ? numeric : numeric / 100))
    }
  }

  if (rawValue != null) {
    const numeric = Number(rawValue)
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.min(1, numeric <= 1 ? numeric : numeric / 100))
    }
  }

  return null
}

function isFirstHalfPeriod(period, matchSecond) {
  const normalized = String(period ?? '').trim().toUpperCase()
  if (normalized.includes('FIRST')) return true
  if (normalized.includes('SECOND')) return false
  return matchSecond > 0 ? matchSecond < 2700 : true
}

function toTeamPerspectiveCoordinates(event) {
  if (event.normX == null || event.normY == null) {
    return null
  }

  const firstHalf = isFirstHalfPeriod(event.period, event.matchSecond)
  const attackDepth = event.side === 'home'
    ? (firstHalf ? 1 - event.normX : event.normX)
    : (firstHalf ? event.normX : 1 - event.normX)

  return {
    attackDepth: Math.max(0, Math.min(1, attackDepth)),
    lateral: Math.max(0, Math.min(1, event.normY)),
  }
}

function toShotMapCoordinates(event) {
  const perspective = toTeamPerspectiveCoordinates(event)
  if (!perspective) {
    return null
  }

  const displayDepth = event.type === 'save'
    ? 1 - perspective.attackDepth
    : perspective.attackDepth
  const x = event.side === 'home'
    ? 50 - (displayDepth * 50)
    : 50 + (displayDepth * 50)
  const y = perspective.lateral * 100

  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
  }
}

function teamRankingPenalty(team) {
  const noPlayers = toNumber(team.playerCount) <= 0
  const noGames = toNumber(team.appearances) <= 0

  if (noPlayers && noGames) return 2
  if (noPlayers || noGames) return 1
  return 0
}

function compareTeamsForRanking(left, right) {
  return teamRankingPenalty(left) - teamRankingPenalty(right)
    || right.avgRating - left.avgRating
    || right.wins - left.wins
    || right.appearances - left.appearances
    || right.playerCount - left.playerCount
    || left.name.localeCompare(right.name)
}

function normalizeTournamentLeagueKey(value) {
  const text = String(value ?? '').trim()
  return text || 'Table'
}

function resolveTournamentStandingsLeagueKey(row, teamLeagueById, teamLeagueByName, explicitLeagueKeys) {
  const teamId = row.guild_id != null ? String(row.guild_id) : null
  if (teamId && teamLeagueById.has(teamId)) {
    return teamLeagueById.get(teamId)
  }

  const teamName = normalizeComparableLabel(row.team_name)
  if (teamName && teamLeagueByName.has(teamName)) {
    return teamLeagueByName.get(teamName)
  }

  const rowLeagueKey = normalizeTournamentLeagueKey(row.league_key)
  if (rowLeagueKey !== 'Table' || explicitLeagueKeys.size <= 1) {
    return rowLeagueKey
  }

  return null
}

function normalizeComparableLabel(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
}

function formatTournamentLeagueLabel(leagueKey) {
  return leagueKey === 'Table' ? 'Main Table' : `League ${leagueKey}`
}

function compareTournamentStandingsRows(left, right) {
  return toNumber(right.points) - toNumber(left.points)
    || toNumber(right.goal_diff) - toNumber(left.goal_diff)
    || toNumber(right.goals_for) - toNumber(left.goals_for)
    || String(left.team_name ?? '').localeCompare(String(right.team_name ?? ''))
}

function isTournamentFixtureFinal(rawFixture) {
  return rawFixture.played_match_stats_id != null
    || Boolean(rawFixture.is_played)
    || Boolean(rawFixture.is_forfeit_home)
    || Boolean(rawFixture.is_forfeit_away)
    || Boolean(rawFixture.is_draw_home)
    || Boolean(rawFixture.is_draw_away)
}

function resolveTournamentFixtureScore(rawFixture, side) {
  if (rawFixture.played_match_stats_id != null) {
    return side === 'home' ? toNumber(rawFixture.played_home_score) : toNumber(rawFixture.played_away_score)
  }

  const forfeitScore = Math.max(0, toNumber(rawFixture.forfeit_score) || 0)
  if (rawFixture.is_forfeit_home) {
    return side === 'home' ? 0 : forfeitScore
  }
  if (rawFixture.is_forfeit_away) {
    return side === 'home' ? forfeitScore : 0
  }
  return 0
}

function resolveTournamentFixtureSideResult(rawFixture, side, homeScore, awayScore) {
  if (rawFixture.is_forfeit_home) {
    return side === 'home' ? 'L' : 'W'
  }
  if (rawFixture.is_forfeit_away) {
    return side === 'home' ? 'W' : 'L'
  }
  if (rawFixture.is_draw_home || rawFixture.is_draw_away) {
    return 'D'
  }
  if (!isTournamentFixtureFinal(rawFixture)) {
    return null
  }
  if (homeScore > awayScore) {
    return side === 'home' ? 'W' : 'L'
  }
  if (homeScore < awayScore) {
    return side === 'home' ? 'L' : 'W'
  }
  return 'D'
}

function describeTournamentFixtureStatus(rawFixture, homeTeamName, awayTeamName) {
  if (rawFixture.is_forfeit_home) {
    return `${awayTeamName} won by forfeit`
  }
  if (rawFixture.is_forfeit_away) {
    return `${homeTeamName} won by forfeit`
  }
  if (rawFixture.is_draw_home || rawFixture.is_draw_away) {
    return 'Draw by ruling'
  }
  if (rawFixture.played_match_stats_id != null || rawFixture.is_played) {
    return 'Final'
  }
  return rawFixture.is_active ? 'Scheduled' : 'Pending'
}

function buildTournamentFixtureFlags(rawFixture) {
  const flags = []

  if (rawFixture.is_forfeit_home || rawFixture.is_forfeit_away) {
    flags.push('Forfeit')
  }
  if (rawFixture.is_draw_home || rawFixture.is_draw_away) {
    flags.push('Admin draw')
  }
  if (rawFixture.is_played && rawFixture.played_match_stats_id == null && !flags.length) {
    flags.push('Recorded result')
  }

  return flags
}

function buildShotZoneSummary(side, shots) {
  const zoneCounts = new Map()
  let goals = 0

  shots.forEach((event) => {
    const perspective = toTeamPerspectiveCoordinates(event)
    if (!perspective) {
      return
    }

    const column = Math.max(0, Math.min(7, Math.floor(perspective.attackDepth * 8)))
    const row = Math.max(0, Math.min(2, Math.floor(perspective.lateral * 3)))
    const zoneId = `zone-${(row * 8) + column + 1}`
    const current = zoneCounts.get(zoneId) ?? { id: zoneId, shots: 0, goals: 0 }
    current.shots += 1
    if (event.type === 'goal' || event.type === 'own-goal') {
      current.goals += 1
      goals += 1
    }
    zoneCounts.set(zoneId, current)
  })

  const totalShots = shots.length
  const zones = Array.from(zoneCounts.values()).map((zone) => ({
    ...zone,
    percentage: totalShots > 0 ? Math.round((zone.shots / totalShots) * 100) : 0,
    occupant: side === 'home' ? 'Home attack' : 'Away attack',
  }))

  return {
    shots: totalShots,
    goals,
    conversion: totalShots > 0 ? Math.round((goals / totalShots) * 100) : 0,
    zones,
  }
}

function abbreviateLabel(value, maxLength = 2) {
  const text = String(value ?? '').trim()
  if (!text) return '?'
  const parts = text.split(/\s+/).slice(0, maxLength)
  const compact = parts.map((part) => part[0] ?? '').join('')
  return compact.toUpperCase() || text.slice(0, maxLength).toUpperCase()
}

function generateTeamColors(seed) {
  const palette = [
    ['#46d7ff', '#1e63ff'],
    ['#ffd36e', '#ff9540'],
    ['#6cf0cb', '#10907e'],
    ['#ff768f', '#b21e52'],
    ['#6cb6ff', '#3850ff'],
    ['#9e77ff', '#5542ff'],
    ['#ffab91', '#ff7043'],
    ['#80cbc4', '#00897b'],
  ]
  const index = Math.abs(hashCode(String(seed))) % palette.length
  return palette[index]
}

function hashCode(value) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index)
    hash |= 0
  }
  return hash
}

function toTitleCase(value) {
  return String(value ?? '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function toNumber(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function toKilometers(value) {
  const numeric = toNumber(value)
  return numeric > 50 ? numeric / 1000 : numeric
}

function groupBy(items, selector) {
  return items.reduce((accumulator, item) => {
    const key = selector(item)
    accumulator[key] = accumulator[key] ?? []
    accumulator[key].push(item)
    return accumulator
  }, {})
}
