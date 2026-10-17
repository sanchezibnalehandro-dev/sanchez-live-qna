import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, relative } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(root, '.' + pathname);
  if (relative(root,file).startsWith('..')) { response.writeHead(403); response.end(); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(done => server.listen(0,'127.0.0.1',done));
const origin = 'http://127.0.0.1:' + server.address().port;

const fakeQnaModule = [
"export function getEventKey() { return new URLSearchParams(location.search).get('event') }",
"export async function loadGuestEventProgram(eventKey) {",
"  if (!['test-day-29','test-day-30'].includes(eventKey)) return {items:[], operationalCurrentRoom:null};",
"  const id = eventKey === 'test-day-29' ? 29 : 30;",
"  return { items:[{id,kind:'session',title:'A separate day',room_id:id,is_current:true,session_order:1,duration_minutes:60,starts_at:'2026-10-29T12:00:00+03:00'}],",
"    operationalCurrentRoom:{id,is_questions_open:true} };",
"}",
"export function subscribeGuestEventProgram(eventKey, getRooms, refresh, setStatus) { setStatus?.('SUBSCRIBED'); return ()=>{} }",
"export const supabase = {",
"  async rpc(name, args) {",
"    const key = name === 'audience_choice_event_status' ? args.p_event_key : args.p_poll_key;",
"    const configured = ['elina-28-rehearsal','elina-28-2026'].includes(key);",
"    const status = localStorage.getItem('__test_poll_status') || 'draft';",
"    const voted = localStorage.getItem('__test_vote') !== null;",
"    if (name === 'audience_choice_event_status') return {data:configured?{status,poll_key:key}:null,error:null};",
"    if (name === 'audience_choice_get') return {data:configured?{status,title:'ELINA 28',already_voted:voted}:null,error:null};",
"    if (name === 'audience_choice_submit') {",
"      if (status !== 'open') return {data:null,error:{message:'Voting is closed'}};",
"      if (voted) return {data:false,error:null};",
"      if (args.p_team_no === args.p_own_team || args.p_team_no < 1 || args.p_team_no > 5) return {data:null,error:{message:'Invalid team choice'}};",
"      localStorage.setItem('__test_vote', JSON.stringify(args));return {data:true,error:null};",
"    }",
"    return {data:null,error:{message:'Unexpected RPC ' + name}};",
"  }",
"};"
].join('\n');

let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:375,height:812}});
  page.on('pageerror', error => { throw error; });
  await page.route('**/supabase-qna.js', route=>route.fulfill({status:200,contentType:'text/javascript',body:fakeQnaModule}));

  await page.goto(origin+'/welcome.html?event=elina-28-rehearsal');
  await page.locator('#programLink').waitFor({state:'visible'});
  assert.equal(await page.locator('#audienceVoteLink').isVisible(),false,'Vote hidden before Open');
  await page.evaluate(()=>localStorage.setItem('__test_poll_status','open'));
  await page.locator('#audienceVoteLink').waitFor({state:'visible',timeout:9000});
  await page.locator('#audienceVoteLink').click();

  await page.locator('#ownStep').waitFor({state:'visible'});
  assert.equal(await page.locator('#ownOptions input').count(),5);
  await page.locator('#ownOptions input[value="2"]').check();
  await page.locator('#continueBtn').click();
  await page.locator('#voteStep').waitFor({state:'visible'});
  assert.equal(await page.locator('#voteOptions input').count(),4);
  assert.equal(await page.locator('#voteOptions input[value="2"]').count(),0,'Own team must be absent');
  await page.locator('#voteOptions input[value="3"]').check();
  await page.locator('#submitBtn').click();
  await page.locator('#completeStep').waitFor({state:'visible'});
  const recorded=await page.evaluate(()=>JSON.parse(localStorage.getItem('__test_vote')));
  assert.equal(recorded.p_own_team,2);assert.equal(recorded.p_team_no,3);

  await page.reload();
  await page.locator('#completeStep').waitFor({state:'visible'});
  assert.equal(await page.locator('#voteStep').isVisible(),false,'Cannot vote again');

  await page.goto(origin+'/welcome.html?event=elina-28-rehearsal');
  await page.locator('#audienceVoteLink').waitFor({state:'visible',timeout:9000});
  await page.evaluate(()=>localStorage.setItem('__test_poll_status','closed'));
  await page.locator('#audienceVoteLink').waitFor({state:'hidden',timeout:9000});
  // Reuse the same phone and same browser storage on two additional days.
  // These keys are synthetic fixtures, not claimed to be real 29/30 event keys.
  for (const [day, roomId] of [['test-day-29', 29], ['test-day-30', 30]]) {
    await page.goto(origin+'/welcome.html?event='+day);
    await page.locator('#programLink').waitFor({state:'visible'});
    await page.locator('#askLink').waitFor({state:'visible'});
    assert.equal(await page.locator('#audienceVoteLink').isVisible(),false,'No ELINA voting on '+day);
    assert.ok((await page.locator('#programLink').getAttribute('href')).includes(day),'Program URL must stay event-scoped');
    assert.ok((await page.locator('#askLink').getAttribute('href')).includes(day),'Q&A URL must stay event-scoped');
  }
  await page.goto(origin+'/welcome.html?event=elina-28-rehearsal');
  await page.locator('#programLink').waitFor({state:'visible'});
  assert.equal(await page.locator('#audienceVoteLink').isVisible(),false,'Elina vote remains closed after visiting other days');
  console.log('PASS: same-browser three-day isolation, guest Q&A, program and vote visibility');

  const staff=await browser.newPage();
  staff.on('dialog', d => d.accept());
  await staff.goto(origin+'/tests/audience-choice-admin-fixture.html');
  await staff.locator('#panel').waitFor({state:'visible'});
  await staff.locator('[data-poll-status]').filter({hasText:'DRAFT'}).waitFor();
  await staff.locator('[data-poll-open]').click();
  await staff.locator('[data-poll-status]').filter({hasText:'OPEN'}).waitFor();
  await staff.locator('[data-poll-close]').click();
  await staff.locator('[data-poll-status]').filter({hasText:'CLOSED'}).waitFor();
  await staff.locator('[data-poll-winner]').filter({hasText:'НИЧЬЯ'}).waitFor();
  console.log('PASS: embedded operator open/close, private counts and tie');
} finally {
  await browser?.close();
  await new Promise(done=>server.close(done));
}