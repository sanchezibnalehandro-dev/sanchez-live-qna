import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
function assertModuleParses(source) {
  const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('embedded admin module parses and contains only Audience Choice RPCs', () => {
  const script = read('audience-choice-admin.mjs');
  assertModuleParses(script);
  assert.match(script, /audience_choice_admin_state/);
  assert.match(script, /audience_choice_admin_status/);
  assert.match(script, /ELINA_28_EVENT_KEYS\.includes\(eventKey\)/);
  assert.doesNotMatch(script, /(?:updateSpeaker|setRoomQuestionsOpen|saveEventProgram)\(/);
});

test('existing admin includes voting controls without replacing Q&A or Program v2', () => {
  const html = read('admin-auth.html');
  assert.match(html, /id="audienceChoiceControl" hidden/);
  assert.match(html, /data-poll-open/);
  assert.match(html, /data-poll-close/);
  assert.match(html, /data-poll-counts/);
  assert.match(html, /mountAudienceChoiceAdmin/);
  assert.match(html, /id="eventSessionControl"/);
  assert.match(html, /id="questionsOpenToggle"/);
  assert.doesNotMatch(html, /audience-vote-admin\.html/);
  const module = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(module, 'Missing admin ES module');
  assertModuleParses(module[1]);
});
