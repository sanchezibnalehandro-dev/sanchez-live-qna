// Browser E2E with a REAL isolated local Supabase API and signed-in operator.
// Only the existing unrelated Program/Q&A data layer is stubbed; all Audience
// Choice RPC calls go over HTTP to the real local PostgREST/GoTrue/Postgres.
import { createServer } from 'node:http';
import { readFile, readFileSync } from 'node:fs';
import { readFile as readAsync } from 'node:fs/promises';
import { resolve, extname, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const env = Object.fromEntries(readFileSync('.audience-supabase-local.env', 'utf8')
  .split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x))
  .map(line=>{ const p=line.indexOf('=');return [line.slice(0,p),line.slice(p+1).replace(/^["']|["']$/g,'')]; }));
const API = env.API_URL || 'http://127.0.0.1:54321';
const ANON = env.ANON_KEY;
assert.ok(ANON,'Missing isolated local Supabase anon key');
const root=process.cwd();
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'};
const server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=resolve(root,'.'+pathname);
  if(relative(root,file).startsWith('..')){res.writeHead(403);res.end();return;}
  try{const body=await readAsync(file);res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'});res.end(body);}
  catch{res.writeHead(404);res.end('Not Found');}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const url='http://127.0.0.1:'+server.address().port;

async function rpc(name,args,token=ANON){
  const response=await fetch(API+'/rest/v1/rpc/'+name,{method:'POST',headers:{
    apikey:ANON,authorization:'Bearer '+token,'content-type':'application/json'
  },body:JSON.stringify(args)});
  const raw=await response.text();
  const data=raw?JSON.parse(raw):null;
  if(!response.ok)throw new Error(name+': '+JSON.stringify(data));
  return data;
}
let browser;
try{
  const email='local-e2e-'+randomUUID()+'@example.test';
  const password='Local-'+randomUUID()+'Aa!';
  let resp=await fetch(API+'/auth/v1/signup',{method:'POST',
    headers:{apikey:ANON,'content-type':'application/json'},
    body:JSON.stringify({email,password})});
  assert.equal(resp.ok,true,'Local test user sign-up');
  resp=await fetch(API+'/auth/v1/token?grant_type=password',{method:'POST',
    headers:{apikey:ANON,'content-type':'application/json'},
    body:JSON.stringify({email,password})});
  assert.equal(resp.ok,true,'Local staff login');
  const token=(await resp.json()).access_token;
  assert.ok(token,'Local staff JWT');

  browser=await chromium.launch({headless:true});
  const staff=await browser.newPage({viewport:{width:1280,height:800}});
  await staff.addInitScript(cfg=>{window.__AUDIENCE_LOCAL_CI=cfg;},{api:API,anon:ANON,token});
  staff.on('dialog',dialog=>dialog.accept());
  await staff.goto(url+'/tests/audience-choice-admin-live-fixture.html');
  await staff.locator('#panel').waitFor({state:'visible'});
  await staff.locator('[data-poll-status]').filter({hasText:'DRAFT'}).waitFor({timeout:8000});
  await staff.locator('[data-poll-open]').click();
  await staff.locator('[data-poll-status]').filter({hasText:'OPEN'}).waitFor({timeout:8000});
  assert.equal(await rpc('audience_choice_event_status',{p_event_key:'elina-28-rehearsal'}).then(x=>x.status),'open');

  const guest=await browser.newPage({viewport:{width:390,height:844}});
  await guest.addInitScript(cfg=>{window.__AUDIENCE_LOCAL_CI={api:cfg.api,anon:cfg.anon};},{api:API,anon:ANON});
  const fakeQna=[
    "const cfg=window.__AUDIENCE_LOCAL_CI;",
    "export const supabase={rpc:async(name,args)=>{try{const response=await fetch(cfg.api+'/rest/v1/rpc/'+name,{method:'POST',headers:{'apikey':cfg.anon,'authorization':'Bearer '+cfg.anon,'content-type':'application/json'},body:JSON.stringify(args)});const data=await response.json();return response.ok?{data,error:null}:{data:null,error:data};}catch(error){return {data:null,error}}}};",
    "export function getEventKey(){return new URLSearchParams(location.search).get('event')}",
    "export async function loadGuestEventProgram(){return {items:[],operationalCurrentRoom:null}}",
    "export function subscribeGuestEventProgram(eventKey,ids,refresh,onStatus){onStatus?.('SUBSCRIBED');return ()=>{}}"
  ].join('\n');
  await guest.route('**/supabase-qna.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:fakeQna}));
  const errors=[];
  guest.on('pageerror',e=>errors.push(String(e)));
  await guest.goto(url+'/welcome.html?event=elina-28-rehearsal');
  await guest.locator('#audienceVoteLink').waitFor({state:'visible',timeout:10000});
  await guest.locator('#audienceVoteLink').click();
  await guest.locator('#ownStep').waitFor({state:'visible',timeout:10000});
  await guest.locator('#ownOptions input[value="3"]').check();
  await guest.locator('#continueBtn').click();
  assert.equal(await guest.locator('#voteOptions input').count(),4);
  assert.equal(await guest.locator('#voteOptions input[value="3"]').count(),0);
  await guest.locator('#voteOptions input[value="4"]').check();
  await guest.locator('#submitBtn').click();
  await guest.locator('#completeStep').waitFor({state:'visible',timeout:10000});
  await guest.reload();
  await guest.locator('#completeStep').waitFor({state:'visible',timeout:10000});
  await staff.locator('[data-poll-refresh]').click();
  await staff.locator('[data-poll-winner]').filter({hasText:'Всего голосов: 1'}).waitFor({timeout:10000});

  const state=await rpc('audience_choice_get',{p_poll_key:'elina-28-rehearsal',
    p_guest_id:await guest.evaluate(()=>localStorage.getItem('audience-choice-guest:elina-28-rehearsal'))});
  assert.equal(state.already_voted,true);

  await staff.locator('[data-poll-close]').click();
  await staff.locator('[data-poll-status]').filter({hasText:'CLOSED'}).waitFor({timeout:10000});
  await guest.goto(url+'/welcome.html?event=elina-28-rehearsal');
  await guest.locator('#audienceVoteLink').waitFor({state:'hidden',timeout:10000});
  assert.deepEqual(errors,[],'No guest JavaScript page errors');
  assert.equal((await rpc('audience_choice_event_status',{p_event_key:'elina-28-2026'})).status,'draft',
    'Live poll not affected');
  console.log('PASS: real browser/admin component → authenticated local Supabase Open → guest welcome → two-step vote → DB tally → Close');
}finally{
 await browser?.close();
 await new Promise(ok=>server.close(ok));
}
