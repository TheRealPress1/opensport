import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoData } from '../src/lib/demo.js'

test('demo dates stay useful across years and each visitor gets fresh state', () => {
  const a = createDemoData(new Date('2031-12-31T12:00:00'))
  const b = createDemoData(new Date('2031-12-31T12:00:00'))
  assert.equal(a.events[0].date, '2032-01-02')
  assert.equal(a.events.find(e => e.id === 'demo-draw').team_score, 0)
  a.rsvps[0].status = 'cant'
  assert.equal(b.rsvps[0].status, 'going')
  assert(a.lineups[0].slots.every(slot => a.members.some(member => member.id === slot.memberId)))
  assert(a.members.every(member => !member.email && !member.phone && !member.avatar_url))
})
