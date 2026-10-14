import { useState } from 'react'
import { createDemoData } from '../lib/demo'
import { DOWNLOAD_URL } from '../lib/project'
import TeamWorkspace from './TeamWorkspace'

export default function DemoTeamApp() {
  const [data, setData] = useState(createDemoData)
  const [resetKey, setResetKey] = useState(0)
  const me = data.members[0].id
  const team = {
    ...data, me, myInfo: data.members[0], isAdmin: false,
    loading: false, error: null, hasProfile: true, configured: true,
    session: { user: { id: 'demo-user' } },
    setRsvp: async (eventId, status) => setData(previous => ({
      ...previous,
      rsvps: [...previous.rsvps.filter(r => !(r.event_id === eventId && r.member_id === me)), { id: `${eventId}-${me}`, event_id: eventId, member_id: me, status }],
    })),
    getMemberName: id => data.members.find(m => m.id === id)?.name || 'Former member',
    getMemberAvatar: () => null,
    getMemberEmoji: () => '⚽',
    getEventRsvps: id => data.rsvps.filter(r => r.event_id === id),
    getMyRsvp: id => data.rsvps.find(r => r.event_id === id && r.member_id === me),
    getEventGoals: id => data.goals.filter(g => g.event_id === id),
    getEventLineup: id => data.lineups.find(l => l.event_id === id),
    getTemplateLineups: () => [],
    clearError: () => {},
  }
  const reset = () => { setData(createDemoData()); setResetKey(key => key + 1) }
  return (
    <>
      <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 text-xs">
          <div><a className="font-bold underline underline-offset-4" href="/">← OpenSport</a><p className="mt-1">Demo · fictional data · changes reset on refresh</p></div>
          <div className="flex flex-wrap items-center gap-4"><label className="font-semibold">Sport mode<select aria-label="Demo sport mode" className="ml-2 rounded border border-emerald-800 bg-white px-2 py-2" value={data.settings.sport_mode} onChange={event => setData(previous => ({ ...previous, settings: { ...previous.settings, sport_mode: event.target.value } }))}><option value="soccer">Soccer</option><option value="general">General</option></select></label><button onClick={reset} className="rounded border border-emerald-800 px-3 py-2 font-semibold">Reset demo</button><a className="font-semibold underline underline-offset-4" href={DOWNLOAD_URL} download>Host your team ↗</a></div>
        </div>
      </div>
      <TeamWorkspace key={resetKey} team={team} demo />
    </>
  )
}
