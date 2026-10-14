import { useState, useRef } from 'react'
import { FORMATIONS, FORMATION_KEYS } from '../lib/formations'
import { useModal } from '../lib/useModal'

export default function LineupBuilder({
  event = null,
  members = [],
  lineup = null,
  isAdmin = false,
  onSave,
  onDelete,
  onClose,
}) {
  const modalRef = useModal(onClose)
  const [error, setError] = useState('')
  const [formation, setFormation] = useState(lineup?.formation || '4-4-2')
  const [name, setName] = useState(lineup?.name || '')
  const [slots, setSlots] = useState(() => {
    if (lineup?.slots) return lineup.slots
    return FORMATIONS[formation].positions.map(p => ({
      label: p.label,
      x: p.x,
      y: p.y,
      memberId: null,
    }))
  })
  const [saving, setSaving] = useState(false)
  const [draggedMember, setDraggedMember] = useState(null)
  const [activeSlot, setActiveSlot] = useState(null) // for mobile tap-to-assign
  const fieldRef = useRef(null)
  const isTemplate = !event

  const assignedMemberIds = slots.filter(s => s.memberId).map(s => s.memberId)
  const availablePlayers = members.filter(m => m.active !== false && m.role !== 'coach' && !assignedMemberIds.includes(m.id))

  const handleFormationChange = (newFormation) => {
    const newPositions = FORMATIONS[newFormation].positions
    const newSlots = newPositions.map((p, i) => ({
      label: p.label,
      x: p.x,
      y: p.y,
      memberId: slots[i]?.memberId || null,
    }))
    setFormation(newFormation)
    setSlots(newSlots)
  }

  const handleDragStart = (memberId) => {
    setDraggedMember(memberId)
  }

  const handleDropOnSlot = (slotIndex) => {
    if (!draggedMember) return
    setSlots(prev => {
      const next = prev.map((s, i) => {
        // Remove member from any existing slot
        if (s.memberId === draggedMember) return { ...s, memberId: null }
        // Assign to target slot
        if (i === slotIndex) return { ...s, memberId: draggedMember }
        return s
      })
      return next
    })
    setDraggedMember(null)
  }

  const handleRemoveFromSlot = (slotIndex) => {
    setSlots(prev => prev.map((s, i) => i === slotIndex ? { ...s, memberId: null } : s))
    setActiveSlot(null)
  }

  // Mobile: tap a position to select it, then pick a player
  const handleSlotTap = (slotIndex) => {
    if (readOnly) return
    const slot = slots[slotIndex]
    if (slot.memberId) {
      // Already assigned — toggle remove mode
      setActiveSlot(activeSlot === slotIndex ? null : slotIndex)
    } else {
      // Empty — open player picker
      setActiveSlot(slotIndex)
    }
  }

  const handleMobileAssign = (memberId) => {
    if (activeSlot === null) return
    setSlots(prev => {
      const next = prev.map((s, i) => {
        if (s.memberId === memberId) return { ...s, memberId: null }
        if (i === activeSlot) return { ...s, memberId: memberId }
        return s
      })
      return next
    })
    setActiveSlot(null)
  }

  const handleSave = async (publishStatus) => {
    setSaving(true)
    setError('')
    try { await onSave({
      id: lineup?.id,
      event_id: event?.id || null,
      name: isTemplate ? name : null,
      formation,
      slots,
      status: publishStatus,
    }) } catch (cause) { setError(cause.message) } finally { setSaving(false) }
  }

  const getMember = (id) => members.find(m => m.id === id)

  // Title
  let eventTitle = ''
  if (event) {
    eventTitle = event.title
    if (event.type?.toLowerCase() === 'game' && event.opponent) {
      const prefix = event.home_away === 'away' ? '@' : 'vs'
      eventTitle = `${prefix} ${event.opponent}`
    }
  }

  const readOnly = !isAdmin

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div
          ref={modalRef} role="dialog" aria-modal="true" aria-label="Soccer lineup"
          className="bg-white rounded-2xl shadow-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          {error && <p role="alert" className="p-4 text-red-700 bg-red-50">{error}</p>}
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div className="flex-1 mr-4">
              {isTemplate && !readOnly ? (
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Lineup name (e.g. Main XI, B Team)"
                  className="text-xl font-bold text-gray-900 bg-transparent border-none outline-none w-full placeholder-gray-300"
                />
              ) : (
                <>
                  <h2 className="font-display text-[30px] font-bold leading-none text-gray-900">{isTemplate ? (name || 'Untitled Lineup') : 'Lineup'}</h2>
                  {eventTitle && <p className="text-sm text-gray-500 mt-0.5">{eventTitle}</p>}
                </>
              )}
              <p className="mt-1 text-sm font-semibold text-brand-700">{formation}</p>
            </div>
            <div className="flex items-center gap-3">
              {lineup?.status === 'published' && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-brand-100 text-brand-700">
                  Published
                </span>
              )}
              {lineup?.status === 'draft' && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                  Draft
                </span>
              )}
              <button aria-label="Close lineup" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex flex-col md:flex-row">
            {/* Left sidebar: Players & Formation (desktop) */}
            <div className="hidden md:block md:w-64 flex-shrink-0 md:border-r border-gray-100 p-4 space-y-4 md:max-h-[70vh] md:overflow-y-auto">
              {/* Formation picker */}
              {!readOnly && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Formation</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {FORMATION_KEYS.map(f => (
                      <button
                        key={f}
                        onClick={() => handleFormationChange(f)}
                        className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          formation === f
                            ? 'bg-brand-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {readOnly && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Formation</label>
                  <span className="text-lg font-bold text-gray-900">{formation}</span>
                </div>
              )}

              {/* Available Players */}
              {!readOnly && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">
                    Players ({availablePlayers.length})
                  </label>
                  <div className="space-y-1">
                    {availablePlayers.map(m => (
                      <div
                        key={m.id}
                        draggable
                        onDragStart={() => handleDragStart(m.id)}
                        onDragEnd={() => setDraggedMember(null)}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-gray-50 hover:bg-brand-50 cursor-grab active:cursor-grabbing transition-colors border border-transparent hover:border-brand-200"
                      >
                        <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-700 flex-shrink-0">
                          {m.jersey_number || m.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">{m.name}</div>
                          <div className="text-[10px] text-gray-500">{m.position || '—'}</div>
                        </div>
                      </div>
                    ))}
                    {availablePlayers.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-2">All players assigned</p>
                    )}
                  </div>
                </div>
              )}

              {/* Legend for read-only */}
              {readOnly && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Squad</label>
                  <div className="space-y-1">
                    {slots.filter(s => s.memberId).map((s, i) => {
                      const m = getMember(s.memberId)
                      if (!m) return null
                      return (
                        <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                          <span className="text-xs font-semibold text-gray-500 w-8">{s.label}</span>
                          <span className="font-medium text-gray-900">{m.name}</span>
                          {m.jersey_number && <span className="text-xs text-gray-400">#{m.jersey_number}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Mobile Formation Picker */}
            {!readOnly && (
              <div className="md:hidden p-3 border-b border-gray-100">
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {FORMATION_KEYS.map(f => (
                    <button
                      key={f}
                      onClick={() => handleFormationChange(f)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                        formation === f
                          ? 'bg-brand-600 text-white'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Soccer Field */}
            <div className="flex-1 p-4">
              <div
                ref={fieldRef}
                className="relative w-full rounded-xl overflow-hidden"
                style={{
                  aspectRatio: '3 / 4',
                  background: 'linear-gradient(to bottom, #1c7040, #258a50, #1c7040)',
                }}
              >
                {/* Field markings */}
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 68 105" fill="none" xmlns="http://www.w3.org/2000/svg">
                  {/* Outline */}
                  <rect x="2" y="2" width="64" height="101" stroke="white" strokeWidth="0.4" strokeOpacity="0.6" fill="none" />
                  {/* Center line */}
                  <line x1="2" y1="52.5" x2="66" y2="52.5" stroke="white" strokeWidth="0.4" strokeOpacity="0.6" />
                  {/* Center circle */}
                  <circle cx="34" cy="52.5" r="9.15" stroke="white" strokeWidth="0.4" strokeOpacity="0.6" fill="none" />
                  <circle cx="34" cy="52.5" r="0.5" fill="white" fillOpacity="0.6" />
                  {/* Top penalty area */}
                  <rect x="13.84" y="2" width="40.32" height="16.5" stroke="white" strokeWidth="0.4" strokeOpacity="0.6" fill="none" />
                  <rect x="22.16" y="2" width="23.68" height="5.5" stroke="white" strokeWidth="0.4" strokeOpacity="0.6" fill="none" />
                  <circle cx="34" cy="13" r="0.5" fill="white" fillOpacity="0.6" />
                  {/* Bottom penalty area */}
                  <rect x="13.84" y="86.5" width="40.32" height="16.5" stroke="white" strokeWidth="0.4" strokeOpacity="0.6" fill="none" />
                  <rect x="22.16" y="97.5" width="23.68" height="5.5" stroke="white" strokeWidth="0.4" strokeOpacity="0.6" fill="none" />
                  <circle cx="34" cy="92" r="0.5" fill="white" fillOpacity="0.6" />
                  {/* Corner arcs */}
                  <path d="M2 4 A2 2 0 0 1 4 2" stroke="white" strokeWidth="0.4" strokeOpacity="0.6" fill="none" />
                  <path d="M64 2 A2 2 0 0 1 66 4" stroke="white" strokeWidth="0.4" strokeOpacity="0.6" fill="none" />
                  <path d="M2 101 A2 2 0 0 0 4 103" stroke="white" strokeWidth="0.4" strokeOpacity="0.6" fill="none" />
                  <path d="M64 103 A2 2 0 0 0 66 101" stroke="white" strokeWidth="0.4" strokeOpacity="0.6" fill="none" />
                </svg>

                {/* Player positions */}
                {slots.map((slot, i) => {
                  const member = slot.memberId ? getMember(slot.memberId) : null
                  const isEmpty = !member
                  const isActive = activeSlot === i

                  return (
                    <div
                      key={i}
                      className="absolute flex flex-col items-center"
                      style={{
                        left: `${slot.x}%`,
                        top: `${slot.y}%`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      onDragOver={!readOnly ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } : undefined}
                      onDrop={!readOnly ? () => handleDropOnSlot(i) : undefined}
                    >
                      {/* Jersey circle */}
                      <div className="relative">
                        <button type="button" disabled={readOnly} aria-label={`${slot.label}: ${member?.name || 'unassigned'}`}
                          className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shadow-md border-2 transition-all ${
                            isEmpty
                              ? isActive ? 'bg-white/40 border-white text-white ring-2 ring-white' : 'bg-white/20 border-white/40 text-white/60'
                              : 'bg-accent border-white text-white cursor-pointer'
                          } ${!readOnly && isEmpty ? 'hover:bg-white/30' : ''}`}
                          onClick={!readOnly ? () => handleSlotTap(i) : undefined}
                        >
                          {member ? (member.jersey_number ?? member.name.charAt(0)) : '?'}
                        </button>
                        {/* X button to remove on mobile */}
                        {!readOnly && !isEmpty && isActive && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveFromSlot(i) }}
                            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow-md"
                          >
                            x
                          </button>
                        )}
                      </div>
                      {/* Name label */}
                      <div className="mt-0.5 px-1.5 py-0.5 rounded bg-black/40 text-[9px] font-semibold text-white whitespace-nowrap max-w-[70px] truncate text-center">
                        {member ? member.name.split(' ')[0] : slot.label}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Mobile Player Picker */}
          {!readOnly && activeSlot !== null && !slots[activeSlot]?.memberId && (
            <div className="border-t border-gray-100 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase">
                  Select player for {slots[activeSlot]?.label}
                </span>
                <button onClick={() => setActiveSlot(null)} className="text-xs text-gray-400">Cancel</button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-[150px] overflow-y-auto">
                {availablePlayers.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleMobileAssign(m.id)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-50 hover:bg-brand-50 transition-colors text-left"
                  >
                    <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center text-[10px] font-bold text-brand-700 flex-shrink-0">
                      {m.jersey_number || m.name.charAt(0)}
                    </div>
                    <span className="text-xs font-medium text-gray-900 truncate">{m.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          {!readOnly && (
            <div className="border-t border-gray-100 p-4 flex items-center justify-between bg-gray-50 rounded-b-2xl">
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
                >
                  Cancel
                </button>
                {isTemplate && lineup && onDelete && (
                  <button
                    disabled={saving} onClick={async () => { if (!window.confirm('Delete this saved lineup?')) return; setSaving(true); try { await onDelete(lineup.id) } catch (cause) { setError(cause.message) } finally { setSaving(false) } }}
                    className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSave('draft')}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  onClick={() => handleSave('published')}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Publishing...' : 'Publish Lineup'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
