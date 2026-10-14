import { useState } from 'react'
import { APP_BRAND } from '../lib/config'
import { cloudRequest } from '../lib/cloud'

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
const browserTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }
const timezones = () => { try { return Intl.supportedValuesOf('timeZone') } catch { return [] } }

// First run of a one-click cloud install: the owner proves it's theirs with the
// setup code chosen while deploying, then creates the team and their account.
export default function CloudSetup({ status, onRefresh, onCreated }) {
  const [form, setForm] = useState(() => ({ code: '', team_name: '', sport_mode: 'general', timezone: browserTimezone(), name: '', email: '', password: '' }))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const field = key => ({ value: form[key], onChange: event => setForm({ ...form, [key]: event.target.value }) })
  const submit = async event => {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      await cloudRequest('/api/setup', { method: 'POST', body: { ...form, email: form.email.trim() } })
      const result = await onCreated({ email: form.email.trim(), password: form.password })
      if (result?.error) throw new Error(result.error)
    } catch (cause) { setError(cause.message) }
    finally { setSaving(false) }
  }
  if (status?.setupCode && status.setupCode !== 'ok') return <Frame title="Add your setup code">
    <p className="text-sm text-slate-600">{status.setupCode === 'missing' ? 'This OpenSport doesn’t have a setup code yet.' : 'This OpenSport’s setup code is too short.'} In Vercel, open your project’s Settings, then Environment Variables, and set <code className="font-semibold">OPENSPORT_SETUP_CODE</code> to a private phrase of at least 12 characters. Redeploy the project, then check again.</p>
    <button onClick={onRefresh} className="mt-5 w-full rounded-lg bg-brand-600 py-3 font-semibold text-white">Check again</button>
  </Frame>
  if (status && !status.databaseReady) return <Frame title="Almost ready">
    <p className="text-sm text-slate-600">Your team’s database is still being prepared. In Vercel, open your project and redeploy it, then check again.</p>
    <button onClick={onRefresh} className="mt-5 w-full rounded-lg bg-brand-600 py-3 font-semibold text-white">Check again</button>
  </Frame>
  return <Frame title="Create your team">
    <p className="text-sm text-slate-500">This is your team’s private OpenSport. Create it and your administrator account; you’ll invite teammates next.</p>
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-sm font-medium">Setup code<input type="password" autoComplete="off" required className={inputClass} {...field('code')} /><span className="text-xs text-slate-500">The private code you chose when you deployed OpenSport.</span></label>
      <fieldset className="space-y-4 border-t border-slate-200 pt-4">
        <legend className="sr-only">Your team</legend>
        <label className="block text-sm font-medium">Team name<input required maxLength={100} className={inputClass} {...field('team_name')} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">Sport tools<select className={inputClass} {...field('sport_mode')}><option value="general">General team</option><option value="soccer">Soccer</option></select></label>
          <label className="block text-sm font-medium">Timezone<select className={inputClass} {...field('timezone')}>{[...new Set([form.timezone, ...timezones()])].map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></label>
        </div>
      </fieldset>
      <fieldset className="space-y-4 border-t border-slate-200 pt-4">
        <legend className="sr-only">Your administrator account</legend>
        <label className="block text-sm font-medium">Your name<input required maxLength={100} autoComplete="name" className={inputClass} {...field('name')} /></label>
        <label className="block text-sm font-medium">Email<input type="email" required autoComplete="username" className={inputClass} {...field('email')} /></label>
        <label className="block text-sm font-medium">Password<input type="password" required minLength={12} maxLength={72} autoComplete="new-password" className={inputClass} {...field('password')} /><span className="text-xs text-slate-500">At least 12 characters</span></label>
      </fieldset>
      <button disabled={saving} className="w-full rounded-lg bg-brand-600 py-3 font-semibold text-white disabled:opacity-50">{saving ? 'Creating your team…' : 'Create team'}</button>
    </form>
  </Frame>
}

function Frame({ title, children }) {
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7">
      <p className="text-sm font-bold text-brand-600">{APP_BRAND.name}</p>
      <h1 className="mt-2 font-display text-4xl font-bold leading-none">{title}</h1>
      <div className="mt-3">{children}</div>
    </div>
  </main>
}
