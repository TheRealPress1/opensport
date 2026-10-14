import { useState } from 'react'
import { useTeamSettings } from '../lib/TeamSettingsContext'
import { fmtTime, todayInTimezone } from '../lib/utils'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay()
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
}

function getWeeksForMonth(year, month) {
  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfWeek(year, month)
  const weeks = []
  let currentWeek = new Array(firstDay).fill(null)

  for (let day = 1; day <= daysInMonth; day++) {
    currentWeek.push(day)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null)
    weeks.push(currentWeek)
  }
  return weeks
}

export default function CalendarView({
  events = [],
  onSelectEvent,
}) {
  const settings = useTeamSettings()
  const now = new Date(todayInTimezone(settings.timezone) + 'T00:00:00')
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())
  const [mode, setMode] = useState('month') // 'month' | 'week'
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => {
    const d = new Date(now)
    d.setDate(d.getDate() - d.getDay())
    d.setHours(0, 0, 0, 0)
    return d
  })

  const monthName = new Date(viewYear, viewMonth).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const goToPrev = () => {
    if (mode === 'month') {
      if (viewMonth === 0) {
        setViewMonth(11)
        setViewYear(viewYear - 1)
      } else {
        setViewMonth(viewMonth - 1)
      }
    } else {
      const prev = new Date(selectedWeekStart)
      prev.setDate(prev.getDate() - 7)
      setSelectedWeekStart(prev)
      setViewMonth(prev.getMonth())
      setViewYear(prev.getFullYear())
    }
  }

  const goToNext = () => {
    if (mode === 'month') {
      if (viewMonth === 11) {
        setViewMonth(0)
        setViewYear(viewYear + 1)
      } else {
        setViewMonth(viewMonth + 1)
      }
    } else {
      const next = new Date(selectedWeekStart)
      next.setDate(next.getDate() + 7)
      setSelectedWeekStart(next)
      setViewMonth(next.getMonth())
      setViewYear(next.getFullYear())
    }
  }

  // Build event map: 'YYYY-MM-DD' -> events[]
  const eventsByDate = {}
  events.forEach(ev => {
    if (!eventsByDate[ev.date]) eventsByDate[ev.date] = []
    eventsByDate[ev.date].push(ev)
  })

  const getEventsForDay = (year, month, day) => {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return eventsByDate[key] || []
  }

  const getEventTitle = (ev) => {
    if (ev.type?.toLowerCase() === 'game' && ev.opponent) {
      const prefix = ev.home_away === 'home' ? 'vs' : '@'
      return `${prefix} ${ev.opponent}`
    }
    return ev.title
  }

  // Week mode helpers
  const getWeekDays = () => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(selectedWeekStart)
      d.setDate(d.getDate() + i)
      return d
    })
  }

  const weekLabel = () => {
    if (mode !== 'week') return ''
    const days = getWeekDays()
    const first = days[0]
    const last = days[6]
    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `${fmt(first)} – ${fmt(last)}, ${last.getFullYear()}`
  }

  const weeks = getWeeksForMonth(viewYear, viewMonth)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (
    <div className="w-full">
      {/* Header */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={goToPrev}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
              aria-label="Previous"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h3 className="text-base font-semibold text-gray-900 text-center">
              {mode === 'month' ? monthName : weekLabel()}
            </h3>
            <button
              onClick={goToNext}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
              aria-label="Next"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setMode('week')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                mode === 'week' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setMode('month')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                mode === 'month' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Month
            </button>
          </div>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(day => (
          <div key={day} className="text-center text-xs font-medium text-gray-500 py-2">
            {day}
          </div>
        ))}
      </div>

      {/* Month View */}
      {mode === 'month' && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          {weeks.map((week, wi) => (
            <div key={wi} className={`grid grid-cols-7 ${wi > 0 ? 'border-t border-gray-200' : ''}`}>
              {week.map((day, di) => {
                if (!day) {
                  return <div key={di} className="min-h-[70px] bg-gray-50 border-r last:border-r-0 border-gray-200" />
                }

                const dayEvents = getEventsForDay(viewYear, viewMonth, day)
                const dateObj = new Date(viewYear, viewMonth, day)
                const isCurrentDay = isSameDay(dateObj, today)

                return (
                  <div
                    key={di}
                    className={`min-h-[70px] p-1.5 border-r last:border-r-0 border-gray-200 ${
                      isCurrentDay ? 'bg-violet-50' : 'bg-white'
                    }`}
                  >
                    <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                      isCurrentDay ? 'bg-violet-600 text-white' : 'text-gray-700'
                    }`}>
                      {day}
                    </div>
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 3).map(ev => (
                        <button
                          key={ev.id}
                          onClick={() => onSelectEvent(ev.id)}
                          className={`w-full text-left px-1.5 py-0.5 rounded text-[11px] font-medium truncate block ${
                            ev.type?.toLowerCase() === 'game' ? 'bg-violet-100 text-violet-700' :
                            ev.type?.toLowerCase() === 'practice' ? 'bg-cyan-100 text-cyan-700' :
                            'bg-amber-100 text-amber-700'
                          } hover:opacity-80 transition-opacity`}
                        >
                          {getEventTitle(ev)}
                        </button>
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="text-[10px] text-gray-500 pl-1">
                          +{dayEvents.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Week View */}
      {mode === 'week' && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-7">
            {getWeekDays().map((date, di) => {
              const dayEvents = getEventsForDay(date.getFullYear(), date.getMonth(), date.getDate())
              const isCurrentDay = isSameDay(date, today)

              return (
                <div
                  key={di}
                  className={`min-h-[200px] p-2 border-r last:border-r-0 border-gray-200 ${
                    isCurrentDay ? 'bg-violet-50' : 'bg-white'
                  }`}
                >
                  <div className="text-center mb-2">
                    <div className={`text-sm font-medium w-8 h-8 flex items-center justify-center rounded-full mx-auto ${
                      isCurrentDay ? 'bg-violet-600 text-white' : 'text-gray-700'
                    }`}>
                      {date.getDate()}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {date.toLocaleDateString('en-US', { month: 'short' })}
                    </div>
                  </div>
                  <div className="space-y-1">
                    {dayEvents.map(ev => (
                      <button
                        key={ev.id}
                        onClick={() => onSelectEvent(ev.id)}
                        className={`w-full text-left p-1.5 rounded-lg text-xs ${
                          ev.type?.toLowerCase() === 'game' ? 'bg-violet-100 text-violet-700' :
                          ev.type?.toLowerCase() === 'practice' ? 'bg-cyan-100 text-cyan-700' :
                          'bg-amber-100 text-amber-700'
                        } hover:opacity-80 transition-opacity`}
                      >
                        <div className="font-medium truncate">{getEventTitle(ev)}</div>
                        {ev.time && (
                          <div className="text-[10px] opacity-75 mt-0.5">{fmtTime(ev.time)}</div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 px-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-violet-500" />
          <span className="text-xs text-gray-500">Game</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" />
          <span className="text-xs text-gray-500">Practice</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span className="text-xs text-gray-500">Other</span>
        </div>
      </div>
    </div>
  )
}
