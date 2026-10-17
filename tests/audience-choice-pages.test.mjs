import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function read(path) { return readFileSync(new URL('../' + path, import.meta.url), 'utf8'); }
function inlineModule(html) {
  const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(match, 'Expected an inline ES module in page');
  return match[1];
}

test('Audience Choice page module parses', () => {
  const source = inlineModule(read('audience-vote.html'));
  const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
});

test('welcome page module parses and links to vote using existing event key', () => {
  const html = read('welcome.html');
  const source = inlineModule(html);
  const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(html, /id="audienceVoteLink"[^>]+hidden/);
  assert.match(source, /audienceVoteLink\.href\s*=\s*`\.\/audience-vote\.html\?event=/);
  assert.match(source, /audience_choice_event_status/);
  assert.match(source, /audienceVoteTimer\s*=\s*setInterval/);
});

test('guest page asks for own team first and only then for a competing vote', () => {
  const html = read('audience-vote.html');
  assert.match(html, /id="ownStep"[^>]+hidden/);
  assert.match(html, /id="voteStep"[^>]+hidden/);
  assert.match(html, /id="completeStep"[^>]+hidden/);
  assert.match(html, /teamOptions\(ownTeam\)/);
  assert.match(html, /canSubmitChoice\(ownTeam, votedTeam\)/);
  assert.match(html, /p_own_team:\s*ownTeam/);
  assert.match(html, /p_team_no:\s*votedTeam/);
  assert.match(html, /welcome\.html\?event=/);
});
