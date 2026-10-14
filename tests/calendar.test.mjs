import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarRange, googleCalendarUrl, outlookCalendarUrl, normalizeTime, rsvpParticipation, todayInTimezone, zonedEventInstant } from '../src/lib/utils.js'

test('calendar normalizes seconds and uses team timezone across DST', () => {
  assert.equal(normalizeTime('15:00'), '15:00:00')
  assert.equal(normalizeTime('15:00:25'), '15:00:25')
  assert.throws(() => normalizeTime('25:00'))
  assert.equal(zonedEventInstant('2026-01-15', '15:00:00', 'America/New_York').toISOString(), '2026-01-15T20:00:00.000Z')
  assert.equal(zonedEventInstant('2026-07-15', '15:00', 'America/New_York').toISOString(), '2026-07-15T19:00:00.000Z')
  assert.throws(() => zonedEventInstant('2026-03-08', '02:30', 'America/New_York'), /does not exist/)
  const event = { type: 'game', title: 'Match', opponent: 'Visitors', home_away: 'home', date: '2026-07-15', time: '15:00:00' }
  const range = calendarRange(event, 'America/New_York')
  assert.equal(range.end, '2026-07-15T20:00:00.000Z')
  assert.equal(new URL(googleCalendarUrl(event, 'America/New_York')).searchParams.get('dates'), '20260715T190000Z/20260715T200000Z')
  assert.equal(new URL(outlookCalendarUrl(event, 'America/New_York')).searchParams.get('startdt'), '2026-07-15T19:00:00.000Z')
})

test('date-only events have an exclusive next-day end across year boundaries', () => {
  assert.deepEqual(calendarRange({ date: '2026-12-31' }), { allDay: true, start: '2026-12-31', end: '2027-01-01' })
  assert.equal(todayInTimezone('America/New_York', new Date('2026-10-12T01:00:00Z')), '2026-10-11')
})

test('participation excludes future, pre-membership, and social events', () => {
  const member = { id: 'player', joined_at: '2026-10-02T12:00:00Z' }
  const events = [
    { id: 'old', type: 'game', date: '2026-10-01' },
    { id: 'one', type: 'game', date: '2026-10-03' },
    { id: 'two', type: 'practice', date: '2026-10-04' },
    { id: 'social', type: 'other', date: '2026-10-05' },
    { id: 'future', type: 'game', date: '2026-10-15' },
  ]
  const rsvps = [{ event_id: 'one', member_id: 'player', status: 'going' }, { event_id: 'two', member_id: 'player', status: 'cant' }, { event_id: 'future', member_id: 'player', status: 'going' }]
  assert.deepEqual(rsvpParticipation(member, events, rsvps, 'UTC', new Date('2026-10-12T12:00:00Z')), { going: 1, total: 2, percent: 50 })
  assert.equal(rsvpParticipation(member, [], [], 'UTC'), null)
})
