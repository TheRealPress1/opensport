import { FORMATIONS } from './formations.js'

function day(offset, now) {
  const date = new Date(now)
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function createDemoData(now = new Date()) {
  const positions = ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CM', 'LW', 'ST', 'RW', 'CM', 'ST', 'CB']
  const names = ['Alex Rivera', 'Jordan Chen', 'Morgan Kelly', 'Sam Taylor', 'Casey Brooks', 'Riley Patel', 'Jamie Park', 'Avery Wilson', 'Charlie Reed', 'Drew Morgan', 'Quinn Ellis', 'Taylor Lane', 'Skyler Cruz', 'Robin Lee']
  const members = names.map((name, i) => ({ id: `demo-member-${i}`, name, jersey_number: i + 1, position: positions[i], role: 'player', active: true, joined_at: `${day(-100, now)}T12:00:00Z`, avatar_url: null, avatar_emoji: '⚽' }))
  const events = [
    { id: 'demo-game', type: 'game', title: 'Union vs. Riverside', date: day(2, now), time: '15:00:00', end_time: '17:00:00', location: 'Community Field', opponent: 'Riverside FC', home_away: 'home', notes: 'Bring your home jersey and arrive 30 minutes early. The lineup is published!', team_score: null, opponent_score: null },
    { id: 'demo-practice', type: 'practice', title: 'Tuesday training', date: day(4, now), time: '18:30:00', end_time: '20:00:00', location: 'Community Field', notes: 'A little passing, a little finishing, and a game to close out the evening.', team_score: null, opponent_score: null },
    { id: 'demo-social', type: 'other', title: 'Team picnic', date: day(7, now), time: '12:00:00', end_time: '14:00:00', location: 'Riverside Park', notes: 'Bring something to share. Everyone is welcome.', team_score: null, opponent_score: null },
    { id: 'demo-result', type: 'game', title: 'Union vs. Oakwood', date: day(-5, now), time: '15:00:00', end_time: '17:00:00', location: 'Community Field', opponent: 'Oakwood Athletic', home_away: 'home', notes: 'A great afternoon together.', team_score: 3, opponent_score: 1 },
    { id: 'demo-draw', type: 'game', title: 'Union at Hillcrest', date: day(-12, now), time: '14:00:00', end_time: '16:00:00', location: 'Hillcrest Field', opponent: 'Hillcrest United', home_away: 'away', notes: '', team_score: 0, opponent_score: 0 },
  ]
  const rsvps = events.flatMap(event => members.slice(0, 12).map((member, i) => ({ id: `${event.id}-${member.id}`, event_id: event.id, member_id: member.id, status: i < 10 ? 'going' : i === 10 ? 'maybe' : 'cant' })))
  const goals = [
    { id: 'demo-goal-1', event_id: 'demo-result', scorer_id: members[9].id, assist_id: members[8].id, minute: 18 },
    { id: 'demo-goal-2', event_id: 'demo-result', scorer_id: members[8].id, assist_id: members[6].id, minute: 42 },
    { id: 'demo-goal-3', event_id: 'demo-result', scorer_id: members[9].id, assist_id: null, minute: 76 },
  ]
  const lineups = [{ id: 'demo-lineup', event_id: 'demo-game', name: 'Match day', formation: '4-3-3', status: 'published', slots: FORMATIONS['4-3-3'].positions.map((p, i) => ({ ...p, memberId: members[i].id })) }]
  return {
    settings: { id: 1, name: 'Union Sports Club', season: String(now.getFullYear()), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', sport_mode: 'soccer', scores_enabled: true, organizer_name: '', organizer_whatsapp: '' },
    members, events, rsvps, goals, lineups,
  }
}
