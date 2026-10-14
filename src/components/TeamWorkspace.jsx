import { useState } from 'react'
import { APP_BRAND } from '../lib/config'
import { TeamSettingsProvider, useTeamSettings } from '../lib/TeamSettingsContext'
import AdminPanel from './AdminPanel'
import { isPast, openGoogleCalendar, openOutlookCalendar } from '../lib/utils'
import Schedule from './Schedule'
import Roster from './Roster'
import Stats from './Stats'
import EventDetail from './EventDetail'
import AddEvent from './AddEvent'
import AddResult from './AddResult'
import EditProfile from './EditProfile'
import LineupBuilder from './LineupBuilder'

const TABS = [
  { id: 'schedule', label: 'Schedule' },
  { id: 'roster', label: 'Roster' },
  { id: 'stats', label: 'Stats' },
]

export default function TeamWorkspace({ team, demo = false }) {
  return <TeamSettingsProvider settings={team.settings} demo={demo}><TeamContent team={team} demo={demo} /></TeamSettingsProvider>
}

function TeamContent({ team, demo }) {
  const ACTIVE_TEAM = useTeamSettings()
  const [tab, setTab] = useState('schedule')
  const [modal, setModal] = useState(null)
  const [selectedEventId, setSelectedEventId] = useState(null)
  const [editingLineup, setEditingLineup] = useState(null)
  const [actionError, setActionError] = useState('')
  const reportAction = (fn) => async (...args) => {
    try { setActionError(''); return await fn(...args) } catch (error) { setActionError(error.message); throw error }
  }
  const safeAction = (fn) => async (...args) => {
    try { setActionError(''); return await fn(...args) } catch (error) { setActionError(error.message) }
  }

  if (team.loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
          <div className="text-lg font-bold text-gray-600 mb-4">{APP_BRAND.shortName}</div>
          <p className="text-gray-400 font-medium">Loading...</p>
        </div>
      </div>
    )
  }

  const activeTab = tab === 'stats' && !ACTIVE_TEAM.scores_enabled ? 'schedule' : tab
  const selectedEvent = team.events.find(e => e.id === selectedEventId)

  const handleSelectEvent = (eventId) => {
    setSelectedEventId(eventId)
    setModal('eventDetail')
  }

  const handleAddResult = () => {
    setModal('addResult')
  }

  const handleLineup = () => {
    setModal('lineup')
  }

  const handleSaveResult = async (eventId, teamScore, oppScore, goals) => {
    await team.saveResult(eventId, teamScore, oppScore, goals)
    setModal('eventDetail')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase text-violet-500">{APP_BRAND.name}</p>
              <h1 className="text-lg font-bold text-gray-900 [overflow-wrap:anywhere]">{ACTIVE_TEAM.name}</h1>
              <p className="text-xs text-gray-400">{ACTIVE_TEAM.season} season</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-3">
            {team.isAdmin && !demo && (
              <button
                onClick={() => setModal('addEvent')}
                className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                + Event
              </button>
            )}
            {!demo && team.isAdmin && <button className="text-sm font-semibold text-violet-700" onClick={() => setModal('settings')}>Manage</button>}
            {!demo && <button
              onClick={() => setModal('editProfile')}
              className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-lg hover:bg-gray-200 transition-colors overflow-hidden"
              title="Edit profile" aria-label="Edit profile"
            >
              {team.myInfo?.avatar_url ? (
                <img src={team.myInfo.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-bold text-gray-500">{team.myInfo?.name?.charAt(0)}</span>
              )}
            </button>}
          </div>
        </div>
      </header>

      {(actionError || team.error) && <div role="alert" className="max-w-2xl mx-auto p-4 text-red-800 bg-red-50">{actionError || team.error}<button className="ml-3 underline" onClick={() => { setActionError(''); team.clearError?.() }}>Dismiss</button></div>}
      {/* Tab Bar */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex">
            {TABS.filter(t => t.id !== 'stats' || ACTIVE_TEAM.scores_enabled).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-3 text-sm font-semibold text-center border-b-2 transition-colors ${
                  activeTab === t.id
                    ? 'border-violet-600 text-violet-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-6 pb-24">
        {activeTab === 'schedule' && (
          <Schedule
            events={team.events}
            rsvps={team.rsvps}
            goals={team.goals}
            me={team.me}
            members={team.members}
            isAdmin={team.isAdmin && !demo}
            onRsvp={safeAction(team.setRsvp)}
            onSelectEvent={handleSelectEvent}
          />
        )}
        {activeTab === 'roster' && (
          <Roster
            members={team.members}
            me={team.me}
            isAdmin={team.isAdmin && !demo}
            onPromote={reportAction(team.promoteMember)}
            onRemove={reportAction(team.removeMember)}
            templateLineups={team.getTemplateLineups()}
            onCreateLineup={() => { setEditingLineup(null); setModal('templateLineup') }}
            onEditLineup={(l) => { setEditingLineup(l); setModal('templateLineup') }}
            rsvps={team.rsvps}
            events={team.events}
          />
        )}
        {activeTab === 'stats' && ACTIVE_TEAM.scores_enabled && (
          <Stats
            events={team.events}
            goals={team.goals}
            members={team.members}
            isAdmin={team.isAdmin && !demo}
            onSaveResult={reportAction(team.saveResult)}
            onSelectEvent={handleSelectEvent}
          />
        )}
      </main>

      {/* Modals */}
      {modal === 'settings' && !demo && <AdminPanel team={team} onClose={() => setModal(null)} />}
      {modal === 'addEvent' && (
        <AddEvent
          onSubmit={async (data) => {
            await team.addEvent(data)
            setModal(null)
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'eventDetail' && selectedEvent && (
        <EventDetail
          event={selectedEvent}
          rsvps={team.getEventRsvps(selectedEvent.id)}
          goals={team.getEventGoals(selectedEvent.id)}
          members={team.members}
          myRsvp={team.getMyRsvp(selectedEvent.id)}
          isAdmin={team.isAdmin && !demo}
          isPast={isPast(selectedEvent.date, ACTIVE_TEAM.timezone)}
          onRsvp={reportAction(team.setRsvp)}
          onClose={() => { setModal(null); setSelectedEventId(null) }}
          onAddResult={handleAddResult}
          onUpdateEvent={reportAction(team.updateEvent)}
          onDelete={async (id) => {
            await team.deleteEvent(id)
            setModal(null)
            setSelectedEventId(null)
          }}
          onGoogleCal={() => openGoogleCalendar(selectedEvent, ACTIVE_TEAM.timezone)}
          onOutlookCal={() => openOutlookCalendar(selectedEvent, ACTIVE_TEAM.timezone)}
          onLineup={handleLineup}
          lineup={team.getEventLineup(selectedEvent.id)}
          onSetRsvpForMember={reportAction(team.setRsvpForMember)}
        />
      )}

      {modal === 'editProfile' && (
        <EditProfile
          myInfo={team.myInfo}
          onSave={team.updateProfile}
          onLogout={async () => { await team.logout(); setModal(null) }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'lineup' && selectedEvent && (
        <LineupBuilder
          event={selectedEvent}
          members={team.members}
          lineup={team.getEventLineup(selectedEvent.id)}
          isAdmin={team.isAdmin && !demo}
          onSave={async (data) => {
            await team.saveLineup(data)
            setModal(current => current === 'lineup' ? 'eventDetail' : current)
          }}
          onClose={() => setModal('eventDetail')}
        />
      )}

      {modal === 'templateLineup' && (
        <LineupBuilder
          members={team.members}
          lineup={editingLineup}
          isAdmin={team.isAdmin && !demo}
          onSave={async (data) => {
            await team.saveLineup(data)
            setModal(null)
            setEditingLineup(null)
          }}
          onDelete={async (id) => {
            await team.deleteLineup(id)
            setModal(null)
            setEditingLineup(null)
          }}
          onClose={() => { setModal(null); setEditingLineup(null) }}
        />
      )}

      {modal === 'addResult' && selectedEvent && (
        <AddResult
          event={selectedEvent}
          members={team.members}
          existingGoals={team.getEventGoals(selectedEvent.id)}
          onSubmit={handleSaveResult}
          onClose={() => setModal('eventDetail')}
        />
      )}
    </div>
  )
}
