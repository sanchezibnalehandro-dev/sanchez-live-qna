import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROGRAM_HERO_STATE,
  PROGRAM_ITEM_STATE,
  deriveGuestProgramState
} from '../guest-program-state.mjs';

const NOW = Date.parse('2026-10-05T09:30:00Z');

function item(overrides = {}) {
  return {
    id: 1,
    kind: 'session',
    room_id: 11,
    title: 'Сессия',
    session_order: 10,
    starts_at: '2026-10-05T09:00:00Z',
    duration_minutes: 60,
    ...overrides
  };
}

test('A: past session remains in the schedule as PAST', () => {
  const view = deriveGuestProgramState([
    item({ starts_at: '2026-10-05T08:00:00Z', duration_minutes: 30 })
  ], null, NOW);

  assert.equal(view.scheduledItems[0].scheduleState, PROGRAM_ITEM_STATE.PAST);
  assert.equal(view.heroState, PROGRAM_HERO_STATE.COMPLETE);
});

test('B: current panel matching operational LIVE room allows Q&A', () => {
  const view = deriveGuestProgramState([
    item({ mode: 'panel' })
  ], { id: 11, is_questions_open: true }, NOW);

  assert.equal(view.heroState, PROGRAM_HERO_STATE.NOW);
  assert.equal(view.heroItem.mode, 'panel');
  assert.equal(view.canAskCurrent, true);
});

test('C: current panel with another operational room does not allow Q&A', () => {
  const view = deriveGuestProgramState([item({ mode: 'panel' })], { id: 12, is_questions_open: true }, NOW);
  assert.equal(view.heroState, PROGRAM_HERO_STATE.NOW);
  assert.equal(view.canAskCurrent, false);
});

test('C2: matching operational room with closed intake does not allow Q&A', () => {
  const view = deriveGuestProgramState([item()], { id: 11, is_questions_open: false }, NOW);
  assert.equal(view.heroState, PROGRAM_HERO_STATE.NOW);
  assert.equal(view.canAskCurrent, false);
});

test('I: current program session without operational current room does not allow Q&A', () => {
  const view = deriveGuestProgramState([item()], null, NOW);
  assert.equal(view.heroState, PROGRAM_HERO_STATE.NOW);
  assert.equal(view.canAskCurrent, false);
});

test('D: current service block never allows Q&A', () => {
  const view = deriveGuestProgramState([
    item({ kind: 'service', room_id: null, title: 'Кофе-брейк' })
  ], { id: 11 }, NOW);

  assert.equal(view.heroState, PROGRAM_HERO_STATE.NOW);
  assert.equal(view.heroItem.title, 'Кофе-брейк');
  assert.equal(view.canAskCurrent, false);
});

test('E: nearest future item becomes NEXT hero', () => {
  const view = deriveGuestProgramState([
    item({ id: 2, session_order: 20, starts_at: '2026-10-05T11:00:00Z' }),
    item({ id: 1, session_order: 10, starts_at: '2026-10-05T10:00:00Z' })
  ], null, NOW);

  assert.equal(view.heroState, PROGRAM_HERO_STATE.NEXT);
  assert.equal(view.heroItem.id, 1);
  assert.equal(view.nextTransitionAt, Date.parse('2026-10-05T10:00:00Z'));
});

test('F: all scheduled items ended produces COMPLETE', () => {
  const view = deriveGuestProgramState([
    item({ starts_at: '2026-10-05T07:00:00Z', duration_minutes: 20 }),
    item({ id: 2, starts_at: '2026-10-05T08:00:00Z', duration_minutes: 20 })
  ], null, NOW);

  assert.equal(view.heroState, PROGRAM_HERO_STATE.COMPLETE);
  assert.equal(view.heroItem, null);
});

test('invalid duration and missing time are grouped as UNSCHEDULED', () => {
  const view = deriveGuestProgramState([
    item({ id: 2, starts_at: null }),
    item({ id: 1, duration_minutes: 0 })
  ], null, NOW);

  assert.equal(view.heroState, PROGRAM_HERO_STATE.UNSCHEDULED);
  assert.deepEqual(view.unscheduledItems.map(entry => entry.id), [1, 2]);
});

test('overlap chooses the first NOW item in Program v2 order', () => {
  const view = deriveGuestProgramState([
    item({ id: 2, session_order: 20 }),
    item({ id: 1, session_order: 10 })
  ], { id: 11 }, NOW);

  assert.equal(view.currentItem.id, 1);
});

test('empty program has no hero item and no CTA', () => {
  const view = deriveGuestProgramState([], { id: 11 }, NOW);
  assert.equal(view.heroState, PROGRAM_HERO_STATE.EMPTY);
  assert.equal(view.heroItem, null);
  assert.equal(view.canAskCurrent, false);
});
