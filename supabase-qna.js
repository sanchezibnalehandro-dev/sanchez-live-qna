import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-qna-config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

export const DEFAULT_ROOM_SLUG = 'sanchez-live';
const volatileGuestSessions = new Map();

export function getRoomSlug() {
  const roomSlug = new URLSearchParams(window.location.search).get('room');
  return roomSlug?.trim() || DEFAULT_ROOM_SLUG;
}

export function getEventKey() {
  const eventKey = new URLSearchParams(window.location.search).get('event');
  return eventKey?.trim() || null;
}

export function getGuestSessionId(room) {
  const key = `qna-session:${room}`;
  let value = null;
  try {
    value = localStorage.getItem(key);
  } catch {
    value = volatileGuestSessions.get(key) || null;
  }
  if (!value) {
    value = volatileGuestSessions.get(key) || crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    volatileGuestSessions.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch {
      // Keep a stable in-memory session for this page when storage is unavailable.
    }
  }
  return value;
}

export async function getRoomBySlug(roomSlug) {
  const { data, error } = await supabase
    .from('qna_rooms')
    .select('id, slug, title, fallback_label, is_questions_open, moderation_enabled, mode, moderator_name, moderator_regalia, active_speaker_id, event_key, session_order, starts_at, duration_minutes, is_current_session')
    .eq('slug', roomSlug)
    .single();
  if (error) throw error;
  return data;
}

