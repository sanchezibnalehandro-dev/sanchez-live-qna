import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIENCE_TEAMS, teamOptions, canSubmitChoice, voteButtonVisible, ELINA_28_EVENT_KEYS } from '../audience-choice-flow.mjs';

test('five teams and every participant sees exactly four other teams', () => {
  assert.equal(AUDIENCE_TEAMS.length, 5);
  for (const t of AUDIENCE_TEAMS) {
    const options = teamOptions(t.no);
    assert.equal(options.length, 4);
    assert.equal(options.some(o => o.no === t.no), false);
    assert.equal(new Set(options.map(o => o.no)).size, 4);
  }
});

test('cannot select own team or invalid inputs', () => {
  assert.equal(canSubmitChoice(2, 2), false);
  assert.equal(canSubmitChoice(2, 1), true);
  assert.equal(canSubmitChoice(1, 5), true);
  assert.equal(canSubmitChoice(0, 1), false);
  assert.equal(canSubmitChoice(1, 6), false);
  assert.equal(canSubmitChoice(null, 3), false);
});

test('guest Vote CTA is available only while the poll is open', () => {
  for (const state of ['draft', 'closed', 'revealed', undefined, null]) {
    assert.equal(voteButtonVisible(state), false);
  }
  assert.equal(voteButtonVisible('open'), true);
  assert.deepEqual(ELINA_28_EVENT_KEYS, ['elina-28-2026','elina-28-rehearsal']);
});
