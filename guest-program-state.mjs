export const PROGRAM_ITEM_STATE = Object.freeze({
  PAST: 'PAST',
  NOW: 'NOW',
  FUTURE: 'FUTURE',
  UNSCHEDULED: 'UNSCHEDULED'
});

export const PROGRAM_HERO_STATE = Object.freeze({
  NOW: 'NOW',
  NEXT: 'NEXT',
  COMPLETE: 'COMPLETE',
  UNSCHEDULED: 'UNSCHEDULED',
  EMPTY: 'EMPTY'
});

function compareProgramItems(left, right) {
  const orderDifference = Number(left.session_order || 0) - Number(right.session_order || 0);
  if (orderDifference) return orderDifference;
  return Number(left.id || 0) - Number(right.id || 0);
}

function toNowMs(value) {
  const numeric = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

function withScheduleState(item, nowMs) {
  const startMs = Date.parse(item.starts_at);
  const durationMinutes = Number(item.duration_minutes);
  const endMs = startMs + durationMinutes * 60_000;
  const validSchedule = Number.isFinite(startMs)
    && Number.isFinite(durationMinutes)
    && durationMinutes > 0
    && Number.isFinite(endMs)
    && endMs > startMs;

  if (!validSchedule) {
    return {
      ...item,
      scheduleState: PROGRAM_ITEM_STATE.UNSCHEDULED,
      startMs: null,
      endMs: null
    };
  }

  const scheduleState = endMs <= nowMs
    ? PROGRAM_ITEM_STATE.PAST
    : startMs <= nowMs
      ? PROGRAM_ITEM_STATE.NOW
      : PROGRAM_ITEM_STATE.FUTURE;

  return { ...item, scheduleState, startMs, endMs };
}

export function deriveGuestProgramState(items, operationalCurrentRoom, now = Date.now()) {
  const nowMs = toNowMs(now);
  const orderedItems = [...(items || [])]
    .sort(compareProgramItems)
    .map(item => withScheduleState(item, nowMs));
  const scheduledItems = orderedItems.filter(item => item.scheduleState !== PROGRAM_ITEM_STATE.UNSCHEDULED);
  const unscheduledItems = orderedItems.filter(item => item.scheduleState === PROGRAM_ITEM_STATE.UNSCHEDULED);
  const currentItem = scheduledItems.find(item => item.scheduleState === PROGRAM_ITEM_STATE.NOW) || null;
  const nextItem = scheduledItems
    .filter(item => item.scheduleState === PROGRAM_ITEM_STATE.FUTURE)
    .sort((left, right) => left.startMs - right.startMs || compareProgramItems(left, right))[0] || null;

  let heroState = PROGRAM_HERO_STATE.EMPTY;
  let heroItem = null;
  if (currentItem) {
    heroState = PROGRAM_HERO_STATE.NOW;
    heroItem = currentItem;
  } else if (nextItem) {
    heroState = PROGRAM_HERO_STATE.NEXT;
    heroItem = nextItem;
  } else if (scheduledItems.length) {
    heroState = PROGRAM_HERO_STATE.COMPLETE;
  } else if (unscheduledItems.length) {
    heroState = PROGRAM_HERO_STATE.UNSCHEDULED;
  }

  const operationalRoomId = operationalCurrentRoom?.id;
  const canAskCurrent = Boolean(
    currentItem?.kind === 'session'
    && currentItem.room_id != null
    && operationalRoomId != null
    && String(currentItem.room_id) === String(operationalRoomId)
    && operationalCurrentRoom?.is_questions_open === true
  );

  const transitionCandidates = scheduledItems.flatMap(item => {
    if (item.scheduleState === PROGRAM_ITEM_STATE.NOW) return [item.endMs];
    if (item.scheduleState === PROGRAM_ITEM_STATE.FUTURE) return [item.startMs];
    return [];
  }).filter(value => Number.isFinite(value) && value > nowMs);

  return {
    nowMs,
    orderedItems,
    scheduledItems,
    unscheduledItems,
    currentItem,
    nextItem,
    heroState,
    heroItem,
    canAskCurrent,
    nextTransitionAt: transitionCandidates.length ? Math.min(...transitionCandidates) : null
  };
}
