import { useState } from 'react';
import { useTeamSettings } from '../lib/TeamSettingsContext'
import LocationInput from './LocationInput';
import { useModal } from '../lib/useModal'

export default function AddEvent({ onSubmit, onClose }) {
  const ACTIVE_TEAM = useTeamSettings()
  const modalRef = useModal(onClose)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [type, setType] = useState('game');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [end_time, setEnd_time] = useState('');
  const [location, setLocation] = useState('');
  const [opponent, setOpponent] = useState('');
  const [home_away, setHome_away] = useState('home');
  const [notes, setNotes] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !date) {
      setError('Please fill in title and date');
      return;
    }

    const eventData = {
      type,
      title: title.trim(),
      date,
      time,
      end_time,
      location,
      opponent: type === 'game' ? opponent : undefined,
      home_away: type === 'game' ? home_away : undefined,
      notes,
    };

    setSaving(true); setError('')
    try { await onSubmit(eventData) } catch (cause) { setError(cause.message) } finally { setSaving(false) }
  };

  const eventTypes = [
    { value: 'game', label: 'Game', icon: null },
    { value: 'practice', label: 'Practice', icon: null },
    { value: 'other', label: 'Other', icon: null },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label="New event" className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">New Event</h2>
          <button aria-label="Close event form"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 transition text-xl"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && <p role="alert" className="text-red-700 bg-red-50 p-3 rounded-lg">{error}</p>}
          {/* Event Type Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Event Type
            </label>
            <div className="flex gap-3">
              {eventTypes.map((et) => (
                <label
                  key={et.value}
                  className={`flex-1 flex flex-col items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition ${
                    type === et.value
                      ? 'border-violet-500 bg-violet-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="type"
                    value={et.value}
                    checked={type === et.value}
                    onChange={(e) => setType(e.target.value)}
                    className="sr-only"
                  />
                  <span className="text-sm font-medium text-gray-900">
                    {et.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Title Input */}
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
              Title *
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Saturday game"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
            />
          </div>

          {/* Date Input */}
          <div>
            <label htmlFor="date" className="block text-sm font-medium text-gray-700 mb-1">
              Date *
            </label>
            <input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
            />
          </div>

          {/* Start & End Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="time" className="block text-sm font-medium text-gray-700 mb-1">
                Start Time
              </label>
              <input
                id="time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
              />
            </div>
            <div>
              <label htmlFor="end_time" className="block text-sm font-medium text-gray-700 mb-1">
                End Time
              </label>
              <input
                id="end_time"
                type="time"
                value={end_time}
                onChange={(e) => setEnd_time(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
              />
            </div>
          </div>

          {/* Location Input */}
          <div>
            <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">
              Location
            </label>
            <LocationInput
              value={location}
              onChange={setLocation}
              placeholder={`e.g., ${ACTIVE_TEAM.homeScoreLabel} Field`}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
            />
          </div>

          {/* Game-specific fields */}
          {type === 'game' && (
            <>
              <div>
                <label htmlFor="opponent" className="block text-sm font-medium text-gray-700 mb-1">
                  Opponent
                </label>
                <input
                  id="opponent"
                  type="text"
                  value={opponent}
                  onChange={(e) => setOpponent(e.target.value)}
                  placeholder="Opponent name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                />
              </div>

              <div>
                <label htmlFor="home_away" className="block text-sm font-medium text-gray-700 mb-1">
                  Home / Away
                </label>
                <select
                  id="home_away"
                  value={home_away}
                  onChange={(e) => setHome_away(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                >
                  <option value="home">Home</option>
                  <option value="away">Away</option>
                  <option value="neutral">Neutral</option>
                </select>
              </div>
            </>
          )}

          {/* Notes Textarea */}
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any additional information..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition resize-none"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-violet-600 text-white font-medium rounded-lg hover:bg-violet-700 transition"
            >
              {saving ? 'Creating…' : 'Create Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
