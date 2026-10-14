import { useState } from 'react'
import { useTeamSettings } from '../lib/TeamSettingsContext'
import { fmtDate, fmtTime, todayInTimezone } from '../lib/utils'

export default function EventCard({
  event,
  rsvps = [],
  goals = [],
  myRsvp = null,
  members = [],
  isPast = false,
  isToday = false,
  isAdmin = false,
  onRsvp,
  onClick,
}) {
  const settings = useTeamSettings()
  // Days until event
  let daysLabel = null
  if (!isPast) {
    const now = new Date(todayInTimezone(settings.timezone) + 'T00:00:00')
    now.setHours(0, 0, 0, 0)
    const eventDate = new Date(event.date + 'T00:00:00')
    const diffMs = eventDate - now
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays === 0) daysLabel = null // TODAY badge handles this
    else if (diffDays === 1) daysLabel = 'Tomorrow'
    else daysLabel = `In ${diffDays} days`
  }

  // RSVP counts — exclude coaches
  const coachIds = new Set(members.filter(m => m.role === 'coach').map(m => m.id))
  const playerRsvps = rsvps.filter(r => !coachIds.has(r.member_id))
  const goingCount = playerRsvps.filter(r => r.status === 'going').length
  const maybeCount = playerRsvps.filter(r => r.status === 'maybe').length
  const cantCount = playerRsvps.filter(r => r.status === 'cant').length

  // Determine result display for games (show if score exists, even on same day)
  let resultDisplay = null
  if (settings.scores_enabled && event.type?.toLowerCase() === 'game' && event.team_score !== null && event.opponent_score !== null) {
    const teamScore = event.team_score
    const opponentScore = event.opponent_score
    let resultColor = 'text-amber-600' // draw
    if (teamScore > opponentScore) resultColor = 'text-green-600'
    else if (teamScore < opponentScore) resultColor = 'text-red-600'

    resultDisplay = (
      <div className={`text-2xl font-bold ${resultColor}`}>
        {teamScore} - {opponentScore}
      </div>
    )
  }

  // Title/Opponent display
  let titleDisplay = event.title
  if (event.type?.toLowerCase() === 'game' && event.opponent) {
    const prefix = event.home_away === 'away' ? '@' : 'vs'
    titleDisplay = `${prefix} ${event.opponent}`
  }

  // Members who haven't responded — exclude coaches
  const respondedIds = new Set(rsvps.map(r => r.member_id))
  const notResponded = !isPast ? members.filter(m => m.active !== false && !respondedIds.has(m.id) && m.role !== 'coach') : []

  const [shownName, setShownName] = useState(null)

  const handleAvatarTap = (name) => {
    setShownName(name)
    setTimeout(() => setShownName(null), 3000)
  }

  // Get member names for goal display
  const goalScorerNames = goals.map(g => {
    const member = members.find(m => m.id === g.scorer_id)
    return member?.name || 'Unknown'
  })

  return (
    <div
      onClick={onClick}
      role="button" tabIndex={0}
      aria-label={`View ${event.title}`}
      onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onClick() } }}
      className="bg-white border border-gray-100 rounded-xl shadow-sm hover:shadow-md transition-shadow cursor-pointer p-6 space-y-4"
    >
      {/* Top Row: Today badge and Score */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {isToday && (
            <span className="text-xs font-semibold px-2 py-1 rounded-md bg-blue-100 text-blue-700">
              TODAY
            </span>
          )}
        </div>

        {daysLabel && (
          <span className="text-xs font-medium text-gray-400">
            {daysLabel}
          </span>
        )}
      </div>

      {/* Title + Score */}
      <div className="flex items-center justify-between">
        <h3 className="min-w-0 break-words text-xl font-semibold text-gray-900">{titleDisplay}</h3>
        {resultDisplay && <div className="ml-3 shrink-0 whitespace-nowrap">{resultDisplay}</div>}
      </div>

      {/* Date, Time, Location */}
      <div className="space-y-2 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <span>{fmtDate(event.date)}</span>
          {event.time && (
            <>
              <span>•</span>
              <span>{fmtTime(event.time)}</span>
              {event.end_time && (
                <>
                  <span>-</span>
                  <span>{fmtTime(event.end_time)}</span>
                </>
              )}
            </>
          )}
        </div>

        {event.location && (
          <div className="flex items-center gap-2">
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(event.location)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-violet-600 hover:text-violet-800 underline underline-offset-2 flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {event.location}
            </a>
          </div>
        )}
      </div>

      {/* RSVP Section (Upcoming Events) */}
      {!isPast && (
        <div className="pt-4 border-t border-gray-100 relative z-10">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                onRsvp(event.id, 'going')
              }}
              className={`py-2 px-2 rounded-lg font-medium text-sm transition-colors text-center ${
                myRsvp?.status === 'going'
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Going ({goingCount})
            </button>
            <button
              type="button"
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                onRsvp(event.id, 'maybe')
              }}
              className={`py-2 px-2 rounded-lg font-medium text-sm transition-colors text-center ${
                myRsvp?.status === 'maybe'
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Maybe ({maybeCount})
            </button>
            <button
              type="button"
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                onRsvp(event.id, 'cant')
              }}
              className={`py-2 px-2 rounded-lg font-medium text-sm transition-colors text-center ${
                myRsvp?.status === 'cant'
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Can&apos;t ({cantCount})
            </button>
          </div>
        </div>
      )}

      {/* Not Responded Section (Upcoming Events) */}
      {!isPast && notResponded.length > 0 && (
        <div className="relative" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold text-gray-400 uppercase">
              Not responded ({notResponded.length})
            </span>
            {isAdmin && (() => {
              const phones = notResponded.filter(m => m.phone).map(m => m.phone.replace(/\D/g, ''))
              if (phones.length === 0) return null
              const url = phones.length === 1
                ? `https://wa.me/${phones[0]}?text=${encodeURIComponent('Hey! Please RSVP for ' + titleDisplay)}`
                : `https://wa.me/?text=${encodeURIComponent('Hey! Please RSVP for ' + titleDisplay)}`
              return (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-semibold text-green-600 hover:text-green-700 flex items-center gap-1"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  Share reminder
                </a>
              )
            })()}
          </div>
          <div className="flex flex-wrap gap-1">
            {notResponded.map(m => (
              <button type="button" aria-label={isAdmin && m.phone ? `Contact ${m.name}` : m.name}
                key={m.id}
                className="relative group"
                onClick={() => {
                  if (isAdmin && m.phone) {
                    window.open(`https://wa.me/${m.phone.replace(/\D/g, '')}?text=${encodeURIComponent('Hey! Please RSVP for ' + titleDisplay)}`, '_blank')
                  } else {
                    handleAvatarTap(m.name)
                  }
                }}
                onFocus={() => setShownName(m.name)}
                onBlur={() => setShownName(null)}
                onMouseEnter={() => setShownName(m.name)}
                onMouseLeave={() => setShownName(null)}
              >
                <div className={`w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-500 overflow-hidden ${isAdmin && m.phone ? 'cursor-pointer ring-1 ring-green-300' : 'cursor-pointer'}`}>
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt="" className="w-full h-full object-cover opacity-50" />
                  ) : (
                    m.name.charAt(0)
                  )}
                </div>
                {shownName === m.name && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 bg-gray-800 text-white text-[10px] font-medium rounded whitespace-nowrap z-20">
                    {m.name}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Goals Section (Past Events) */}
      {settings.soccer && isPast && goalScorerNames.length > 0 && (
        <div className="pt-4 border-t border-gray-100">
          <div className="flex flex-wrap gap-2">
            {goalScorerNames.map((name, idx) => (
              <span
                key={idx}
                className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-violet-100 text-violet-700"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Notes (optional) */}
      {event.notes && (
        <div className="pt-4 border-t border-gray-100">
          <p className="text-sm text-gray-600">{event.notes}</p>
        </div>
      )}


    </div>
  )
}
