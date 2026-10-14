import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, supabaseConfigured } from './supabase'
import { cloudInstall, cloudRequest } from './cloud'
import { DEFAULT_TEAM } from './config'
import { normalizeTime, calendarRange } from './utils'

const emptyData = { members: [], events: [], rsvps: [], goals: [], lineups: [], settings: DEFAULT_TEAM, myMember: null, invitations: [], schemaRequired: false }
const failure = result => {
  if (result.error) {
    const error = new Error(result.error.message)
    error.code = result.error.code
    error.status = result.status
    throw error
  }
  return result.data
}

// Keyset pagination avoids PostgREST's default response row limit and unstable offsets.
async function readAll(table, columns = '*', key = 'id') {
  const rows = []
  let cursor
  while (true) {
    let query = supabase.from(table).select(columns).order(key).limit(500)
    if (cursor !== undefined) query = query.gt(key, cursor)
    const page = failure(await query)
    rows.push(...page)
    if (page.length < 500) return rows
    cursor = page.at(-1)[key]
  }
}

export function useTeam() {
  const [data, setData] = useState(emptyData)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(supabaseConfigured)
  const [authReady, setAuthReady] = useState(!supabaseConfigured)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const loadSequence = useRef(0)

  const loadAll = useCallback(async (activeSession) => {
    const sequence = ++loadSequence.current
    if (!supabase || !activeSession?.user) { setData(emptyData); setLoadError(''); setLoading(false); return }
    try {
      const schema = await supabase.from('team_settings').select('id').limit(1)
      if (schema.error && ['42P01', 'PGRST205', '42703'].includes(schema.error.code)) {
        if (sequence === loadSequence.current) setData({ ...emptyData, schemaRequired: true })
        throw new Error('The OpenSport schema is not installed. A legacy team requires a reviewed migration, not the fresh-install schema.')
      }
      failure(schema)
      const own = failure(await supabase.from('soccer_members').select('*').eq('user_id', activeSession.user.id).maybeSingle())
      if (!own?.active || !own?.onboarding_completed_at) {
        if (sequence === loadSequence.current) { setData({ ...emptyData, myMember: own }); setLoadError('') }
        return
      }
      const admin = ['admin', 'coach'].includes(own.role)
      const [members, events, rsvps, goals, lineups, settings, contacts, invitations] = await Promise.all([
        readAll('soccer_members'),
        readAll('soccer_events'),
        readAll('soccer_rsvps'),
        readAll('soccer_goals'),
        readAll('soccer_lineups'),
        supabase.from('team_settings').select('*').eq('id', 1).single().then(failure),
        readAll('soccer_member_contacts', '*', 'member_id'),
        admin ? readAll('team_invitations', 'id,user_id,email,expires_at,revoked_at,accepted_at,created_at') : [],
      ])
      const paths = [...new Set(members.map(member => member.avatar_path).filter(Boolean))]
      let urls = new Map()
      if (paths.length) {
        const signed = failure(await supabase.storage.from('avatars').createSignedUrls(paths, 300))
        urls = new Map(signed.map(item => [item.path, item.signedUrl]))
      }
      const hydrated = members.map(member => ({ ...member, avatar_url: urls.get(member.avatar_path) || '', phone: contacts.find(contact => contact.member_id === member.id)?.phone || '' }))
      if (sequence === loadSequence.current) {
        setData({ members: hydrated, events, rsvps, goals, lineups, settings, invitations, myMember: hydrated.find(member => member.user_id === activeSession.user.id) || own })
        setLoadError('')
      }
    } catch (cause) {
      if (sequence === loadSequence.current) {
        if (['42501', 'PGRST116', 'PGRST301', 'PGRST302', 'PGRST303'].includes(cause.code) || [401, 403].includes(cause.status)) setData(emptyData)
        setLoadError(cause.message)
      }
    }
    finally { if (sequence === loadSequence.current) setLoading(false) }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(result => {
      if (!active) return
      if (result.error) setError(result.error.message)
      setSession(result.data?.session || null)
      setAuthReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setAuthReady(true)
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => { if (authReady) loadAll(session) }, [authReady, session, loadAll])

  useEffect(() => {
    if (!supabase || !session?.user) return
    let active = true
    const refresh = () => { if (active && document.visibilityState === 'visible') loadAll(session) }
    let channel = supabase.channel('opensport-team')
    for (const table of ['soccer_members', 'soccer_events', 'soccer_rsvps', 'soccer_goals', 'soccer_lineups', 'team_settings']) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => { if (active) loadAll(session) })
    }
    // Realtime does not replay changes missed during an outage. Refresh both
    // when the browser reconnects and when its subscription is ready again.
    channel.subscribe(status => { if (status === 'SUBSCRIBED') refresh() })
    window.addEventListener('online', refresh)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const interval = window.setInterval(refresh, 60 * 1000)
    return () => {
      active = false
      supabase.removeChannel(channel)
      window.removeEventListener('online', refresh)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.clearInterval(interval)
    }
  }, [session, loadAll])

  const requireClient = () => { if (!supabase) throw new Error('This instance is not configured. Ask its host to finish setting up OpenSport.') }
  const mutate = async operation => {
    requireClient()
    setError('')
    try { const value = failure(await operation()); await loadAll(session); return value }
    catch (cause) { setError(cause.message); throw cause }
  }
  const login = async credentials => {
    try { requireClient(); failure(await supabase.auth.signInWithPassword(credentials)); return { error: null } }
    catch (cause) { return { error: cause.message } }
  }
  const logout = async () => { requireClient(); ++loadSequence.current; failure(await supabase.auth.signOut()); ++loadSequence.current; setSession(null); setData(emptyData) }
  const validateEvent = event => {
    const cleaned = { ...event }
    if ('time' in event) cleaned.time = normalizeTime(event.time)
    if ('end_time' in event) cleaned.end_time = normalizeTime(event.end_time)
    if (event.date) calendarRange({ ...event, ...cleaned }, data.settings.timezone)
    return cleaned
  }
  const addEvent = event => mutate(() => supabase.from('soccer_events').insert({ ...validateEvent(event), created_by: data.myMember.id }).select('id').single())
  const updateEvent = (id, updates) => mutate(() => supabase.from('soccer_events').update(validateEvent(updates)).eq('id', id).select('id').single())
  const deleteEvent = id => mutate(() => supabase.from('soccer_events').delete().eq('id', id).select('id').single())
  const setRsvpForMember = (eventId, memberId, status) => mutate(() => supabase.from('soccer_rsvps').upsert({ event_id: eventId, member_id: memberId, status }, { onConflict: 'event_id,member_id' }).select('id').single())
  const setRsvp = (eventId, status) => setRsvpForMember(eventId, data.myMember.id, status)
  const saveResult = (eventId, teamScore, oppScore, goals = []) => mutate(() => supabase.rpc('save_result', { p_event_id: eventId, p_team_score: Number(teamScore), p_opponent_score: Number(oppScore), p_goals: goals.map(goal => ({ scorer_id: goal.scorer, assist_id: goal.assist || null, minute: goal.minute === '' || goal.minute == null ? null : Number(goal.minute) })) }))
  const saveLineup = ({ id, event_id, name, formation, slots, status }) => mutate(() => {
    const existing = id || data.lineups.find(lineup => event_id && lineup.event_id === event_id)?.id
    const fields = { name, formation, slots, status }
    return existing ? supabase.from('soccer_lineups').update(fields).eq('id', existing).select('id').single() : supabase.from('soccer_lineups').insert({ ...fields, event_id: event_id || null, created_by: data.myMember.id }).select('id').single()
  })
  const setMemberAccess = (memberId, role = null, active = null) => mutate(() => supabase.rpc('set_member_access', { p_member_id: memberId, p_role: role, p_active: active }))
  const updateProfile = async ({ name, jerseyNumber, position, avatarFile, phone }) => {
    requireClient()
    const updates = { name: name.trim(), jersey_number: jerseyNumber === '' || jerseyNumber == null ? null : Number(jerseyNumber), position: position || '' }
    if (avatarFile) {
      const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
      const extension = extensions[avatarFile.type]
      if (!extension || avatarFile.size > 5 * 1024 * 1024) throw new Error('Choose a JPEG, PNG, or WebP image smaller than 5 MB.')
      const path = `${session.user.id}/${crypto.randomUUID()}.${extension}`
      failure(await supabase.storage.from('avatars').upload(path, avatarFile))
      updates.avatar_path = path
    }
    await mutate(() => supabase.from('soccer_members').update(updates).eq('id', data.myMember.id).select('id').single())
    if (phone !== undefined) await mutate(() => supabase.from('soccer_member_contacts').update({ phone: phone.trim() || null }).eq('member_id', data.myMember.id).select('member_id').single())
  }
  const adminAction = async body => {
    requireClient()
    if (cloudInstall) {
      const { data: { session: current } } = await supabase.auth.getSession()
      const data = await cloudRequest('/api/team-admin', { method: 'POST', body, token: current?.access_token })
      await loadAll(session)
      return data
    }
    const result = await supabase.functions.invoke('team-admin', { body })
    if (result.error) {
      let message = result.error.message
      try { const details = await result.error.context?.json(); message = details?.error || message } catch { /* use transport error */ }
      throw new Error(message)
    }
    if (result.data?.error) throw new Error(result.data.error)
    await loadAll(session)
    return result.data
  }

  const { myMember, ...rest } = data
  return {
    ...rest, session, configured: supabaseConfigured, loading: loading || !authReady, error: error || loadError, clearError: () => { setError(''); setLoadError('') },
    me: myMember?.id || null, myInfo: myMember, isAdmin: !!myMember?.active && ['admin', 'coach'].includes(myMember.role),
    hasProfile: !!myMember?.active && !!myMember?.onboarding_completed_at, login, logout, reload: () => loadAll(session),
    addEvent, updateEvent, deleteEvent, setRsvp, setRsvpForMember, saveResult, saveLineup, updateProfile,
    deleteLineup: id => mutate(() => supabase.from('soccer_lineups').delete().eq('id', id).select('id').single()),
    setMemberAccess, promoteMember: id => setMemberAccess(id, 'admin'), removeMember: id => setMemberAccess(id, null, false),
    updateSettings: settings => mutate(() => supabase.from('team_settings').update(settings).eq('id', 1).select('id').single()),
    createInvite: (email, name) => adminAction({ action: 'invite', email, name }),
    createRecovery: memberId => adminAction({ action: 'recovery', member_id: memberId }),
    revokeInvite: invitationId => adminAction({ action: 'revoke-invite', invitation_id: invitationId }),
    getEventRsvps: id => data.rsvps.filter(item => item.event_id === id),
    getMyRsvp: id => data.rsvps.find(item => item.event_id === id && item.member_id === myMember?.id),
    getEventGoals: id => data.goals.filter(item => item.event_id === id),
    getEventLineup: id => data.lineups.find(item => item.event_id === id) || null,
    getTemplateLineups: () => data.lineups.filter(item => !item.event_id),
  }
}