export async function listEventRooms(eventKey) {
  if (!eventKey?.trim()) return [];

  const { data, error } = await supabase
    .from('qna_rooms')
    .select('id, slug, title, mode, moderator_name, moderator_regalia, is_questions_open, moderation_enabled, session_order, starts_at, duration_minutes, is_current_session')
    .eq('event_key', eventKey)
    .order('session_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getCurrentEventRoom(eventKey) {
  if (!eventKey?.trim()) return null;

  const { data, error } = await supabase
    .from('qna_rooms')
    .select('id, slug, title, fallback_label, is_questions_open, moderation_enabled, mode, moderator_name, moderator_regalia, active_speaker_id, event_key, session_order, starts_at, duration_minutes, is_current_session')
    .eq('event_key', eventKey)
    .eq('is_current_session', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getActiveSpeaker(roomId) {
  const { data, error } = await supabase
    .from('qna_speakers')
    .select('id, room_id, name, regalia, topic, fallback_label, sort_order, is_active')
    .eq('room_id', roomId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listSpeakers(roomId) {
  const { data, error } = await supabase
    .from('qna_speakers')
    .select('id, room_id, name, regalia, topic, fallback_label, sort_order, is_active')
    .eq('room_id', roomId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listQuestions(roomId, speakerId, { includeHidden = false, includeAsked = true, includePending = false } = {}) {
  let query = supabase
    .from('qna_questions')
    .select('id, room_id, speaker_id, text, author_name, author_company, status, is_pinned, votes_count, created_at, asked_at')
    .eq('room_id', roomId)
    .order('is_pinned', { ascending: false })
    .order('votes_count', { ascending: false })
    .order('created_at', { ascending: false });

  if (speakerId) query = query.eq('speaker_id', speakerId);
  if (!includeHidden) query = query.neq('status', 'hidden');
  if (!includeAsked) query = query.neq('status', 'asked');
  if (!includePending) query = query.neq('status', 'pending');

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function submitGuestQuestion({ roomId, speakerId, text, authorName = '', authorCompany = '', sessionId }) {
  const { data, error } = await supabase.rpc('submit_guest_question', {
    p_room_id: roomId,
    p_speaker_id: speakerId,
    p_text: normalizeQuestion(text),
    p_author_name: cleanOptional(authorName),
    p_author_company: cleanOptional(authorCompany),
    p_session_id: sessionId
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : data;
}

export async function submitQuestion({ roomId, speakerId, text, authorName = '', authorCompany = '', sessionId, moderationEnabled = false }) {
  const payload = {
    room_id: roomId,
    speaker_id: speakerId,
    text: normalizeQuestion(text),
    author_name: cleanOptional(authorName),
    author_company: cleanOptional(authorCompany),
    session_id: sessionId,
    status: moderationEnabled ? 'pending' : 'open'
  };

  const { data, error } = await supabase
    .from('qna_questions')
    .insert(payload)
    .select('id, text, created_at, status')
    .single();
  if (error) throw error;
  return data;
}

export async function addVote(questionId, sessionId) {
  const { error } = await supabase.rpc('add_vote', {
    p_question_id: questionId,
    p_session_id: sessionId
  });
  if (error) throw error;
  return null;
}

export async function removeVote(questionId, sessionId) {
  const { error } = await supabase.rpc('remove_vote', {
    p_question_id: questionId,
    p_session_id: sessionId
  });
  if (error) throw error;
}

export async function setQuestionStatus(questionId, status) {
  const patch = { status };
  if (status === 'asked') patch.asked_at = new Date().toISOString();
  if (status === 'open')  patch.asked_at = null;
  const { data, error } = await supabase
    .from('qna_questions')
    .update(patch)
    .eq('id', questionId)
    .select('id, status, asked_at')
    .single();
  if (error) throw error;
  return data;
}

export async function setQuestionPinned(questionId, isPinned) {
  const { data, error } = await supabase
    .from('qna_questions')
    .update({ is_pinned: isPinned })
    .eq('id', questionId)
    .select('id, is_pinned')
    .single();
  if (error) throw error;
  return data;
}

export async function moderateQuestionStatus(roomId, questionId, status) {
  const { data, error } = await supabase.rpc('moderate_qna_question_status', {
    p_room_id: roomId,
    p_question_id: questionId,
    p_status: status
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : data;
}

export async function moderateQuestionPinned(roomId, questionId, isPinned) {
  const { data, error } = await supabase.rpc('moderate_qna_question_pin', {
    p_room_id: roomId,
    p_question_id: questionId,
    p_is_pinned: isPinned
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : data;
}

export async function setRoomQuestionsOpen(roomId, isOpen) {
  const { data, error } = await supabase
    .from('qna_rooms')
    .update({ is_questions_open: isOpen })
    .eq('id', roomId)
    .select('id, is_questions_open')
    .single();
  if (error) throw error;
  return data;
}

export async function setRoomModeration(roomId, moderationEnabled) {
  const { data, error } = await supabase
    .from('qna_rooms')
    .update({ moderation_enabled: moderationEnabled })
    .eq('id', roomId)
    .select('id, moderation_enabled')
    .single();
  if (error) throw error;
  return data;
}

export async function updateEventProgram(eventKey, rooms) {
  const { error } = await supabase.rpc('update_qna_event_program', {
    p_event_key: eventKey,
    p_items: rooms.map(({ id, title, starts_at, duration_minutes, session_order }) => ({
      id,
      title,
      starts_at: starts_at || null,
      duration_minutes: duration_minutes == null ? null : Number(duration_minutes),
      session_order
    }))
  });
  if (error) throw error;
}

async function fetchEventProgramContext(eventKey) {
  const [{ data: items, error: itemsError }, rooms] = await Promise.all([
    supabase
      .from('qna_event_program_items')
      .select('id, event_key, room_id, kind, title, session_order, starts_at, duration_minutes, is_current')
      .eq('event_key', eventKey)
      .order('session_order', { ascending: true })
      .order('id', { ascending: true }),
    listEventRooms(eventKey)
  ]);

  if (itemsError) throw itemsError;
  const roomsById = new Map(rooms.map(room => [String(room.id), room]));
  const normalizedItems = (items || []).map(item => {
    const room = item.room_id == null ? null : roomsById.get(String(item.room_id));
    return {
      ...item,
      title: item.kind === 'session' ? (room?.title || '') : (item.title || ''),
      mode: room?.mode || null,
      slug: room?.slug || null,
      moderator_name: room?.moderator_name || null,
      moderator_regalia: room?.moderator_regalia || null,
      is_questions_open: Boolean(room?.is_questions_open),
      is_current_session: Boolean(room?.is_current_session)
    };
  });

  return { items: normalizedItems, rooms };
}

export async function listEventProgramItems(eventKey) {
  if (!eventKey?.trim()) return [];
  const context = await fetchEventProgramContext(eventKey);
  return context.items;
}

export async function loadGuestEventProgram(eventKey) {
  if (!eventKey?.trim()) {
    const error = new Error('Event not found');
    error.code = 'EVENT_NOT_FOUND';
    throw error;
  }

  const { items, rooms } = await fetchEventProgramContext(eventKey);
  if (!items.length && !rooms.length) {
    const error = new Error('Event not found');
    error.code = 'EVENT_NOT_FOUND';
    throw error;
  }

  const sessionRoomIds = [...new Set(items
    .filter(item => item.kind === 'session' && item.room_id != null)
    .map(item => Number(item.room_id))
    .filter(Number.isFinite))];
  let speakers = [];

  if (sessionRoomIds.length) {
    const { data, error } = await supabase
      .from('qna_speakers')
      .select('id, room_id, name, regalia, topic, fallback_label, sort_order, is_active')
      .in('room_id', sessionRoomIds)
      .order('room_id', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw error;
    speakers = data || [];
  }

  const speakersByRoom = new Map();
  for (const speaker of speakers) {
    const roomKey = String(speaker.room_id);
    const roomSpeakers = speakersByRoom.get(roomKey) || [];
    roomSpeakers.push(speaker);
    speakersByRoom.set(roomKey, roomSpeakers);
  }

  return {
    items: items.map(item => ({
      ...item,
      speakers: item.kind === 'session'
        ? (speakersByRoom.get(String(item.room_id)) || [])
        : []
    })),
    operationalCurrentRoom: rooms.find(room => room.is_current_session) || null
  };
}

export async function saveEventProgram(eventKey, items) {
  const { error } = await supabase.rpc('save_qna_event_program', {
    p_event_key: eventKey,
    p_items: items.map(({ id, kind, room_id, title, starts_at, duration_minutes, session_order }) => ({
      id: id == null ? null : Number(id),
      kind,
      room_id: room_id == null ? null : Number(room_id),
      title,
      starts_at: starts_at || null,
      duration_minutes: duration_minutes == null ? null : Number(duration_minutes),
      session_order
    }))
  });
  if (error) throw error;
}

export async function createEventProgramSession(eventKey, mode) {
  const { data, error } = await supabase.rpc('create_qna_event_program_session', {
    p_event_key: eventKey,
    p_mode: mode
  });
  if (error) throw error;
  const row = Array.isArray(data) ? (data[0] || null) : data;
  if (!row) return null;
  return {
    room_id: row.room_id,
    program_item_id: row.program_item_id,
    title: row.title,
    mode: row.mode,
    session_order: row.session_order,
    starts_at: row.starts_at,
    duration_minutes: row.duration_minutes,
    is_current_session: row.is_current_session,
    is_questions_open: row.is_questions_open,
    slug: row.room_slug
  };
}

export async function updateSpeaker(speakerId, patch) {
  const payload = {
    name: cleanOptional(patch.name),
    regalia: cleanOptional(patch.regalia),
    topic: cleanOptional(patch.topic),
    fallback_label: cleanOptional(patch.fallback_label)
  };
  const { data, error } = await supabase
    .from('qna_speakers')
    .update(payload)
    .eq('id', speakerId)
    .select('id, name, regalia, topic, fallback_label')
    .single();
  if (error) throw error;
  return data;
}

export async function updateSpeakerOrder(roomId, speakers) {
  const { error } = await supabase.rpc('reorder_qna_speakers', {
    p_room_id: roomId,
    p_order: speakers.map(({ id, sort_order }) => ({ id, sort_order }))
  });
  if (error) throw error;
}

export async function createSpeaker(roomId, patch = {}) {
  const { data, error } = await supabase
    .from('qna_speakers')
    .insert({ room_id: roomId, name: patch.name || null, regalia: patch.regalia || null, topic: patch.topic || null, is_active: false })
    .select('id, name, regalia, topic, is_active')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSpeaker(speakerId) {
  const { error } = await supabase
    .from('qna_speakers')
    .delete()
    .eq('id', speakerId);
  if (error) throw error;
}

export async function setActiveSpeaker(roomId, speakerId) {
  const { error } = await supabase.rpc('set_active_qna_speaker', {
    p_room_id: roomId,
    p_speaker_id: speakerId
  });
  if (error) throw error;
}

export async function setCurrentEventSession(roomId) {
  const { error } = await supabase.rpc('set_current_event_session', {
    p_room_id: roomId
  });
  if (error) throw error;
}

export async function setCurrentEventProgramItem(programItemId) {
  const { error } = await supabase.rpc('set_current_event_program_item', {
    p_program_item_id: programItemId
  });
  if (error) throw error;
}

export async function clearCurrentEventProgramItem(eventKey) {
  const { error } = await supabase.rpc('clear_current_event_program_item', {
    p_event_key: eventKey
  });
  if (error) throw error;
}

export function subscribeRoom(roomId, onChange, onStatus) {
  let debounceTimer = null;
  let failureTimer = null;
  let active = true;

  const debounced = () => {
    if (!active) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (active) onChange();
    }, 150);
  };

  const channel = supabase.channel(`qna-room-${roomId}`, {
    config: { postgres_changes_options: { wait: true, timeout: 15000 } }
  })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'qna_rooms',     filter: `id=eq.${roomId}` }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'qna_speakers',  filter: `room_id=eq.${roomId}` }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'qna_questions', filter: `room_id=eq.${roomId}` }, debounced)
    .subscribe((status, error) => {
      if (!active) return;
      onStatus?.(status, error);
      if (error) console.error('Realtime subscription error', error);

      if (status === 'SUBSCRIBED') {
        clearTimeout(failureTimer);
        debounced();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(failureTimer);
        failureTimer = setTimeout(() => {
          if (active) onChange();
        }, 1000);
      }
    });

  return () => {
    active = false;
    clearTimeout(debounceTimer);
    clearTimeout(failureTimer);
    void supabase.removeChannel(channel);
  };
}

export function subscribeEvent(eventKey, onChange, onStatus) {
  if (!eventKey?.trim()) return () => {};

  let debounceTimer = null;
  let failureTimer = null;
  let active = true;

  const debounced = () => {
    if (!active) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (active) onChange();
    }, 100);
  };

  const channel = supabase.channel(`qna-event-${eventKey}`, {
    config: { postgres_changes_options: { wait: true, timeout: 15000 } }
  })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'qna_rooms',
      filter: `event_key=eq.${eventKey}`
    }, debounced)
    .subscribe((status, error) => {
      if (!active) return;
      onStatus?.(status, error);
      if (error) console.error('Event Realtime subscription error', error);

      if (status === 'SUBSCRIBED') {
        clearTimeout(failureTimer);
        debounced();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(failureTimer);
        failureTimer = setTimeout(() => {
          if (active) onChange();
        }, 1000);
      }
    });

  return () => {
    active = false;
    clearTimeout(debounceTimer);
    clearTimeout(failureTimer);
    void supabase.removeChannel(channel);
  };
}

export function subscribeGuestEventProgram(eventKey, getRelevantRoomIds, onChange, onStatus) {
  const normalizedEventKey = eventKey?.trim();
  if (!normalizedEventKey) return () => {};

  let debounceTimer = null;
  let failureTimer = null;
  let active = true;

  const debounced = () => {
    if (!active) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (active) onChange();
    }, 100);
  };

  const onProgramChange = payload => {
    if (!active) return;
    if (payload?.eventType === 'DELETE') {
      debounced();
      return;
    }
    const changedEventKey = payload?.new?.event_key ?? payload?.old?.event_key;
    if (changedEventKey === normalizedEventKey) debounced();
  };

  const onSpeakerChange = payload => {
    if (!active) return;
    if (payload?.eventType === 'DELETE') {
      debounced();
      return;
    }

    const relevantRoomIds = new Set(
      Array.from(getRelevantRoomIds?.() || [], roomId => String(roomId))
    );
    if (!relevantRoomIds.size) {
      debounced();
      return;
    }

    const changedRoomId = payload?.new?.room_id ?? payload?.old?.room_id;
    if (changedRoomId == null || relevantRoomIds.has(String(changedRoomId))) debounced();
  };

  const channelKey = normalizedEventKey.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80) || 'event';
  const channel = supabase.channel(`qna-guest-program-${channelKey}`, {
    config: { postgres_changes_options: { wait: true, timeout: 15000 } }
  })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'qna_rooms',
      filter: `event_key=eq.${normalizedEventKey}`
    }, debounced)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'qna_event_program_items'
    }, onProgramChange)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'qna_speakers'
    }, onSpeakerChange)
    .subscribe((status, error) => {
      if (!active) return;
      onStatus?.(status, error);
      if (error) console.error('Guest program Realtime subscription error', error);

      if (status === 'SUBSCRIBED') {
        clearTimeout(failureTimer);
        debounced();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(failureTimer);
        failureTimer = setTimeout(() => {
          if (active) onChange();
        }, 1000);
      }
    });

  return () => {
    active = false;
    clearTimeout(debounceTimer);
    clearTimeout(failureTimer);
    void supabase.removeChannel(channel);
  };
}

export async function deleteAllQuestions(roomId) {
  const { error } = await supabase
    .from('qna_questions')
    .delete()
    .eq('room_id', roomId);
  if (error) throw error;
}

export async function approveQuestion(questionId) {
  const { data, error } = await supabase
    .from('qna_questions')
    .update({ status: 'open' })
    .eq('id', questionId)
    .select('id, status')
    .single();
  if (error) throw error;
  return data;
}

export function normalizeQuestion(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
export function cleanOptional(value) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}
export function formatClock(value) {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
export function slug(value) {
  return String(value || 'demo-room')
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '') || 'demo-room';
}
