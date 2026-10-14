import { useRef, useState } from 'react'
import { useTeam } from '../lib/useTeam'
import { supabase } from '../lib/supabase'
import { APP_BRAND } from '../lib/config'
import { cloudInstall, useCloudStatus } from '../lib/cloud'
import AuthScreen from './AuthScreen'
import CloudSetup from './CloudSetup'
import TeamWorkspace from './TeamWorkspace'

function readCallback() {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const mode = new URLSearchParams(window.location.search).get('auth')
  if (!['invite', 'recovery'].includes(mode)) return null
  return { mode, token: params.get('token_hash'), type: params.get('type'), invitationId: params.get('invitation_id') }
}

export default function LiveTeamApp() {
  const team = useTeam()
  const setup = useCloudStatus()
  const [callback, setCallback] = useState(readCallback)
  if (callback) return <AccessCallback callback={callback} onComplete={async () => { await team.reload(); setCallback(null) }} />
  if (!team.configured && cloudInstall) return <Status title="Connect your team’s database" detail="This OpenSport doesn’t have a database yet. In Vercel, open your project, choose Storage, and connect a Supabase database. Then redeploy the project." />
  if (!team.configured) return <Status title="Set up this team instance" detail="The backend connection is missing. Follow the self-hosting guide to configure this installation and create the first administrator." />
  if (team.loading || (!team.session && setup.loading)) return <Status title="Loading your team…" />
  if (!team.session && setup.status?.needsSetup) return <CloudSetup status={setup.status} onRefresh={setup.refresh} onCreated={async credentials => { const result = await team.login(credentials); if (!result?.error) setup.refresh(); return result }} />
  if (!team.session) return <AuthScreen onLogin={team.login} cloud={cloudInstall} ownerRecovery={setup.status?.ownerRecovery === true} setupError={setup.error} />
  if (team.schemaRequired) return <Status title="Schema upgrade required" detail="This instance uses the earlier team schema. Keep the existing live deployment running and prepare a reviewed migration with a backup. Do not apply the fresh-install schema to this database."><p role="alert" className="mt-3 text-red-700">{team.error}</p></Status>
  if (team.error && !team.myInfo) return <Status title="Your team could not load" detail={team.error}><button className="mt-4 underline text-brand-700" onClick={team.reload}>Try again</button></Status>
  if (!team.hasProfile) return <Status title={team.myInfo?.active === false ? 'Team access is inactive' : 'An invitation is needed'} detail="Ask your organizer for a current invitation or help restoring your membership."><button className="underline text-brand-700 mt-4" onClick={team.logout}>Sign out</button>{team.error && <p role="alert" className="text-red-700 mt-3">{team.error}</p>}</Status>
  return <TeamWorkspace team={team} />
}

function Status({ title, detail, children }) {
  return <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6"><div className="max-w-md rounded-xl border bg-white p-7"><p className="text-brand-700 font-bold">{APP_BRAND.name}</p><h1 className="text-2xl font-bold my-3">{title}</h1>{detail && <p className="text-slate-600">{detail}</p>}{children}</div></main>
}

function AccessCallback({ callback, onComplete }) {
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [password, setPassword] = useState('')
  const savedPassword = useRef('')
  const [name, setName] = useState('')
  const verify = async () => {
    setSaving(true); setError('')
    try {
      if (!supabase || !callback.token || !['invite', 'recovery'].includes(callback.type) || (callback.mode === 'invite' && !callback.invitationId)) throw new Error('This link is incomplete. Ask your organizer for a new link.')
      const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: callback.token, type: callback.type })
      if (verifyError) throw verifyError
      window.history.replaceState(null, '', window.location.pathname)
      setVerified(true)
    } catch (cause) { setError(cause.message) }
    finally { setSaving(false) }
  }
  const submit = async event => {
    event.preventDefault(); setSaving(true); setError('')
    try {
      if (password !== savedPassword.current) {
        const { error: passwordError } = await supabase.auth.updateUser({ password })
        if (passwordError) throw passwordError
        savedPassword.current = password
      }
      if (callback.mode === 'invite') {
        const { error: completionError } = await supabase.rpc('complete_invitation', { p_invitation_id: callback.invitationId, p_token_hash: callback.token, p_name: name.trim(), p_jersey_number: null, p_position: '', p_phone: null })
        if (completionError) throw completionError
      }
      await onComplete()
    } catch (cause) { setError(cause.message) }
    finally { setSaving(false) }
  }
  return <Status title={callback.mode === 'invite' ? 'Join your team' : 'Choose a new password'} detail="Your link is private. Do not share it with anyone.">
    {error && <p role="alert" className="my-4 text-red-700">{error}</p>}
    {!verified && <button disabled={saving} onClick={verify} className="w-full rounded-lg bg-brand-600 text-white font-semibold py-3 mt-5 disabled:opacity-50">{saving ? 'Checking link…' : 'Continue with this link'}</button>}
    {verified && <form className="space-y-4 mt-5" onSubmit={submit}>
      {callback.mode === 'invite' && <label className="block text-sm font-medium">Your name<input required value={name} onChange={event => setName(event.target.value)} className="w-full mt-1 border rounded-lg px-3 py-2" maxLength={100} /></label>}
      <label className="block text-sm font-medium">New password<input aria-label="New password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={event => setPassword(event.target.value)} className="w-full mt-1 border rounded-lg px-3 py-2" /><span className="text-xs text-slate-500">At least 12 characters</span></label>
      <button disabled={saving || (callback.mode === 'invite' && !name.trim())} className="w-full rounded-lg bg-brand-600 text-white py-3 font-semibold disabled:opacity-50">{saving ? 'Saving…' : callback.mode === 'invite' ? 'Join team' : 'Save password'}</button>
    </form>}
    {!verified && error && <a href="/" className="inline-block mt-4 underline">Back to sign in</a>}
  </Status>
}
