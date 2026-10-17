// Isolated local Supabase integration: real GoTrue sign-in + PostgREST + PostgreSQL.
// Read only local CLI-generated development keys, never production secrets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const entries = Object.fromEntries(
  readFileSync('.audience-supabase-local.env', 'utf8')
    .split(/\r?\n/)
    .filter(line => /^[A-Z_]+=/.test(line))
    .map(line => {
      const sep = line.indexOf('=');
      return [line.slice(0, sep), line.slice(sep + 1).replace(/^["']|["']$/g, '')];
    })
);
const origin = entries.API_URL || 'http://127.0.0.1:54321';
const anon = entries.ANON_KEY;
assert.ok(anon, 'Missing local development ANON_KEY from Supabase CLI');

async function request(path, payload, token = anon, retries = 0) {
  const url = origin + path;
  const headers = { apikey: anon, authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const raw = await response.text();
    const body = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
    if (response.status === 404 && attempt < retries) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    return { ok: response.ok, status: response.status, data: body };
  }
  throw new Error('Request retry logic exhausted');
}
function check(result, message) {
  assert.ok(result.ok, message + ': status ' + result.status + ' / ' + JSON.stringify(result.data).slice(0, 280));
  return result.data;
}
const poll = 'elina-28-rehearsal';
const statusArgs = { p_event_key: poll };
const pollArgs = { p_poll_key: poll };

let state = check(await request('/rest/v1/rpc/audience_choice_event_status', statusArgs, anon, 15), 'Get event state');
assert.equal(state.status, 'draft');

const email = 'audience-e2e-' + randomUUID() + '@example.test';
const password = 'E2e!' + randomUUID() + 'Aa3';
check(await request('/auth/v1/signup', { email, password }), 'Sign up local operator');
const auth = check(await request('/auth/v1/token?grant_type=password', { email, password }), 'Sign in local operator');
assert.ok(auth?.access_token, 'No access token returned by local Supabase Auth');
const staff = auth.access_token;

let denied = await request('/rest/v1/rpc/audience_choice_admin_state', pollArgs);
assert.ok(!denied.ok, 'Anonymous guest must not read admin tally');
denied = await request('/rest/v1/rpc/audience_choice_admin_status', {...pollArgs, p_status:'open'});
assert.ok(!denied.ok, 'Anonymous guest must not control a poll');

state = check(await request('/rest/v1/rpc/audience_choice_admin_state', pollArgs, staff), 'Staff reads poll');
assert.equal(state.status, 'draft');

let result = check(await request('/rest/v1/rpc/audience_choice_admin_status', { ...pollArgs, p_status: 'open' }, staff), 'Staff opens poll');
assert.equal(result, 'open');
state = check(await request('/rest/v1/rpc/audience_choice_event_status', statusArgs), 'Guest sees open state');
assert.equal(state.status, 'open');

const guestId = randomUUID();
const voteArgs = { ...pollArgs, p_guest_id: guestId, p_own_team: 1, p_team_no: 2 };
const ownVote = await request('/rest/v1/rpc/audience_choice_submit', { ...voteArgs, p_team_no: 1 });
assert.ok(!ownVote.ok, 'Self-voting must be rejected by the API');

const submissions = await Promise.all([
  request('/rest/v1/rpc/audience_choice_submit', voteArgs),
  request('/rest/v1/rpc/audience_choice_submit', voteArgs)
]);
assert.deepEqual(submissions.map(r => check(r, 'Concurrent vote')).sort(), [false, true], 'A browser submits only one vote');

result = check(await request('/rest/v1/rpc/audience_choice_get', { ...pollArgs, p_guest_id: guestId }), 'Guest gets already-voted flag');
assert.equal(result.already_voted, true);

check(await request('/rest/v1/rpc/audience_choice_submit', {
  ...pollArgs, p_guest_id: randomUUID(), p_own_team: 3, p_team_no: 3
}).then(result => { assert.equal(result.ok, false); return { ok: true, status: 200, data: null }; }), 'Self vote blocked for second guest');

assert.equal(check(await request('/rest/v1/rpc/audience_choice_submit', {
  ...pollArgs, p_guest_id: randomUUID(), p_own_team: 5, p_team_no: 3
}), 'Second guest votes'), true);

const counts = check(await request('/rest/v1/rpc/audience_choice_admin_state', pollArgs, staff), 'Staff gets final tally');
assert.equal(counts.counts.length, 5);
assert.equal(counts.counts.reduce((sum, row) => sum + Number(row.votes), 0), 2);
assert.equal(Number(counts.counts.find(x => Number(x.team_no) === 2).votes), 1);
assert.equal(Number(counts.counts.find(x => Number(x.team_no) === 3).votes), 1);

const other = check(await request('/rest/v1/rpc/audience_choice_event_status', { p_event_key: 'elina-28-2026' }), 'Other poll untouched');
assert.equal(other.status, 'draft');

result = check(await request('/rest/v1/rpc/audience_choice_admin_status', { ...pollArgs, p_status: 'closed' }, staff), 'Staff closes poll');
assert.equal(result, 'closed');
const late = await request('/rest/v1/rpc/audience_choice_submit', {
  ...pollArgs, p_guest_id: randomUUID(), p_own_team: 4, p_team_no: 5
});
assert.ok(!late.ok, 'Closed poll must reject new votes');

// Event-switch contract: any signed-in ModeratorLive account manages every
// event without a per-poll operator grant or independent staff role.
const secondEmail='another-staff-'+randomUUID()+'@example.test';
const secondPassword='E2e!'+randomUUID()+'Bb4';
check(await request('/auth/v1/signup',{email:secondEmail,password:secondPassword}),'Create second signed-in account');
const secondAuth=check(await request('/auth/v1/token?grant_type=password',{
  email:secondEmail,password:secondPassword
}),'Sign in second account');
const otherStaff=secondAuth.access_token;
assert.ok(otherStaff && otherStaff!==staff,'Second user must have their own session');
const liveArgs={p_poll_key:'elina-28-2026'};
const liveOpened=check(await request('/rest/v1/rpc/audience_choice_admin_status',{
  ...liveArgs,p_status:'open'
},staff),'First signed-in account opens a different event');
assert.equal(liveOpened,'open');
const anotherStaffState=check(await request('/rest/v1/rpc/audience_choice_admin_state',
  liveArgs,otherStaff),'Another signed-in account reads that event');
assert.equal(anotherStaffState.status,'open');
assert.equal(anotherStaffState.counts.reduce((n,x)=>n+Number(x.votes),0),0);
const liveClosed=check(await request('/rest/v1/rpc/audience_choice_admin_status',{
  ...liveArgs,p_status:'closed'
},otherStaff),'Another signed-in account closes that event');
assert.equal(liveClosed,'closed');
assert.equal(check(await request('/rest/v1/rpc/audience_choice_event_status',
  statusArgs),'Rehearsal state independent').status,'closed');
const direct = await fetch(origin + '/rest/v1/audience_choice_votes?select=id', {
  headers: { apikey: anon, authorization: 'Bearer ' + anon }
});
assert.ok(!direct.ok, 'Anon must not read private voting table');

console.log('PASS: real Supabase HTTP, any signed-in account controls both event polls with no extra role, anon denied, votes, closed-state and isolation.');
