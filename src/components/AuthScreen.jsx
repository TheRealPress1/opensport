import { useState } from 'react'
import { APP_BRAND } from '../lib/config'

export default function AuthScreen({ onLogin }) {
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
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">Email<input className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="block text-sm font-medium">Password<input className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button disabled={submitting} className="w-full rounded-lg bg-brand-600 text-white font-semibold py-3 disabled:opacity-50">{submitting ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <button className="text-sm text-brand-700 underline mt-4" onClick={() => setRecoveryHelp(true)}>Forgot password?</button>
      {recoveryHelp && <p role="status" className="mt-3 text-sm text-slate-600">Ask your team organizer for a password recovery link. The organizer can create one from Manage → Members. Hosts can also recover the owner account using the documented host command.</p>}
    </div>
  </main>
}
