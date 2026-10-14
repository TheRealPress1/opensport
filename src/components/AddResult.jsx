import { useState } from 'react'
import { useModal } from '../lib/useModal'
import { useTeamSettings } from '../lib/TeamSettingsContext'

export default function AddResult({ event, members, existingGoals, onSubmit, onClose }) {
  const ACTIVE_TEAM = useTeamSettings()
  const modalRef = useModal(onClose)
  const [error, setError] = useState('')
  const [teamScore, setTeamScore] = useState(event.team_score?.toString() || '')
  const [oppScore, setOppScore] = useState(event.opponent_score?.toString() || '')
  const [goals, setGoals] = useState(() => {
    if (existingGoals && existingGoals.length > 0) {
      return existingGoals.map((goal) => ({
        scorer: goal.scorer_id || '',
        assist: goal.assist_id || '',
        minute: goal.minute?.toString() || '',
      }))
    }

    return [{ scorer: '', assist: '', minute: '' }]
  })
  const [saving, setSaving] = useState(false)

  const handleAddGoal = () => setGoals([...goals, { scorer: '', assist: '', minute: '' }])
  const handleDeleteGoal = (index) => setGoals(goals.filter((_, i) => i !== index))
  const handleGoalChange = (index, field, value) => {
    const updated = [...goals]
    updated[index][field] = value
    setGoals(updated)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const validGoals = goals
      .filter((g) => g.scorer)
      .map((g) => ({
        scorer: g.scorer,
        assist: g.assist || null,
        minute: g.minute ? parseInt(g.minute) : null,
      }))

    setError('')
    try { await onSubmit(event.id, parseInt(teamScore), parseInt(oppScore), ACTIVE_TEAM.soccer ? validGoals : []) } catch (cause) { setError(cause.message) } finally { setSaving(false) }
  }

  const opponentName = event.opponent || event.title || 'Opponent'
  const inputClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-violet-500'

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div
          ref={modalRef} role="dialog" aria-modal="true" aria-label="Game result"
          className="bg-white rounded-2xl shadow-lg max-w-lg w-full max-h-[90vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-start justify-between p-6 border-b border-gray-100">
            <div>
              <p className="text-xs font-semibold uppercase text-violet-500">{ACTIVE_TEAM.soccer ? 'Match report' : 'Result'}</p>
              <h2 className="mt-1 text-2xl font-bold text-gray-900">Game Result</h2>
              <p className="text-sm text-gray-500">vs {opponentName}</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close result modal"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {error && <p role="alert" className="text-red-700">{error}</p>}
            <div className="rounded-xl bg-gray-50 p-4 border border-gray-100">
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{ACTIVE_TEAM.homeScoreLabel}</label>
                  <input
                    type="number"
                    min="0" max="9999"
                    aria-label="Team score" value={teamScore}
                    onChange={(e) => setTeamScore(e.target.value)}
                    className={`${inputClass} text-center text-3xl font-bold text-violet-600`}
                    required
                  />
                </div>
                <div className="pb-2 text-2xl font-semibold text-gray-300">-</div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{opponentName}</label>
                  <input
                    type="number"
                    min="0" max="9999"
                    aria-label="Opponent score" value={oppScore}
                    onChange={(e) => setOppScore(e.target.value)}
                    className={`${inputClass} text-center text-3xl font-bold`}
                    required
                  />
                </div>
              </div>
            </div>

            {ACTIVE_TEAM.soccer && <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-gray-700">Goal Scorers</label>
                <button
                  type="button"
                  onClick={handleAddGoal}
                  className="text-sm font-semibold text-violet-600 hover:text-violet-700"
                >
                  + Add Goal
                </button>
              </div>

              <div className="space-y-3">
                {goals.map((goal, index) => (
                  <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_64px_auto] sm:items-end">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Scorer</label>
                      <select
                        aria-label={`Scorer ${index + 1}`} value={goal.scorer}
                        onChange={(e) => handleGoalChange(index, 'scorer', e.target.value)}
                        className={inputClass}
                      >
                        <option value="">Select player</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Assist</label>
                      <select
                        aria-label={`Assist ${index + 1}`} value={goal.assist}
                        onChange={(e) => handleGoalChange(index, 'assist', e.target.value)}
                        className={inputClass}
                      >
                        <option value="">None</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Min.</label>
                      <input
                        type="number"
                        min="0"
                        max="120"
                        aria-label={`Minute ${index + 1}`} value={goal.minute}
                        onChange={(e) => handleGoalChange(index, 'minute', e.target.value)}
                        placeholder="90"
                        className={`${inputClass} text-center`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteGoal(index)}
                      className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Remove goal"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save Result'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
