import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
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
  useHubSession,
} from '../data/auth'

export function AccountPage() {
  const location = useLocation()
  const session = useHubSession()
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

  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="Account"
        title="LOGIN AND IDENTITY LINKING"
        description="Use Discord OAuth and Steam OpenID for login. Extra Steam accounts can be attached to the same hub profile, and Steam linking can require Discord DM approval."
        aside={<PageTrail items={[{ label: 'Home', to: '/' }, { label: 'Account' }]} />}
      />

      {session.loading ? (
        <Widget title="Loading Session" className="span-two">
          <p>Checking your hub session and linked identities.</p>
        </Widget>
      ) : !session.authenticated ? (
        <section className="dashboard-grid">
          <Widget title="Sign In" className="span-two">
            <p>Start with either provider. After that, attach the second one from the same account page.</p>
            <div className="auth-action-row">
              <button type="button" className="nav-link" onClick={() => beginDiscordLogin('login')}>Continue With Discord</button>
              <button type="button" className="nav-link" onClick={() => beginSteamLogin('login')}>Continue With Steam</button>
            </div>
            {registrationState.message ? <p className="account-feedback">{registrationState.message}</p> : null}
            {statusMessage ? <p className="account-feedback">{statusMessage}</p> : null}
            {session.error ? <p>{session.error}</p> : null}
          </Widget>
        </section>
      ) : (
        <section className="dashboard-grid">
          <Widget title="Profile" className="span-two">
            <div className="account-summary-grid">
              {linkedSummary.map((item) => (
                <article key={item.label} className="account-summary-card">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </article>
              ))}
            </div>
            <div className="auth-action-row">
              <button type="button" className="nav-link" onClick={() => beginDiscordLogin('link')}>Link Discord</button>
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
            <p>Steam links created while signed in will send a Discord DM approval link when a Discord identity is already attached.</p>
            {registrationState.message ? <p className="account-feedback">{registrationState.message}</p> : null}
            {statusMessage ? <p className="account-feedback">{statusMessage}</p> : null}
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
        </section>
      )}
    </div>
  )
}
