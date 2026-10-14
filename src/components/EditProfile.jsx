import { useState } from 'react'
import { POSITIONS } from '../lib/utils'
import { useTeamSettings } from '../lib/TeamSettingsContext'
import { useModal } from '../lib/useModal'

export default function EditProfile({ myInfo, onSave, onLogout, onClose }) {
  const settings = useTeamSettings()
  const modalRef = useModal(onClose)
  const [name, setName] = useState(myInfo?.name || '')
  const [jerseyNumber, setJerseyNumber] = useState(myInfo?.jersey_number?.toString() || '')
  const [position, setPosition] = useState(myInfo?.position || '')
  const [phone, setPhone] = useState(myInfo?.phone || '')
  const [avatarFile, setAvatarFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async event => {
    event.preventDefault(); setSaving(true); setError('')
    try { await onSave({ name, jerseyNumber, position, phone, avatarFile }); onClose() }
    catch (cause) { setError(cause.message) }
    finally { setSaving(false) }
  }
  const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
  return <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
    <section ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="profile-title" className="bg-white rounded-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto p-6" onClick={event => event.stopPropagation()}>
      <div className="flex justify-between items-center"><h2 id="profile-title" className="text-xl font-bold">Edit profile</h2><button aria-label="Close profile" onClick={onClose} className="p-2">✕</button></div>
      {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
      <form onSubmit={submit} className="space-y-4 mt-5">
        <label className="block text-sm font-medium">Name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} className={inputClass} /></label>
        <label className="block text-sm font-medium">Jersey number (optional)<input type="number" min="0" max="999" value={jerseyNumber} onChange={event => setJerseyNumber(event.target.value)} className={inputClass} /></label>
        <label className="block text-sm font-medium">Position (optional){settings.soccer ? <select value={position} onChange={event => setPosition(event.target.value)} className={inputClass}><option value="">Unassigned</option>{POSITIONS.map(value => <option key={value}>{value}</option>)}</select> : <input value={position} onChange={event => setPosition(event.target.value)} maxLength={40} className={inputClass} />}</label>
        <label className="block text-sm font-medium">Phone (optional)<input type="tel" value={phone} onChange={event => setPhone(event.target.value)} className={inputClass} /><span className="block mt-1 text-xs text-slate-500">Visible only to you and team administrators.</span></label>
        <label className="block text-sm font-medium">Photo (optional)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setAvatarFile(event.target.files?.[0] || null)} className="mt-2 block w-full text-xs" /><span className="text-xs text-slate-500">JPEG, PNG, or WebP · up to 5 MB</span></label>
        <button disabled={saving || !name.trim()} className="w-full rounded-lg bg-violet-600 text-white py-3 font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className="w-full rounded-lg bg-red-50 text-red-700 py-3 font-semibold" onClick={async () => { try { await onLogout() } catch (cause) { setError(cause.message) } }}>Sign out</button>
      </form>
    </section>
  </div>
}
