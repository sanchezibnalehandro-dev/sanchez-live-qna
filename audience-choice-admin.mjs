import { ELINA_28_EVENT_KEYS } from './audience-choice-flow.mjs';

// Embedded in the existing authenticated ModeratorLive admin.
// Does not touch Q&A room state or Program v2.
export async function mountAudienceChoiceAdmin(root, supabase, eventKey) {
  if (!root || !ELINA_28_EVENT_KEYS.includes(eventKey)) return () => {};
  root.hidden = false;

  const $ = selector => root.querySelector(selector);
  const heading = $('[data-poll-status]');
  const message = $('[data-poll-message]');
  const countsEl = $('[data-poll-counts]');
  const winnerEl = $('[data-poll-winner]');
  const openBtn = $('[data-poll-open]');
  const closeBtn = $('[data-poll-close]');
  const refreshBtn = $('[data-poll-refresh]');
  let busy = false;
  let closed = false;
  let pollKey = null;
  let pollStatus = 'draft';
  let refreshing = false;
  let operatorDenied = false;
  let refreshTimer = null;

  function status(text, error = false) {
    message.textContent = text || '';
    message.dataset.error = error ? 'true' : 'false';
  }
  function disableButtons(value) {
    openBtn.disabled = value || operatorDenied || pollStatus === 'open';
    closeBtn.disabled = value || operatorDenied || pollStatus !== 'open';
    refreshBtn.disabled = value || operatorDenied;
  }
  function displayCounts(counts) {
    const vals = Array.from({ length: 5 }, (_, idx) => {
      const record = (Array.isArray(counts) ? counts : []).find(row => Number(row.team_no) === idx + 1);
      return { no: idx + 1, votes: Number(record?.votes || 0) };
    });
    const total = vals.reduce((sum, row) => sum + row.votes, 0);
    countsEl.replaceChildren();
    for (const row of vals) {
      const el = document.createElement('span');
      el.textContent = 'Team ' + String(row.no).padStart(2, '0') + ': ' + row.votes;
      countsEl.append(el);
    }
    const max = Math.max(0, ...vals.map(v => v.votes));
    const leaders = vals.filter(v => v.votes === max);
    winnerEl.textContent = !total
      ? 'Всего голосов: 0'
      : 'Всего голосов: ' + total + ' · Лидер: ' + leaders.map(t => 'Team ' + String(t.no).padStart(2, '0')).join(' / ') + (leaders.length > 1 ? ' (НИЧЬЯ)' : '');
  }
  async function refresh() {
    if (closed || busy || refreshing || !pollKey) return;
    refreshing = true;
    try {
      const { data, error } = await supabase.rpc('audience_choice_admin_state', { p_poll_key: pollKey });
      if (error) throw error;
      if (!data) throw new Error('Опрос не найден');
      operatorDenied = false;
      pollStatus = data.status;
      heading.textContent = pollStatus.toUpperCase();
      displayCounts(data.counts);
      status('');
    } catch (error) {
      operatorDenied = error?.code === '42501' || /Poll operator access required|Staff sign-in required/i.test(error?.message || '');
      status(operatorDenied
        ? 'Нет прав оператора для этого голосования. Обратитесь к администратору.'
        : 'Не удалось получить данные голосования: ' + (error.message || error), true);
    } finally {
      refreshing = false;
      disableButtons(busy || !pollKey);
    }
  }
  async function update(next) {
    if (busy || !pollKey || closed || operatorDenied) return;
    if (next === 'closed' && !confirm('Закрыть Audience Choice для всех участников?')) return;
    if (next === 'open' && pollStatus === 'revealed' && !confirm('Опрос уже объявлен. Повторно открыть?')) return;
    busy = true;
    disableButtons(true);
    try {
      const { error } = await supabase.rpc('audience_choice_admin_status', { p_poll_key: pollKey, p_status: next });
      if (error) throw error;
      pollStatus = next;
      heading.textContent = next.toUpperCase();
      status(next === 'open' ? 'Голосование открыто, кнопка Vote появляется у гостей.' : 'Голосование закрыто.');
    } catch (error) {
      status('Не удалось переключить опрос: ' + (error.message || error), true);
    } finally {
      busy = false;
      await refresh();
    }
  }

  openBtn.addEventListener('click', () => void update('open'));
  closeBtn.addEventListener('click', () => void update('closed'));
  refreshBtn.addEventListener('click', () => void refresh());
  disableButtons(true);
  status('Подключение…');
  try {
    const { data, error } = await supabase.rpc('audience_choice_event_status', { p_event_key: eventKey });
    if (error) throw error;
    if (!data?.poll_key) throw new Error('Опрос не настроен для мероприятия');
    pollKey = data.poll_key;
    await refresh();
    refreshTimer = setInterval(() => {
      if (pollStatus === 'open' && !document.hidden) void refresh();
    }, 5000);
  } catch (error) {
    status('Модуль голосования пока недоступен: ' + (error.message || error), true);
  }
  return () => { closed = true; clearInterval(refreshTimer); };
}
