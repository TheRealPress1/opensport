import { useState } from 'react'
import { useModal } from '../lib/useModal'
import { DEFAULT_TEAM } from '../lib/config'

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
export default function AdminPanel({ team, onClose }) {
  const modalRef = useModal(onClose)
  const [settings, setSettings] = useState(() => Object.fromEntries(Object.keys(DEFAULT_TEAM).map(key => [key, team.settings[key] ?? DEFAULT_TEAM[key]])))
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async action => {
    setBusy(true); setError(''); setNotice(''); setLink('')
    try { await action() } catch (cause) { setError(cause.message) } finally { setBusy(false) }
  }
  const field = key => ({ value: settings[key], onChange: event => setSettings({ ...settings, [key]: event.target.value }) })
  const createInvite = event => {
    event.preventDefault()
    run(async () => { const result = await team.createInvite(email.trim(), name.trim()); setLink(result.link); setNotice('Invitation created. Share this private link directly with the invited person.'); setEmail(''); setName('') })
  }
  return <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
    <section ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="manage-title" className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6" onClick={event => event.stopPropagation()}>
      <div className="flex items-center justify-between"><h2 id="manage-title" className="text-xl font-bold">Manage your team</h2><button aria-label="Close team settings" onClick={onClose} className="p-2">✕</button></div>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-4 text-brand-800">{notice}</p>}
      {link && <div className="mt-3 p-3 bg-brand-50 rounded-lg"><label className="block text-sm font-semibold">Private, expiring link<input readOnly value={link} className={inputClass} onFocus={event => event.target.select()} /></label><button className="text-sm underline mt-2" onClick={() => navigator.clipboard.writeText(link).then(() => setNotice('Link copied.')).catch(() => setNotice('Select and copy the link above.'))}>Copy link</button></div>}
      <form className="mt-6 space-y-4" onSubmit={event => { event.preventDefault(); run(async () => { new Intl.DateTimeFormat('en', { timeZone: settings.timezone }); await team.updateSettings(settings); setNotice('Team settings saved.') }) }}>
        <h3 className="font-bold">Team settings</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Team name<input required maxLength={100} className={inputClass} {...field('name')} /></label>
          <label className="text-sm">Season label<input maxLength={40} className={inputClass} {...field('season')} /></label>
          <label className="text-sm">Timezone<input required placeholder="America/New_York" className={inputClass} {...field('timezone')} /></label>
          <label className="text-sm">Sport tools<select className={inputClass} {...field('sport_mode')}><option value="general">General team</option><option value="soccer">Soccer</option></select></label>
          <label className="text-sm">Organizer name (optional)<input maxLength={100} className={inputClass} {...field('organizer_name')} /></label>
          <label className="text-sm">Organizer WhatsApp (optional)<input type="tel" placeholder="Country code and number" className={inputClass} {...field('organizer_whatsapp')} /></label>
        </div>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={settings.scores_enabled} onChange={event => setSettings({ ...settings, scores_enabled: event.target.checked })} />Enable game scores and results</label>
        <button disabled={busy} className="rounded-lg px-4 py-2 bg-brand-600 text-white disabled:opacity-50">Save settings</button>
      </form>
      <form onSubmit={createInvite} className="border-t mt-6 pt-6 space-y-3">
        <h3 className="font-bold">Invite a teammate</h3><p className="text-sm text-slate-500">Invitations are for one email address. Share the generated link yourself.</p>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Email<input type="email" required value={email} onChange={event => setEmail(event.target.value)} className={inputClass} /></label><label className="text-sm">Name (optional)<input value={name} onChange={event => setName(event.target.value)} className={inputClass} /></label></div>
        <button disabled={busy} className="rounded-lg px-4 py-2 bg-brand-600 text-white disabled:opacity-50">Create invitation link</button>
      </form>
      <section className="border-t mt-6 pt-6"><h3 className="font-bold mb-3">Pending invitations</h3>
        {(team.invitations || []).filter(invite => !invite.accepted_at && !invite.revoked_at).map(invite => <div key={invite.id} className="py-3 border-b flex flex-wrap items-center gap-3 justify-between"><div className="text-sm"><p>{invite.email}</p><p className="text-xs text-slate-500">{new Date(invite.expires_at) < new Date() ? 'Expired' : 'Expires'} {new Date(invite.expires_at).toLocaleString()}</p></div><button disabled={busy} className="text-sm text-red-700 underline" onClick={() => run(async () => { await team.revokeInvite(invite.id); setNotice('Invitation revoked.') })}>Revoke</button></div>)}
        <p className="text-xs text-slate-500 mt-2">Create another invitation for the same address to replace an expired link.</p>
      </section>
      <section className="border-t mt-6 pt-6"><h3 className="font-bold mb-3">Members</h3>
        {team.members.filter(member => member.onboarding_completed_at).map(member => <div key={member.id} className="py-3 border-b space-y-2"><p className="font-medium text-sm">{member.name}{member.id === team.me ? ' (you)' : ''}{member.active === false ? ' · inactive' : ''}</p><div className="flex flex-wrap gap-3 items-center">
          <label className="text-xs">Role<select aria-label={`Role for ${member.name}`} value={member.role} disabled={busy || member.active === false} className="ml-2 border rounded-lg p-1" onChange={event => { const role = event.target.value; run(() => team.setMemberAccess(member.id, role, null)) }}><option value="player">Player</option><option value="coach">Coach</option><option value="admin">Admin</option></select></label>
          {member.active !== false && <button disabled={busy} className="text-xs text-brand-700 underline" onClick={() => run(async () => { const result = await team.createRecovery(member.id); setLink(result.link); setNotice(`Share this recovery link privately with ${member.name}.`) })}>Password recovery link</button>}
          <button disabled={busy} className="text-xs text-red-700 underline" onClick={() => { if (window.confirm(`${member.active === false ? 'Restore' : 'Deactivate'} access for ${member.name}?`)) run(() => team.setMemberAccess(member.id, null, member.active === false)) }}>{member.active === false ? 'Restore access' : 'Deactivate'}</button>
        </div></div>)}
      </section>
    </section>
  </div>
}
