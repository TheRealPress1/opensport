import { useEffect, useRef, useState } from 'react'
import { APP_BRAND } from '../lib/config'
import { desktop, isDesktopApp, validateServerUrl } from '../lib/desktop'
import './DesktopSetup.css'

const STEPS = ['Host on this Mac', 'Make it your team', 'Create your account']
const detectedTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const timezoneOptions = () => [...new Set(['UTC', detectedTimezone(), ...(Intl.supportedValuesOf?.('timeZone') || [])])].sort()

export default function DesktopSetup() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState(0)
  const [team, setTeam] = useState({ name: '', timezone: detectedTimezone(), sport_mode: 'general' })
  const [owner, setOwner] = useState({ name: '', email: '', password: '' })
  const [serverUrl, setServerUrl] = useState('')
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [restoreConfirm, setRestoreConfirm] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [recovery, setRecovery] = useState(null)
  const [zones] = useState(timezoneOptions)
  const heading = useRef(null)
  const errorRegion = useRef(null)
  const actionInProgress = useRef(false)
  const hydrated = useRef(false)
  const statusGeneration = useRef(0)
  const native = isDesktopApp()

  useEffect(() => {
    let active = true
    const refresh = async () => {
      if (!native) { if (active) setLoading(false); return }
      const generation = statusGeneration.current
      try {
        const next = await desktop.getStatus()
        if (active && generation === statusGeneration.current) {
          setStatus(next); setLoading(false)
          if (!hydrated.current && next.setupPending && next.compatibility?.supported !== false) {
            setTeam(value => ({ ...value, ...next.team }))
            setOwner(value => ({ ...value, name: next.pendingOwner?.name || '', email: next.pendingOwner?.email || '' }))
            setStep(2)
            setNotice('A previous setup needs to be finished. Use the administrator account details you chose to continue.')
          }
          hydrated.current = true
        }
      } catch (cause) {
        if (active && generation === statusGeneration.current) { setError(cause.message); setLoading(false) }
      }
    }
    refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 1500)
    return () => { active = false; window.clearInterval(timer) }
  }, [native])

  useEffect(() => { if (error) errorRegion.current?.focus() }, [error])

  const advance = value => { setError(''); setStep(value); window.requestAnimationFrame(() => heading.current?.focus()) }
  const run = async (action, operation) => {
    if (actionInProgress.current) return
    actionInProgress.current = true
    ++statusGeneration.current
    setPending(action); setError(''); setNotice('')
    try { await operation() }
    catch (cause) { setError(cause.message) }
    finally { ++statusGeneration.current; actionInProgress.current = false; setPending('') }
  }
  const setup = event => {
    event.preventDefault()
    run('setup', async () => {
      const next = await desktop.setup({ team: { ...team, name: team.name.trim() }, owner: { ...owner, name: owner.name.trim(), email: owner.email.trim() } })
      setStatus(next)
      setOwner(value => ({ ...value, password: '' }))
      setShowPassword(false)
      setNotice('Your team is ready. Open it in your browser and sign in with the account you just created.')
    })
  }
  const restore = () => run('restore', async () => {
    const result = await desktop.restore()
    if (result?.cancelled) return
    setStatus(result?.status || await desktop.getStatus())
    setRestoreConfirm(false)
    setOwner(value => ({ ...value, password: '' }))
    setNotice('Backup restored. Use an account from that backup to sign in.')
  })
  const backup = () => run('backup', async () => {
    const result = await desktop.backup()
    if (result?.cancelled) return
    setNotice(result?.path ? `Backup saved to ${result.path}` : 'Your backup was saved.')
    setStatus(await desktop.getStatus())
  })
  const connect = event => {
    event.preventDefault()
    run('connect', async () => {
      await desktop.openExternal(validateServerUrl(serverUrl))
      setNotice('Your team address was opened in your default browser. Sign in there with your team account.')
    })
  }
  const openTeam = url => run('open', () => desktop.openExternal(url))
  const recoverOwner = event => {
    event.preventDefault()
    run('recovery', async () => {
      setRecovery(null)
      setRecovery(await desktop.recoverOwner(recoveryEmail.trim()))
    })
  }
  const busy = Boolean(pending || status?.busy)
  const canHost = native && status?.canHost !== false
  const compatible = status?.compatibility?.supported !== false
  const canStart = canHost && compatible
  const configured = Boolean(status?.configured)

  return (
    <div className="desktop-setup">
      <a className="desktop-skip" href="#desktop-main">Skip to setup</a>
      <header className="desktop-topbar">
        <div className="desktop-brand"><SportMark /><span>{APP_BRAND.name}</span><small>FOR MAC</small></div>
        <span className="desktop-topnote">Your team. Your community.</span>
      </header>
      <div className="desktop-layout">
        <aside className="desktop-sidebar" aria-label="Setup progress">
          <span className="desktop-eyebrow">A HOME FOR YOUR TEAM</span>
          <h2>Less organizing.<br /><em>More playing.</em></h2>
          <p>A shared schedule, a familiar roster, and a little more time for the game.</p>
          {configured ? <div className="desktop-sidebar-ready"><CheckIcon /><span>Your team is set up.<small>Manage its home from here.</small></span></div> : <ol className="desktop-steps">{STEPS.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={step > index ? 'is-complete' : ''}><span>{step > index ? <CheckIcon /> : `0${index + 1}`}</span><div>{label}<small>{['Keep your team on this Mac', 'Name, sport, and timezone', 'Your first team administrator'][index]}</small></div></li>)}</ol>}
          <div className="desktop-sidebar-foot"><span aria-hidden="true">↗</span><p>Open source.<br /><strong>Built to bring people together.</strong></p></div>
        </aside>
        <main id="desktop-main" className="desktop-main" tabIndex={-1} aria-busy={busy || loading}>
          {error && <div className="desktop-message is-error" role="alert" tabIndex={-1} ref={errorRegion}><strong>That didn’t finish.</strong><p>{error}</p><button type="button" onClick={() => setError('')}>Dismiss</button></div>}
          {notice && <div className="desktop-message is-success" role="status">{notice}</div>}
          {loading ? <div className="desktop-loading" role="status"><span className="desktop-loading-dot" /><h1>Checking your team’s home…</h1><p>Looking for an existing OpenSport team on this Mac.</p></div> : <>
            {!native && <div className="desktop-message is-info"><strong>OpenSport for Mac is needed here.</strong><p>This setup screen manages the installed Mac app. No local server has been started in this browser.</p></div>}
            {!compatible && <section className="desktop-message is-error" role="alert" aria-labelledby="compatibility-heading"><h2 id="compatibility-heading">{status.compatibility.reason === 'legacy-preview' ? 'This older preview needs a reviewed migration' : 'Your saved server needs attention'}</h2><p>{status.compatibility.message}</p><p>This app will not reset, convert, or delete your team files. Hosting, account recovery, and new backups are unavailable for this installation.</p>{status.storagePath && <p>Saved data: <code>{status.storagePath}</code></p>}<button type="button" className="desktop-text-button" disabled={busy || !native} onClick={() => run('showDataFolder', () => desktop.showDataFolder())}>Show data folder in Finder</button></section>}
            {configured ? <>
              <div className="desktop-section-heading"><div><p className="desktop-eyebrow">YOUR TEAM’S HOME</p><h1 ref={heading} tabIndex={-1}>{status.teamName || status.team?.name || 'Your team'}</h1><p>Manage the host here. Run the team in your browser.</p></div><span className={`desktop-status ${status.running ? 'is-running' : ''}`}><i />{status.running ? 'Running on this Mac' : 'Stopped'}</span></div>
              <section className="desktop-host-card" aria-labelledby="host-heading">
                <div className="desktop-host-heading"><DeviceIcon /><div><h2 id="host-heading">Hosted on this Mac</h2><p>{status.running ? 'Your local team server is running.' : 'Start the team server to make it available.'}</p></div></div>
                <div className="desktop-url-row"><span>On this Mac</span><code>{status.localUrl || 'Available after starting'}</code></div>
                <div className="desktop-url-row"><span>For teammates</span>{status.sharedUrl ? <code>{status.sharedUrl}</code> : <strong className="desktop-local-only">Local only · sharing not configured</strong>}</div>
                <div className="desktop-actions"><button className="desktop-button is-primary" type="button" disabled={busy || !compatible || !status.running || !status.localUrl} onClick={() => openTeam(status.localUrl)}>{pending === 'open' ? 'Opening…' : 'Open team in browser'}<span aria-hidden="true">↗</span></button><button className="desktop-button is-secondary" type="button" disabled={busy || (!status.running && !canStart)} onClick={() => run(status.running ? 'stop' : 'start', async () => setStatus(await desktop[status.running ? 'stop' : 'start']()))}>{pending === 'start' ? 'Starting server…' : pending === 'stop' ? 'Stopping server…' : status.running ? 'Stop server' : 'Start server'}</button></div>
              </section>
              <div className="desktop-note"><InfoIcon /><div><strong>{status.sharedUrl ? 'Keep this Mac available.' : 'This is an experimental local hosting preview.'}</strong><p>{status.sharedUrl ? 'Teammates use the shared address above in their browsers. This Mac must stay awake and connected, with OpenSport running.' : 'Use fictional team data while release checks are completed. Internet sharing is not available yet.'} Closing this window keeps the server running. Quitting OpenSport, closing your Mac’s lid, or shutting it down interrupts access.</p></div></div>
              {status.hostReason && <p className="desktop-muted">{status.hostReason}</p>}
              <section className="desktop-backup-section" aria-labelledby="backup-heading"><div><p className="desktop-eyebrow">KEEP YOUR SEASON SAFE</p><h2 id="backup-heading">Team backups</h2><p>Save a copy somewhere separate from this Mac.</p></div><div className="desktop-backup-meta">{status.lastBackupAt && <p>Last backup: {formatDate(status.lastBackupAt)}</p>}{status.storagePath && <p>Team data: <code>{status.storagePath}</code></p>}</div><div className="desktop-actions"><button type="button" className="desktop-button is-secondary" disabled={busy || !compatible} onClick={backup}>{pending === 'backup' ? 'Saving backup…' : 'Save a backup'}<DownloadIcon /></button><button type="button" className="desktop-text-button" disabled={busy} onClick={() => setRestoreConfirm(value => !value)} aria-expanded={restoreConfirm}>Restore a backup</button></div></section>
              <details className="desktop-existing"><summary>Recover administrator access</summary><p>As this Mac’s host, you can restore an existing account’s administrator access and create a private password reset link.</p><form className="desktop-form desktop-connect-form" onSubmit={recoverOwner}><label>Account email address<input type="email" required autoComplete="email" value={recoveryEmail} disabled={busy} onChange={event => { setRecoveryEmail(event.target.value); setRecovery(null) }} /></label><button type="submit" className="desktop-button is-secondary" disabled={busy || !canStart}>{pending === 'recovery' ? 'Creating recovery link…' : 'Create recovery link'}</button></form>{recovery?.link && <div className="desktop-recovery"><p role="status">Your private recovery link is ready.</p><label>Private recovery link<input readOnly value={recovery.link} onFocus={event => event.target.select()} aria-describedby="desktop-recovery-help" /></label><p id="desktop-recovery-help">Keep this link private. Anyone with it can reset this account’s password. Select the link to copy it.</p>{(recovery.expiresAt || recovery.expires_at) && <p>Expires {formatDate(recovery.expiresAt || recovery.expires_at)}.</p>}<button type="button" className="desktop-button is-secondary" disabled={busy} onClick={() => openTeam(recovery.link)}>Open password reset<span aria-hidden="true">↗</span></button></div>}</details>
              <details className="desktop-existing"><summary>Open a team on another host</summary><p>Already have an OpenSport server? Open its HTTPS address in your browser.</p><ConnectForm serverUrl={serverUrl} setServerUrl={setServerUrl} onSubmit={connect} busy={busy} pending={pending} native={native} /></details>
            </> : <>
              <div className="desktop-section-heading"><div><p className="desktop-eyebrow">LET’S GET YOUR TEAM TOGETHER</p><h1 ref={heading} tabIndex={-1}>{STEPS[step]}</h1><p>{['Your team’s records live on this Mac.', 'A few details to make OpenSport feel like yours.', 'You’ll use this account to organize and invite your team.'][step]}</p></div><span className="desktop-step-count">{step + 1} / 3</span></div>
              {step === 0 && <>
                <section className="desktop-host-card desktop-host-intro" aria-labelledby="mac-home-heading">
                  <div className="desktop-host-heading"><DeviceIcon /><div><h2 id="mac-home-heading">Your Mac is your team’s home.</h2><p>OpenSport prepares the server and keeps your team’s records here. No server rental, Docker, or Terminal needed.</p></div></div>
                  <p className="desktop-host-availability">Keep this Mac awake with OpenSport running. Closing the window keeps it running; quitting the app, closing the lid, or shutting down interrupts access. Remote access will also need this Mac online.</p>
                </section>
                <div className="desktop-note"><InfoIcon /><div><strong>A local preview for testing.</strong><p>Use fictional team data while release checks are completed. This preview runs on this Mac only; internet sharing is not available yet.</p></div></div>
                {status?.hostReason && <p className="desktop-muted">{status.hostReason}</p>}
                <div className="desktop-actions"><button className="desktop-button is-primary" type="button" disabled={!canStart || busy} onClick={() => advance(1)}>Set up on this Mac<span aria-hidden="true">→</span></button></div>
                <details className="desktop-existing"><summary>Already have a team address?</summary><p>Open an existing OpenSport team in your browser using its HTTPS address.</p><ConnectForm serverUrl={serverUrl} setServerUrl={setServerUrl} onSubmit={connect} busy={busy} pending={pending} native={native} /></details>
              </>}
              {step === 1 && <form onSubmit={event => { event.preventDefault(); advance(2) }} className="desktop-form"><label>Team name<input name="team-name" required maxLength={120} autoComplete="organization" placeholder="e.g. Riverside Sports Club" value={team.name} onChange={event => setTeam(value => ({ ...value, name: event.target.value }))} /></label><label>Team timezone<select value={team.timezone} onChange={event => setTeam(value => ({ ...value, timezone: event.target.value }))}>{zones.map(zone => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}</select><small>Events and calendar links use this timezone.</small></label><fieldset className="desktop-sport-options"><legend>Which tools fit your team?</legend><label><input type="radio" name="sport-mode" checked={team.sport_mode === 'general'} onChange={() => setTeam(value => ({ ...value, sport_mode: 'general' }))} /><span><strong>Any sport</strong><small>Schedule, roster, RSVPs, and scores.</small></span></label><label><input type="radio" name="sport-mode" checked={team.sport_mode === 'soccer'} onChange={() => setTeam(value => ({ ...value, sport_mode: 'soccer' }))} /><span><strong>Soccer</strong><small>Also includes lineups, goals, and assists.</small></span></label></fieldset><div className="desktop-actions"><button className="desktop-button is-primary" type="submit" disabled={!team.name.trim()}>Continue<span aria-hidden="true">→</span></button><button className="desktop-text-button" type="button" onClick={() => advance(0)}>Back</button></div></form>}
              {step === 2 && <form onSubmit={setup} className="desktop-form"><div className="desktop-team-summary"><span className="desktop-team-monogram">{team.name.trim().charAt(0).toUpperCase() || 'O'}</span><span><strong>{team.name}</strong><small>{team.sport_mode === 'soccer' ? 'Soccer tools' : 'Any sport'} · {team.timezone.replaceAll('_', ' ')}</small></span></div><fieldset className="desktop-account-fields" disabled={busy}><label>Your name<input name="owner-name" required maxLength={100} autoComplete="name" value={owner.name} onChange={event => setOwner(value => ({ ...value, name: event.target.value }))} /></label><label>Email address<input name="owner-email" type="email" required maxLength={254} autoComplete="email" value={owner.email} onChange={event => setOwner(value => ({ ...value, email: event.target.value }))} /><small>Your sign-in address for this team.</small></label><label htmlFor="desktop-owner-password">Password</label><div className="desktop-password"><input id="desktop-owner-password" name="owner-password" type={showPassword ? 'text' : 'password'} required minLength={12} autoComplete="new-password" aria-describedby="desktop-password-help" value={owner.password} onChange={event => setOwner(value => ({ ...value, password: event.target.value }))} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? 'Hide' : 'Show'}</button></div><small id="desktop-password-help">At least 12 characters. Keep this password somewhere safe.</small></fieldset><div className="desktop-actions"><button className="desktop-button is-primary" type="submit" disabled={busy || !canStart || !owner.name.trim()}>{pending === 'setup' ? 'Creating your team…' : 'Create my team'}<span aria-hidden="true">→</span></button><button className="desktop-text-button" type="button" disabled={busy} onClick={() => advance(1)}>Back</button></div>{pending === 'setup' && <p className="desktop-muted" role="status">Preparing the local server and your administrator account. Keep this window open.</p>}</form>}
              <div className="desktop-welcome-restore"><span>Bringing an existing team?</span><button type="button" className="desktop-text-button" disabled={busy || !canStart} onClick={() => setRestoreConfirm(value => !value)} aria-expanded={restoreConfirm}>Restore from a backup</button></div>
            </>}
            {restoreConfirm && <section className="desktop-restore-confirm" aria-labelledby="restore-heading"><h2 id="restore-heading">{configured ? 'Restore on a new installation' : 'Restore your team'}</h2><p>{configured ? 'To protect your current team, restoring is available only before a team has been set up. You can move this team to a fresh OpenSport installation using a backup.' : 'Choose an OpenSport backup you created or received from an operator you trust. Accounts and team settings come from that backup.'}</p><div className="desktop-actions">{!configured && <button type="button" className="desktop-button is-secondary" disabled={busy || !compatible} onClick={restore}>{pending === 'restore' ? 'Restoring team…' : 'Choose a backup…'}</button>}<button type="button" className="desktop-text-button" disabled={busy} onClick={() => setRestoreConfirm(false)}>{configured ? 'Close' : 'Cancel'}</button></div></section>}
            {status?.phase && <p className="desktop-muted" role="status">{status.phase}{typeof status.progress === 'number' ? ` · ${Math.round(Math.max(0, Math.min(100, status.progress)))}%` : ''}</p>}
            <footer className="desktop-main-foot"><span>No terminal needed. Your team stays yours.</span><button type="button" className="desktop-text-button" disabled={busy || !native} onClick={() => run('refresh', async () => setStatus(await desktop.getStatus()))}>{pending === 'refresh' ? 'Checking…' : 'Refresh status'}</button></footer>
          </>}
        </main>
      </div>
    </div>
  )
}

