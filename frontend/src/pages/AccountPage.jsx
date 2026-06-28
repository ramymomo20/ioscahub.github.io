import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { PageIntro, PageTrail, Widget } from '../components/ui'
import {
  beginDiscordLogin,
  beginSteamLogin,
  clearStoredRegisterToken,
  completePlayerRegistration,
  getPlayerRegistrationStatus,
  getStoredRegisterToken,
  logoutHubSession,
  setPrimaryIdentity,
  storeRegisterToken,
  unlinkIdentity,
  useHubAuthProviders,
  useHubSession,
} from '../data/auth'
import { listPlayers } from '../data/repository'

export function AccountPage() {
  const location = useLocation()
  const session = useHubSession()
  const providers = useHubAuthProviders()
  const [actionError, setActionError] = useState(null)
  const [busyIdentityKey, setBusyIdentityKey] = useState('')
  const [registrationState, setRegistrationState] = useState({
    loading: false,
    message: '',
    token: '',
  })
  const identities = session.user?.identities ?? []
  const discordIdentities = identities.filter((identity) => identity.provider === 'discord')
  const steamIdentities = identities.filter((identity) => identity.provider === 'steam')
  const primaryDiscord = discordIdentities.find((identity) => identity.is_primary) ?? discordIdentities[0] ?? null
  const primarySteam = steamIdentities.find((identity) => identity.is_primary) ?? steamIdentities[0] ?? null
  const linkedPlayer = resolveSessionPlayer(session.user)
  const linkedSummary = [
    { label: 'Discord Accounts', value: String(discordIdentities.length) },
    { label: 'Steam Accounts', value: String(steamIdentities.length) },
    { label: 'Primary Discord', value: primaryDiscord?.display_name ?? primaryDiscord?.provider_subject ?? 'Not linked' },
    { label: 'Primary Steam', value: primarySteam?.provider_subject ?? 'Not linked' },
  ]
  const search = new URLSearchParams(location.search)
  const queryRegisterToken = String(search.get('register_token') ?? '').trim()
  const statusMessage = (
    search.get('approved') === '1' ? 'Steam link approved from Discord DM.'
      : search.get('steam') === 'pending_dm' ? 'Check your Discord DMs to approve this Steam link.'
        : search.get('discord') === 'linked' ? 'Discord account linked.'
          : search.get('steam') === 'linked' ? 'Steam account linked.'
            : search.get('discord') === 'created' || search.get('steam') === 'created' ? 'Account created and signed in.'
              : search.get('discord') === 'logged_in' || search.get('steam') === 'logged_in' ? 'Signed in successfully.'
                : ''
  )

  useEffect(() => {
    if (queryRegisterToken) {
      storeRegisterToken(queryRegisterToken)
      setRegistrationState((current) => ({
        ...current,
        token: queryRegisterToken,
      }))
      return
    }

    const storedToken = getStoredRegisterToken()
    if (storedToken) {
      setRegistrationState((current) => ({
        ...current,
        token: storedToken,
      }))
    }
  }, [queryRegisterToken])

  useEffect(() => {
    const token = queryRegisterToken || getStoredRegisterToken()
    if (!token) {
      return
    }

    let cancelled = false

    async function syncRegistration() {
      setRegistrationState((current) => ({
        ...current,
        token,
        loading: true,
      }))

      try {
        const status = await getPlayerRegistrationStatus(token)
        if (cancelled) return

        let message = 'Finish linking Discord and Steam to complete player registration.'
        if (!status.valid) {
          message = 'This player registration link expired. Run /player_register again.'
          clearStoredRegisterToken()
        } else if (status.completed) {
          message = 'Your player account is already linked.'
          clearStoredRegisterToken()
        } else if (!session.authenticated) {
          message = 'Sign in with the Discord account that started registration, then link your Steam account.'
        } else if (!status.has_matching_discord) {
          message = 'This hub account is signed into the wrong Discord account for this registration link.'
        } else if (!status.has_steam_identity) {
          message = 'Link at least one Steam account to finish player registration.'
        } else if (status.ready_to_complete) {
          await completePlayerRegistration(token)
          if (cancelled) return
          clearStoredRegisterToken()
          session.reload()
          message = 'Player registration completed. Your Discord and Steam accounts are now linked to your player record.'
        }

        setRegistrationState({
          loading: false,
          message,
          token: getStoredRegisterToken(),
        })
      } catch (error) {
        if (cancelled) return
        setRegistrationState({
          loading: false,
          message: error instanceof Error ? error.message : 'Failed to process player registration.',
          token,
        })
      }
    }

    void syncRegistration()
    return () => {
      cancelled = true
    }
  }, [queryRegisterToken, session.authenticated])

  async function handlePrimary(identity) {
    const identityKey = `${identity.provider}:${identity.provider_subject}:primary`
    setBusyIdentityKey(identityKey)
    setActionError(null)
    try {
      await setPrimaryIdentity(identity.provider, identity.provider_subject)
      session.reload()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to update primary identity.')
    } finally {
      setBusyIdentityKey('')
    }
  }

  async function handleUnlink(identity) {
    if (typeof window !== 'undefined' && !window.confirm(`Unlink ${identity.provider} ${identity.display_name ?? identity.provider_subject}?`)) {
      return
    }
    const identityKey = `${identity.provider}:${identity.provider_subject}:unlink`
    setBusyIdentityKey(identityKey)
    setActionError(null)
    try {
      await unlinkIdentity(identity.provider, identity.provider_subject)
      session.reload()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to unlink identity.')
    } finally {
      setBusyIdentityKey('')
    }
  }

  const providerError = providers.error ? providers.error : (!providers.loading && !providers.discord.configured ? 'Discord OAuth is not configured on the API yet. Steam login still works, but Discord linking will stay unavailable until the server gets HUB_DISCORD_CLIENT_ID and HUB_DISCORD_CLIENT_SECRET.' : '')

  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="Account"
        title="LOGIN, LINK, AND CLAIM YOUR PLAYER PROFILE"
        description="Authenticate with Discord and Steam, merge smurf accounts into one verified hub identity, and map that identity back to your player record without typing Steam IDs manually."
        aside={<PageTrail items={[{ label: 'Home', to: '/' }, { label: 'Account' }]} />}
      />

      {session.loading ? (
        <Widget title="Loading Session" className="span-two">
          <p>Checking your hub session and linked identities.</p>
        </Widget>
      ) : !session.authenticated ? (
        <section className="dashboard-grid">
          <Widget title="Hub Login" className="span-two">
            <div className="account-login-stage">
              <div className="account-login-stage-copy">
                <span className="eyebrow">Verified Access</span>
                <h3>Sign in through your real accounts, then let the hub match you back to your player record.</h3>
                <p>Best flow: sign in with Discord first, then attach Steam. If Discord OAuth is offline, you can still sign in with Steam and return later to complete the bridge.</p>
                <div className="account-provider-pills">
                  <ProviderStatus label="Discord OAuth" configured={providers.discord.configured} />
                  <ProviderStatus label="Steam OpenID" configured={providers.steam.configured} />
                  {registrationState.token ? <span className="account-provider-pill account-provider-pill-live">Registration Link Detected</span> : null}
                </div>
              </div>
              <div className="account-login-modal">
                <span className="account-login-modal-glow" />
                <div className="account-login-modal-shell">
                  <span className="eyebrow">Choose Provider</span>
                  <button
                    type="button"
                    className="account-provider-button account-provider-button-discord"
                    disabled={!providers.discord.configured}
                    onClick={() => beginDiscordLogin('login')}
                  >
                    <DiscordLogo />
                    <span>
                      <strong>Continue With Discord</strong>
                      <small>{providers.discord.configured ? 'Recommended first step for verified linking.' : 'Currently unavailable on this API host.'}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="account-provider-button account-provider-button-steam"
                    disabled={!providers.steam.configured}
                    onClick={() => beginSteamLogin('login')}
                  >
                    <SteamLogo />
                    <span>
                      <strong>Continue With Steam</strong>
                      <small>Use Steam OpenID. The hub will normalize your Steam account into the league record format automatically.</small>
                    </span>
                  </button>
                  <p className="account-login-note">After you authenticate, this page will guide you through linking a second Steam account and finishing registration if a `/player_register` link brought you here.</p>
                </div>
              </div>
            </div>
            {registrationState.message ? <p className="account-feedback">{registrationState.message}</p> : null}
            {statusMessage ? <p className="account-feedback">{statusMessage}</p> : null}
            {providerError ? <p className="account-provider-warning">{providerError}</p> : null}
            {session.error ? <p>{session.error}</p> : null}
          </Widget>
        </section>
      ) : (
        <section className="dashboard-grid">
          <Widget title="Hub Identity" className="span-two">
            <div className="account-hero-card">
              <div className="account-hero-main">
                <span className="account-hero-avatar">{linkedPlayer?.portrait ?? initialsForUser(session.user?.display_name)}</span>
                <div className="account-hero-copy">
                  <span className="eyebrow">Authenticated</span>
                  <h3>{linkedPlayer?.name ?? session.user?.display_name ?? 'Hub User'}</h3>
                  <p>
                    {linkedPlayer
                      ? 'Your linked player profile was resolved from your authenticated identity.'
                      : 'Your hub account is active. Finish linking both providers and the player bridge will resolve automatically.'}
                  </p>
                  <div className="account-provider-pills">
                    <ProviderStatus label="Discord Linked" configured={discordIdentities.length > 0} />
                    <ProviderStatus label="Steam Linked" configured={steamIdentities.length > 0} />
                    {linkedPlayer ? <span className="account-provider-pill account-provider-pill-live">{formatRating(linkedPlayer.rating)} Rating</span> : null}
                  </div>
                </div>
              </div>
              <div className="account-hero-actions">
                {linkedPlayer ? (
                  <NavLink to={`/players/${linkedPlayer.id}`} className="account-hero-link">
                    View Player Profile
                  </NavLink>
                ) : null}
                <button type="button" className="nav-link" onClick={() => beginDiscordLogin('link')} disabled={!providers.discord.configured}>Link Discord</button>
                <button type="button" className="nav-link" onClick={() => beginSteamLogin('link')}>Link Steam / Smurf</button>
                <button
                  type="button"
                  className="nav-link"
                  onClick={async () => {
                    await logoutHubSession()
                    window.location.reload()
                  }}
                >
                  Sign Out
                </button>
              </div>
            </div>

            <div className="account-summary-grid">
              {linkedSummary.map((item) => (
                <article key={item.label} className="account-summary-card">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </article>
              ))}
            </div>

            {registrationState.message ? <p className="account-feedback">{registrationState.message}</p> : null}
            {statusMessage ? <p className="account-feedback">{statusMessage}</p> : null}
            {providerError ? <p className="account-provider-warning">{providerError}</p> : null}
            {actionError ? <p className="account-feedback">{actionError}</p> : null}
          </Widget>

          <Widget title="Linked Identities">
            <div className="account-identity-list">
              {identities.map((identity) => (
                <article key={`${identity.provider}-${identity.provider_subject}`} className="account-identity-card">
                  <div className="account-identity-meta">
                    <strong>{identity.provider.toUpperCase()}</strong>
                    <span>{identity.display_name ?? identity.provider_subject}</span>
                    <small>{identity.provider_subject}</small>
                  </div>
                  <div className="account-identity-actions">
                    <b>{identity.is_primary ? 'Primary' : 'Linked'}</b>
                    <button
                      type="button"
                      className="nav-link"
                      disabled={identity.is_primary || busyIdentityKey === `${identity.provider}:${identity.provider_subject}:primary`}
                      onClick={() => handlePrimary(identity)}
                    >
                      Make Primary
                    </button>
                    <button
                      type="button"
                      className="nav-link"
                      disabled={identities.length <= 1 || busyIdentityKey === `${identity.provider}:${identity.provider_subject}:unlink`}
                      onClick={() => handleUnlink(identity)}
                    >
                      Unlink
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </Widget>

          <Widget title="Do You Have A Second Steam Account?">
            <div className="account-secondary-card">
              <div>
                <span className="eyebrow">Smurf Linking</span>
                <h3>Link it here so all stats can roll into one verified hub identity.</h3>
                <p>Use this for secondary or smurf Steam accounts. The hub will keep a primary Steam account, preserve additional Steam IDs, and feed that linkage back into the operational player record.</p>
              </div>
              <button type="button" className="account-hero-link" onClick={() => beginSteamLogin('link')}>
                Link Another Steam Account
              </button>
            </div>
          </Widget>
        </section>
      )}
    </div>
  )
}

function ProviderStatus({ label, configured }) {
  return (
    <span className={`account-provider-pill${configured ? ' account-provider-pill-live' : ''}`}>
      {label}: {configured ? 'Ready' : 'Offline'}
    </span>
  )
}

function DiscordLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="account-provider-logo">
      <path fill="currentColor" d="M20.32 4.37A19.8 19.8 0 0 0 15.4 3c-.21.37-.45.86-.61 1.26a18.3 18.3 0 0 0-5.58 0A12.7 12.7 0 0 0 8.6 3a19.74 19.74 0 0 0-4.93 1.37C.56 9.05-.27 13.61.15 18.1a19.97 19.97 0 0 0 6.04 3.04c.49-.66.92-1.36 1.29-2.09-.71-.27-1.39-.6-2.03-.99.17-.12.33-.25.49-.38 3.92 1.84 8.17 1.84 12.04 0 .16.13.32.26.49.38-.65.39-1.33.72-2.04.99.37.73.8 1.43 1.3 2.09a19.9 19.9 0 0 0 6.03-3.04c.5-5.2-.85-9.72-3.43-13.73ZM8.68 15.36c-1.18 0-2.16-1.09-2.16-2.42 0-1.34.95-2.42 2.16-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.34-.96 2.42-2.16 2.42Zm6.64 0c-1.19 0-2.16-1.09-2.16-2.42 0-1.34.95-2.42 2.16-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Z" />
    </svg>
  )
}

function SteamLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="account-provider-logo">
      <path fill="currentColor" d="M11.84 1a10.84 10.84 0 0 0-1.57 21.57l-4.46-1.83a2.73 2.73 0 1 1 1.88-2.57v.09l4.47 1.84A10.84 10.84 0 1 0 11.84 1Zm0 3.25a7.58 7.58 0 0 1 7.55 7.59 7.58 7.58 0 0 1-7.55 7.58 7.6 7.6 0 0 1-3.46-.84l2.16.89a3.9 3.9 0 1 0 1.6-5.15l-4.1-1.69A7.58 7.58 0 0 1 11.84 4.25Zm1.77 5.32a2.28 2.28 0 1 1 0 4.56 2.28 2.28 0 0 1 0-4.56Z" />
    </svg>
  )
}

function resolveSessionPlayer(user) {
  if (!user) {
    return null
  }

  const primaryDiscordId = String(user.primary_discord_id ?? '').trim()
  const primarySteamLegacyId = String(user.primary_steam_legacy_id ?? '').trim()
  const players = listPlayers()

  return players.find((player) => (
    (primaryDiscordId && String(player.discordId ?? '').trim() === primaryDiscordId)
    || (primarySteamLegacyId && String(player.id ?? '').trim() === primarySteamLegacyId)
  )) ?? null
}

function formatRating(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric.toFixed(1) : '-'
}

function initialsForUser(value) {
  const text = String(value ?? '').trim()
  if (!text) {
    return '?'
  }

  return text
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
}
