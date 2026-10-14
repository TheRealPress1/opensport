import { useTeamSettings } from '../lib/TeamSettingsContext'
import { fmtDate, calendarTitle, todayInTimezone } from '../lib/utils'

export default function Stats({ events = [], goals = [], members = [], onSelectEvent }) {
  const settings = useTeamSettings()
  const today = todayInTimezone(settings.timezone)
  const games = events.filter(event => event.type === 'game').sort((a, b) => b.date.localeCompare(a.date))
  const played = games.filter(event => event.team_score != null && event.opponent_score != null)
  const wins = played.filter(event => event.team_score > event.opponent_score).length
  const draws = played.filter(event => event.team_score === event.opponent_score).length
  const losses = played.length - wins - draws
  const leaders = field => {
    const counts = new Map()
    for (const goal of goals) if (goal[field]) counts.set(goal[field], (counts.get(goal[field]) || 0) + 1)
    return [...counts].map(([id, count]) => ({ id, count, name: members.find(member => member.id === id)?.name || 'Former teammate' })).sort((a, b) => b.count - a.count).slice(0, 10)
  }
  return <div className="space-y-5">
    <h2 className="text-xl font-bold">Results</h2>
    <div className="grid grid-cols-3 gap-3">{[['Wins', wins], ['Draws', draws], ['Losses', losses]].map(([label, count]) => <div key={label} className="rounded-xl border bg-white p-4 text-center"><p className="text-2xl font-bold">{count}</p><p className="text-sm text-slate-500">{label}</p></div>)}</div>
    <div className="grid grid-cols-2 gap-3">{[[settings.soccer ? 'Goals for' : 'Score for', 'team_score'], [settings.soccer ? 'Goals against' : 'Score against', 'opponent_score']].map(([label, field]) => <div key={field} className="rounded-xl border bg-white p-4 text-center"><p className="text-2xl font-bold">{played.reduce((sum, event) => sum + event[field], 0)}</p><p className="text-sm text-slate-500">{label}</p></div>)}</div>
    <section className="rounded-xl border bg-white overflow-hidden"><h3 className="font-semibold p-4 border-b">Games ({games.length})</h3>{games.length === 0 && <p className="p-6 text-sm text-slate-500">No games scheduled yet.</p>}{games.map(event => <button key={event.id} onClick={() => onSelectEvent(event.id)} className="w-full px-4 py-4 flex justify-between items-center gap-4 text-left border-b last:border-0 hover:bg-slate-50"><span><span className="font-medium block">{calendarTitle(event)}</span><span className="text-xs text-slate-500">{fmtDate(event.date)}</span></span><span className="font-bold text-sm">{event.team_score != null && event.opponent_score != null ? `${event.team_score} – ${event.opponent_score}` : event.date < today ? 'No result' : 'Upcoming'}</span></button>)}</section>
    {settings.soccer && <div className="grid gap-4 sm:grid-cols-2">{[['Top Scorers', 'scorer_id'], ['Top Assists', 'assist_id']].map(([title, field]) => <section key={field} className="rounded-xl border bg-white p-4"><h3 className="font-semibold mb-3">{title}</h3>{leaders(field).length === 0 && <p className="text-sm text-slate-500">Nothing recorded yet.</p>}<ol className="space-y-2">{leaders(field).map(member => <li key={member.id} className="flex justify-between text-sm"><span>{member.name}</span><strong>{member.count}</strong></li>)}</ol></section>)}</div>}
  </div>
}
