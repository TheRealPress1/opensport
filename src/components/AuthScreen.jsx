import { useState } from 'react'
import { APP_BRAND } from '../lib/config'
import { cloudRequest } from '../lib/cloud'

export default function AuthScreen({ onLogin, cloud = false, setupError = '' }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [recoveryHelp, setRecoveryHelp] = useState(false)
  const submit = async event => {
    event.preventDefault()
    setSubmitting(true); setError('')
    try { const result = await onLogin({ email, password }); if (result?.error) setError(result.error) }
    catch (cause) { setError(cause.message) }
    finally { setSubmitting(false) }
  }
  return <main className="min-h-screen bg-slate-50 flex items-center justify-center p-5">
    <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 p-7">
      <p className="text-sm font-bold text-brand-600">{APP_BRAND.name}</p>
      <h1 className="mt-2 font-display text-4xl font-bold leading-none">Your team, together</h1>
      <p className="text-sm text-slate-500 mt-2 mb-6">Sign in to your team's private workspace. New members join through an organizer's invitation.</p>
      {setupError && <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">OpenSport couldn’t check whether this team is set up: {setupError}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">Email<input className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="block text-sm font-medium">Password<input className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button disabled={submitting} className="w-full rounded-lg bg-brand-600 text-white font-semibold py-3 disabled:opacity-50">{submitting ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <button className="text-sm text-brand-700 underline mt-4" onClick={() => setRecoveryHelp(true)}>Forgot password?</button>
      {recoveryHelp && !cloud && <p role="status" className="mt-3 text-sm text-slate-600">Ask your team organizer for a password recovery link. The organizer can create one from Manage → Members. Hosts can also recover the owner account using the documented host command.</p>}
      {recoveryHelp && cloud && <OwnerRecovery />}
    </div>
  </main>
}

// Cloud installs have no host command: the setup code chosen while deploying
// restores the owner's access and opens a one-use password link.
function OwnerRecovery() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async event => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const { link } = await cloudRequest('/api/setup', { method: 'POST', body: { action: 'recover-owner', email: email.trim(), code } })
      window.location.assign(link)
    } catch (cause) { setError(cause.message); setBusy(false) }
  }
  return <div className="mt-3 space-y-3 text-sm text-slate-600">
    <p role="status">Ask your team organizer for a password recovery link. The organizer can create one from Manage → Members.</p>
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 p-4">
      <p className="font-semibold text-slate-800">Team owner? Use your setup code</p>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <label className="block font-medium text-slate-800">Email<input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label className="block font-medium text-slate-800">Setup code<input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type="password" autoComplete="off" required value={code} onChange={event => setCode(event.target.value)} /></label>
      <button disabled={busy} className="w-full rounded-lg border border-brand-600 py-2 font-semibold text-brand-700 disabled:opacity-50">{busy ? 'Checking…' : 'Recover access'}</button>
    </form>
  </div>
}
