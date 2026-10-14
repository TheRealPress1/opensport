import { useState } from 'react'
import { useTeamSettings } from '../lib/TeamSettingsContext'
import { rsvpParticipation } from '../lib/utils'
import { useModal } from '../lib/useModal'

export default function Roster({ members = [], me, isAdmin = false, onPromote, onRemove, templateLineups = [], onCreateLineup, onEditLineup, rsvps = [], events = [] }) {
  const settings = useTeamSettings()
  const [sort, setSort] = useState('name')
  const [selected, setSelected] = useState(null)
  const participation = member => rsvpParticipation(member, events, rsvps, settings.timezone)
  const roster = members.filter(member => member.active !== false).sort((a, b) => sort === 'availability' ? (participation(b)?.percent ?? -1) - (participation(a)?.percent ?? -1) : sort === 'position' ? (a.position || 'zzz').localeCompare(b.position || 'zzz') || a.name.localeCompare(b.name) : a.name.localeCompare(b.name))
  return <div className="space-y-5">
    <section className="bg-white rounded-xl border overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between gap-3"><h2 className="font-display text-[34px] font-bold leading-none">Roster <span className="font-sans text-sm font-semibold text-slate-500">{roster.length}</span></h2><label className="text-xs text-slate-500">Sort<select aria-label="Sort roster" className="ml-2 border rounded-lg p-1 text-slate-800" value={sort} onChange={event => setSort(event.target.value)}><option value="name">Name</option><option value="availability">Going rate</option><option value="position">Position</option></select></label></div>
      <p className="text-xs text-slate-500 px-4 py-3 bg-slate-50">RSVP participation shows Going RSVPs for past games and practices since joining. It does not measure attendance.</p>
      {roster.length === 0 && <p className="p-6 text-sm text-slate-500">No team members yet.</p>}
      {roster.map(member => { const rate = participation(member); return <button key={member.id} onClick={() => setSelected(member)} className="w-full p-4 border-t flex items-center justify-between text-left gap-3 hover:bg-slate-50"><span className="flex items-center gap-3"><span className="w-10 h-10 flex items-center justify-center rounded-full bg-brand-100 text-brand-700 font-bold overflow-hidden">{member.avatar_url ? <img className="w-full h-full object-cover" src={member.avatar_url} alt="" /> : member.name?.charAt(0)}</span><span><span className="block font-semibold">{member.name}{member.id === me && ' (you)'}</span><span className="text-xs text-slate-500">{member.role !== 'player' ? member.role : ''}{member.jersey_number != null ? ` #${member.jersey_number}` : ''}{member.position ? ` · ${member.position}` : ''}</span></span></span>{rate && <span title={`${rate.going} of ${rate.total} past events`} className="text-xs font-semibold bg-brand-50 text-brand-700 rounded-lg px-2 py-1">{rate.percent}% going</span>}</button> })}
    </section>
    {settings.soccer && isAdmin && <section className="bg-white rounded-xl border p-4"><div className="flex items-center justify-between"><h2 className="font-bold">Saved lineups</h2><button className="text-sm font-semibold text-brand-700" onClick={onCreateLineup}>+ Lineup</button></div>{templateLineups.length === 0 && <p className="text-sm text-slate-500 mt-3">No saved lineups yet.</p>}{templateLineups.map(lineup => <button key={lineup.id} className="w-full py-3 flex justify-between text-left border-t mt-3" onClick={() => onEditLineup(lineup)}><span>{lineup.name || 'Untitled'}<span className="block text-xs text-slate-500">{lineup.formation} · {lineup.slots?.filter(slot => slot.memberId).length || 0} players</span></span><span className="text-xs text-slate-500">{lineup.status}</span></button>)}</section>}
    {selected && <MemberDetail member={selected} me={me} isAdmin={isAdmin} rate={participation(selected)} onPromote={onPromote} onRemove={onRemove} onClose={() => setSelected(null)} />}
  </div>
}

function MemberDetail({ member, me, isAdmin, rate, onPromote, onRemove, onClose }) {
  const ref = useModal(onClose)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const action = async callback => { setBusy(true); setError(''); try { await callback(member.id); onClose() } catch (cause) { setError(cause.message) } finally { setBusy(false) } }
  return <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}><section ref={ref} role="dialog" aria-modal="true" aria-label="Member profile" className="bg-white rounded-xl max-w-sm w-full p-6" onClick={event => event.stopPropagation()}><div className="flex justify-between gap-3"><h3 className="text-xl font-bold">{member.name}</h3><button onClick={onClose} aria-label="Close member profile">✕</button></div><p className="text-sm text-slate-500 mt-2">{member.role}{member.position ? ` · ${member.position}` : ''}</p>{member.jersey_number != null && <p className="mt-3 text-sm">Jersey #{member.jersey_number}</p>}{rate && <p className="mt-3 text-sm">RSVP participation: {rate.percent}% ({rate.going}/{rate.total})</p>}{(isAdmin || member.id === me) && member.phone && <p className="mt-3 text-sm">Phone: {member.phone}</p>}{isAdmin && member.phone && <a className="inline-block mt-3 text-brand-700 underline text-sm" href={`https://wa.me/${member.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">Contact on WhatsApp</a>}{error && <p role="alert" className="mt-3 text-red-700">{error}</p>}{isAdmin && member.id !== me && member.role === 'player' && <div className="space-y-2 mt-4"><button disabled={busy} onClick={() => action(onPromote)} className="w-full bg-brand-50 text-brand-700 rounded-lg py-2">Make admin</button><button disabled={busy} onClick={() => { if (window.confirm(`Deactivate ${member.name}'s team access?`)) action(onRemove) }} className="w-full bg-red-50 text-red-700 rounded-lg py-2">Deactivate member</button></div>}</section></div>
}
