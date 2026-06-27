import { useEffect, useState } from 'react'

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
const REGISTER_TOKEN_STORAGE_KEY = 'iosca-register-token'

function authUrl(path) {
  return `${API_BASE_URL}${path}`
}

function readLocationQuery() {
  if (typeof window === 'undefined') {
    return new URLSearchParams()
  }

  const directSearch = new URLSearchParams(window.location.search)
  if (directSearch.toString()) {
    return directSearch
  }

  const hash = String(window.location.hash ?? '')
  const queryIndex = hash.indexOf('?')
  if (queryIndex >= 0) {
    return new URLSearchParams(hash.slice(queryIndex + 1))
  }

  return new URLSearchParams()
}

async function requestJson(path, options = {}) {
  const response = await fetch(authUrl(path), {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
    ...options,
  })

  if (!response.ok) {
    let message = `Request failed: ${response.status}`
    try {
      const payload = await response.json()
      if (payload?.detail) {
        message = String(payload.detail)
      }
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(message)
  }

  return response.json()
}

function currentRegisterTokenFromLocation() {
  const search = readLocationQuery()
  return String(search.get('register_token') ?? '').trim()
}

export function storeRegisterToken(token) {
  if (typeof window === 'undefined') {
    return
  }
  const normalized = String(token ?? '').trim()
  if (!normalized) {
    return
  }
  window.sessionStorage.setItem(REGISTER_TOKEN_STORAGE_KEY, normalized)
}

export function getStoredRegisterToken() {
  if (typeof window === 'undefined') {
    return ''
  }
  return String(window.sessionStorage.getItem(REGISTER_TOKEN_STORAGE_KEY) ?? '').trim()
}

export function clearStoredRegisterToken() {
  if (typeof window === 'undefined') {
    return
  }
  window.sessionStorage.removeItem(REGISTER_TOKEN_STORAGE_KEY)
}

export function beginDiscordLogin(intent = 'login') {
  storeRegisterToken(currentRegisterTokenFromLocation() || getStoredRegisterToken())
  window.location.href = authUrl(`/api/auth/discord/start?intent=${encodeURIComponent(intent)}`)
}

export function beginSteamLogin(intent = 'login') {
  storeRegisterToken(currentRegisterTokenFromLocation() || getStoredRegisterToken())
  window.location.href = authUrl(`/api/auth/steam/start?intent=${encodeURIComponent(intent)}`)
}

export async function logoutHubSession() {
  await fetch(authUrl('/api/auth/logout'), {
    method: 'POST',
    credentials: 'include',
  })
}

export async function setPrimaryIdentity(provider, providerSubject) {
  return requestJson(`/api/auth/identities/${encodeURIComponent(provider)}/${encodeURIComponent(providerSubject)}/primary`, {
    method: 'POST',
  })
}

export async function unlinkIdentity(provider, providerSubject) {
  return requestJson(`/api/auth/identities/${encodeURIComponent(provider)}/${encodeURIComponent(providerSubject)}/unlink`, {
    method: 'POST',
  })
}

export async function getPlayerRegistrationStatus(token) {
  return requestJson(`/api/player-registration/status?token=${encodeURIComponent(token)}`)
}

export async function completePlayerRegistration(token) {
  return requestJson('/api/player-registration/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ token }),
  })
}

export function useHubSession() {
  const [state, setState] = useState({
    loading: true,
    authenticated: false,
    user: null,
    error: null,
  })
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function loadSession() {
      try {
        const payload = await requestJson('/api/auth/session')
        if (cancelled) return
        setState({
          loading: false,
          authenticated: Boolean(payload?.authenticated),
          user: payload?.user ?? null,
          error: null,
        })
      } catch (error) {
        if (cancelled) return
        setState({
          loading: false,
          authenticated: false,
          user: null,
          error: error instanceof Error ? error.message : 'Failed to load auth session.',
        })
      }
    }

    void loadSession()
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  return {
    ...state,
    reload() {
      setReloadToken((current) => current + 1)
    },
  }
}
