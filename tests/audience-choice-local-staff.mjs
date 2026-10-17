// Provision ONLY users of the ephemeral local Supabase instance used by CI.
// This function must never be used to update a linked or production project.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const values=Object.fromEntries(readFileSync('.audience-supabase-local.env','utf8')
  .split(/\r?\n/)
  .filter(line=>/^[A-Z_]+=/.test(line))
  .map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1).replace(/^["']|["']$/g,'')];}));
const url=new URL(values.API_URL||'');
assert.ok(['127.0.0.1','localhost'].includes(url.hostname),
  'Refusing staff grants outside isolated local Supabase');
assert.equal(url.port,'54321','Unexpected Supabase port: do not provision a remote project');
const PG='postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export function grantLocalAudienceStaff(userId,pollKey){
  assert.match(userId,/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i);
  assert.ok(['elina-28-rehearsal','elina-28-2026'].includes(pollKey));
  const query=String.raw`insert into public.audience_choice_staff(poll_id,user_id)
  select p.id, '${userId}'::uuid from public.audience_choice_polls p
  where p.poll_key='${pollKey}';
  select case when exists(select 1 from public.audience_choice_staff s
    join public.audience_choice_polls p on p.id=s.poll_id
    where s.user_id='${userId}'::uuid and p.poll_key='${pollKey}')
    then 'PASS' else 'FAIL' end;`;
  const result=execFileSync('psql',['-X','-t','-A','-v','ON_ERROR_STOP=1',PG,'-c',query],{encoding:'utf8'});
  assert.ok(result.includes('PASS'),'Isolated operator grant not saved');
}
