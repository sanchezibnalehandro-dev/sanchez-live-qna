import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-qna-config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const DEFAULT_ROOM_SLUG = 'altera-forum';

export function getRoomSlug() {
  return DEFAULT_ROOM_SLUG;
}

export function getGuestSessionId(room) {
  const key = `qna-session:${room}`;
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, value);
  }
  return value;
}

export async function getRoomBySlug(roomSlug) {
  const { data, error } = await supabase
    .from('qna_rooms')
    .select('id, slug, title, fallback_label, is_questions_open, moderation_enabled, active_speaker_id')
    .eq('slug', roomSlug)
    .single();
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
  const { data, error } = await supabase
    .from('qna_question_votes')
    .insert({ question_id: questionId, session_id: sessionId })
    .select('id')
    .single();
  if (error && !String(error.message || '').toLowerCase().includes('duplicate')) throw error;
  return data || null;
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
  const { error: resetError } = await supabase
    .from('qna_speakers')
    .update({ is_active: false })
    .eq('room_id', roomId);
  if (resetError) throw resetError;

  const { error: setError } = await supabase
    .from('qna_speakers')
    .update({ is_active: true })
    .eq('id', speakerId)
    .eq('room_id', roomId);
  if (setError) throw setError;

  const { data, error } = await supabase
    .from('qna_rooms')
    .update({ active_speaker_id: speakerId })
    .eq('id', roomId)
    .select('id, active_speaker_id')
    .single();
  if (error) throw error;
  return data;
}

export function subscribeRoom(roomId, onChange) {
  // Дебаунс: схлопываем частые события в один вызов
  let timer = null;
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(() => onChange(), 150);
  };

  const channel = supabase.channel(`qna-room-${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'qna_rooms',          filter: `id=eq.${roomId}` }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'qna_speakers',       filter: `room_id=eq.${roomId}` }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'qna_questions',      filter: `room_id=eq.${roomId}` }, debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'qna_question_votes' }, debounced)
    .subscribe((status) => {
      // Переподключаемся при разрыве
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setTimeout(() => onChange(), 1000);
      }
    });

  return () => { clearTimeout(timer); supabase.removeChannel(channel); };
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
