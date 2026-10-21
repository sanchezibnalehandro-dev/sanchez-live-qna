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

test('public event branding uses accelerator name, not internal ELINA label', () => {
  const brand = read('brand-presets/elina-28.js');
  const vote = read('audience-vote.html');
  assert.match(brand, /IT Park Global Startup Accelerator 2026/);
  assert.match(brand, /International Team Session · 28 October/);
  assert.equal(brand.includes("name: 'ELINA 28'"), false);
  assert.match(vote, /IT PARK · GLOBAL STARTUP ACCELERATOR 2026/);
  assert.equal(vote.includes('MODERATORLIVE / ELINA 28'), false);
});

test('control desk uses current program brand and explains missing voting backend', () => {
  const admin = read('admin-auth.html');
  const controller = read('audience-choice-admin.mjs');
  assert.match(admin, /Audience Choice · Startup Accelerator 2026/);
  assert.equal(admin.includes('Audience Choice · ELINA 28'), false);
  assert.match(controller, /PGRST202/);
  assert.match(controller, /серверный модуль не установлен в Supabase/);
  assert.match(controller, /disableButtons\(true\)/);
});

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

test('ELINA 28 guest modules parse and English is strictly event-scoped', () => {
  for (const page of ['welcome.html','program.html','ask.html']) {
    const html=read(page);
    const script=inlineModule(html);
    const checked=spawnSync(process.execPath,['--check','--input-type=module'],{input:script,encoding:'utf8'});
    assert.equal(checked.status,0,page+': '+checked.stderr);
    assert.match(script,/eventKey === 'elina-28-2026'/,page+': exact match is required');
    assert.match(script,/document\.documentElement\.lang = 'en'/);
  }
  const welcome=read('welcome.html');
  assert.match(welcome,/Event programme/);
  assert.match(welcome, /class="ask-closed-copy"/);
  assert.match(welcome, /askClosedState\.querySelector\('\.ask-closed-copy'\)\.textContent = 'The Ask a question button will appear when Q&A opens\.'/);
  const program=read('program.html');
  assert.match(program,/Programme details to follow/);
  const ask=read('ask.html');
  assert.match(ask,/Questions are not available for this session yet/);
  assert.match(ask,/Q&A is closed/);
  assert.match(ask, /submitBtn\.textContent = txt\('Отправить вопрос','Submit question'\)/);
  assert.match(ask, /isEnglishEvent \? 'Could not submit the question\. Please try again\.'/);
  assert.match(ask, /txt\('Список участников уточняется\.','Participant list to be confirmed\.'\)/);
});

test('ELINA 28 projector QR uses English only for the accelerator and keeps the canonical guest destination', () => {
  const admin = read('admin-auth.html');
  assert.match(admin, /const QR_PRODUCTION_ORIGIN = 'https:\/\/qna\.sanchez-ai\.ru'/);
  assert.match(admin, /'\/welcome\.html\?event=' \+ encodeURIComponent\(state\.room\.event_key\)/);
  assert.match(admin, /elinaEnglishQr = state\.room\?\.event_key === 'elina-28-2026'/);
  assert.match(admin, /'JOIN THE SESSION'/);
  assert.match(admin, /'Programme · Live Q&A · Audience Choice'/);
  assert.match(admin, /state\.room\?\.event_key \? 'ПРИСОЕДИНЯЙТЕСЬ'/);
  assert.match(admin, /state\.room\?\.event_key \? 'Программа дня и LIVE Q&A'/);
});
