export function fmtDate(d) {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function fmtDateLong(d) {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export function fmtTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hr = parseInt(h)
  const ampm = hr >= 12 ? 'PM' : 'AM'
  const h12 = hr % 12 || 12
  return `${h12}:${m} ${ampm}`
}

export function todayInTimezone(timezone = 'UTC', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function isPast(date, timezone = 'UTC') {
  return date < todayInTimezone(timezone)
}

export function isToday(date, timezone = 'UTC') {
  return date === todayInTimezone(timezone)
}

export function normalizeTime(time) {
  if (!time) return null
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time)
  if (!match || +match[1] > 23 || +match[2] > 59 || +(match[3] || 0) > 59) throw new Error('Invalid event time')
  return `${match[1]}:${match[2]}:${match[3] || '00'}`
}

// Event dates/times are wall-clock values in the team's IANA timezone.
export function zonedEventInstant(date, time, timezone = 'UTC') {
  const normalized = normalizeTime(time) || '00:00:00'
  const wall = Date.parse(`${date}T${normalized}Z`)
  if (!Number.isFinite(wall)) throw new Error('Invalid event date')
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  let result = wall
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(result)).map(p => [p.type, p.value]))
    const projected = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`)
    const delta = wall - projected
    if (!delta) return new Date(result)
    result += delta
  }
  throw new Error('This event time does not exist in the team timezone because of daylight saving time. Choose another time.')
}

export function calendarRange(event, timezone = 'UTC') {
  if (!event.time) {
    const start = new Date(`${event.date}T00:00:00Z`)
    const end = new Date(start.getTime() + 86400000)
    return { allDay: true, start: event.date, end: end.toISOString().slice(0, 10) }
  }
  const start = zonedEventInstant(event.date, event.time, timezone)
  const end = event.end_time ? zonedEventInstant(event.date, event.end_time, timezone) : new Date(start.getTime() + 3600000)
  if (end <= start) throw new Error('End time must be after start time')
  return { allDay: false, start: start.toISOString(), end: end.toISOString() }
}

export function calendarTitle(event) {
  if (event.type?.toLowerCase() !== 'game' || !event.opponent) return event.title
  return `${event.home_away === 'away' ? '@' : 'vs'} ${event.opponent}`
}

export function googleCalendarUrl(event, timezone = 'UTC') {
  const range = calendarRange(event, timezone)
  const compact = value => value.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const params = new URLSearchParams({ action: 'TEMPLATE', text: calendarTitle(event), dates: `${compact(range.start)}/${compact(range.end)}`, ctz: timezone, location: event.location || '', details: event.notes || '' })
  return `https://calendar.google.com/calendar/render?${params}`
}

export function outlookCalendarUrl(event, timezone = 'UTC') {
  const range = calendarRange(event, timezone)
  const params = new URLSearchParams({ rru: 'addevent', subject: calendarTitle(event), startdt: range.start, enddt: range.end, allday: String(range.allDay), location: event.location || '', body: event.notes || '', path: '/calendar/action/compose' })
  return `https://outlook.live.com/calendar/0/action/compose?${params}`
}

export function openGoogleCalendar(event, timezone) {
  window.open(googleCalendarUrl(event, timezone), '_blank', 'noopener,noreferrer')
}

export function openOutlookCalendar(event, timezone) {
  window.open(outlookCalendarUrl(event, timezone), '_blank', 'noopener,noreferrer')
}

export const EMOJIS = ['⚽', '🏆', '🥅', '🦁', '💪', '🔥', '⭐', '🎯', '👑', '🐉', '🦅', '🐺', '🦈', '🎖️', '💎']
export const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST', 'CF', 'LM', 'RM']

export function rsvpParticipation(member, events, rsvps, timezone = 'UTC', now = new Date()) {
  const today = todayInTimezone(timezone, now)
  const joined = member.joined_at ? todayInTimezone(timezone, new Date(member.joined_at)) : '0000-01-01'
  const eligible = events.filter(event => ['game', 'practice'].includes(event.type) && event.date < today && event.date >= joined)
  if (!eligible.length) return null
  const ids = new Set(eligible.map(event => event.id))
  const going = new Set(rsvps.filter(rsvp => rsvp.member_id === member.id && rsvp.status === 'going' && ids.has(rsvp.event_id)).map(rsvp => rsvp.event_id)).size
  return { going, total: eligible.length, percent: Math.round(going * 100 / eligible.length) }
}