function ConnectForm({ serverUrl, setServerUrl, onSubmit, busy, pending, native }) {
  return <form onSubmit={onSubmit} className="desktop-form desktop-connect-form"><label>Team address<input type="url" required inputMode="url" autoComplete="url" placeholder="https://team.example.org" value={serverUrl} onChange={event => setServerUrl(event.target.value)} disabled={busy} /><small>Use your team’s main HTTPS address, not an invitation link.</small></label><button className="desktop-button is-primary" type="submit" disabled={busy || !native}>{pending === 'connect' ? 'Opening team…' : 'Open existing team'}<span aria-hidden="true">↗</span></button></form>
}
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }
// OpenSport ball: a soccer panel and a basketball half joined by a stitched baseball seam.
function SportMark() { return <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="#1f7a45" /><path d="M43.8,5.51C20,18 46,44 22.08,59.25A29 29 0 0 0 43.8,5.51Z" fill="#c9562f" /><path d="M38.5 35C46 31 53 30 60.6 30.6M57.11,17.5C48.5 27 47 42 50.64,54.22" fill="none" stroke="#19392e" strokeWidth="2.6" strokeLinecap="round" /><path d="M18 21.2L25.42 26.59L22.58 35.31L13.42 35.31L10.58 26.59Z" fill="#f7f5ed" /><path d="M43.8,5.51C20,18 46,44 22.08,59.25" fill="none" stroke="#f7f5ed" strokeWidth="2.8" /><path d="M35.66 9.87L31.34 9.68M38.24 11.76L39.73 15.82M31.89 17.68L27.9 19.36M35.03 18.28L38.11 21.31M31.16 26.15L27.63 28.65M34.36 26.06L38.03 28.35M31.55 34.67L28.02 37.17M34.75 34.59L38.41 36.88M31.29 42.84L27.32 44.56M34.44 43.41L37.55 46.42M28.78 50.41L24.45 50.45M31.45 52.17L33.15 56.15" fill="none" stroke="#f7f5ed" strokeWidth="1.6" strokeLinecap="round" /><circle cx="32" cy="32" r="29" fill="none" stroke="#19392e" strokeWidth="3" /></svg> }
function DeviceIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="13" rx="2" /><path d="M8 21h8m-4-5v5M3 12h18" /></svg> }
function InfoIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 10v7m0-11v1" /></svg> }
function CheckIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg> }
function DownloadIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5" /></svg> }
