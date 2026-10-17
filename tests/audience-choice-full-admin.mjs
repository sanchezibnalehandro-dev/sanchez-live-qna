// Full, real ModeratorLive admin login and guest UI against local Supabase CLI.
// The actual app files (login-auth.html, admin-auth.html, welcome.html, audience-vote.html)
// are loaded unchanged except the CDN SDK dependency is resolved from a local
// same-version bundle and public config is replaced by local test credentials.
// No production Supabase environment or event data is accessed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { grantLocalAudienceStaff } from './audience-choice-local-staff.mjs';

const config = Object.fromEntries(readFileSync('.audience-supabase-local.env','utf8')
  .split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line))
  .map(line=>{const p=line.indexOf('=');return [line.slice(0,p),line.slice(p+1).replace(/^["']|["']$/g,'')];}));
const API=config.API_URL || 'http://127.0.0.1:54321';
const ANON=config.ANON_KEY;
assert.ok(ANON);
const originRoot=process.cwd();
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const source=readFileSync('supabase-qna.js','utf8')
  .replace("from 'https://esm.sh/@supabase/supabase-js@2.116.0'",
           "from './tests/_audience-supabase-sdk.mjs'");
assert.ok(source.includes("from './tests/_audience-supabase-sdk.mjs'"),
  'The app SDK version/import changed: update the test deliberately');
const localConfig =
  'export const SUPABASE_URL='+JSON.stringify(API)+';\n'
  + 'export const SUPABASE_PUBLISHABLE_KEY='+JSON.stringify(ANON)+';\n';

const server=createServer(async(req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=resolve(originRoot,'.'+name);
  if(relative(originRoot,file).startsWith('..')){res.writeHead(403);res.end();return;}
  if(name==='/supabase-qna.js' || name==='/supabase-qna-config.js'){
    res.writeHead(200,{'content-type':'text/javascript'});
    res.end(name==='/supabase-qna.js'?source:localConfig);return;
  }
  try{const data=await readFile(file);
      res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});
      res.end(data);}
  catch{res.writeHead(404);res.end('Not Found');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;

async function signup(email,password){
  const response=await fetch(API+'/auth/v1/signup',{
    method:'POST',headers:{apikey:ANON,'content-type':'application/json'},
    body:JSON.stringify({email,password})
  });
  const result=await response.text();
  assert.ok(response.ok,'local signup: '+result.slice(0,240));
  const user=JSON.parse(result);
  assert.ok(user?.user?.id,'Local signup response did not include user ID');
  return user.user.id;
}

let browser;
try {
  const email='full-admin-'+randomUUID()+'@example.test';
  const password='FullAdmin-'+randomUUID()+'Aa3!';
  const staffId=await signup(email,password);
  grantLocalAudienceStaff(staffId,'elina-28-2026');
  browser=await chromium.launch({headless:true});
  const staff=await browser.newPage({viewport:{width:1440,height:900}});
  const pageErrors=[];
  staff.on('pageerror',err=>pageErrors.push(String(err)));
  // Close deliberately asks for operator confirmation in the production UI.
  staff.on('dialog', dialog => dialog.accept());
  await staff.goto(origin+'/login-auth.html?event=elina-28-2026&next=admin',{waitUntil:'domcontentloaded'});
  await staff.locator('#emailInput').fill(email);
  await staff.locator('#passwordInput').fill(password);
  await staff.locator('#enterBtn').click();
  await staff.waitForURL('**/admin-auth.html?room=elina-28-session',{timeout:15000});
  await staff.locator('#appShell').waitFor({state:'visible',timeout:18000});
  await staff.locator('#audienceChoiceControl').waitFor({state:'visible',timeout:12000});
  await staff.locator('[data-poll-status]').filter({hasText:'DRAFT'}).waitFor({timeout:12000});
  assert.equal(await staff.locator('#eventSessionControl').count(),1,'Existing Q&A session panel must be present');
  assert.equal(await staff.locator('#questionsOpenToggle').count(),1,'Existing Q&A intake must stay intact');
  await staff.locator('[data-poll-open]').click();
  await staff.locator('[data-poll-status]').filter({hasText:'OPEN'}).waitFor({timeout:10000});

  const guest=await browser.newPage({viewport:{width:390,height:844}});
  const guestErrors=[];
  guest.on('pageerror',err=>guestErrors.push(String(err)));
  await guest.goto(origin+'/welcome.html?event=elina-28-2026',{waitUntil:'domcontentloaded'});
  await guest.locator('#programLink').waitFor({state:'visible',timeout:12000});
  await guest.locator('#audienceVoteLink').waitFor({state:'visible',timeout:12000});
  assert.equal(await guest.locator('#programLink').innerText().then(x=>x.includes('Event programme')),true);
  await guest.locator('#audienceVoteLink').click();
  await guest.locator('#ownStep').waitFor({state:'visible',timeout:12000});
  assert.equal(await guest.locator('#ownOptions input').count(),5);
  await guest.locator('#ownOptions input[value="2"]').check();
  await guest.locator('#continueBtn').click();
  assert.equal(await guest.locator('#voteOptions input').count(),4);
  assert.equal(await guest.locator('#voteOptions input[value="2"]').count(),0);
  await guest.locator('#voteOptions input[value="5"]').check();
  await guest.locator('#submitBtn').click();
  await guest.locator('#completeStep').waitFor({state:'visible',timeout:12000});
  await guest.reload();
  await guest.locator('#completeStep').waitFor({state:'visible',timeout:12000});
  await staff.locator('[data-poll-refresh]').click();
  await staff.locator('[data-poll-winner]').filter({hasText:'Всего голосов: 1'}).waitFor({timeout:12000});
  assert.match(await staff.locator('[data-poll-counts]').innerText(),/Team 05: 1/);

  await staff.locator('[data-poll-close]').click();
  await staff.locator('[data-poll-status]').filter({hasText:'CLOSED'}).waitFor({timeout:12000});
  await guest.goto(origin+'/welcome.html?event=elina-28-2026',{waitUntil:'domcontentloaded'});
  await guest.locator('#programLink').waitFor({state:'visible',timeout:12000});
  assert.equal(await guest.locator('#audienceVoteLink').isVisible(),false);
  const another=await browser.newPage({viewport:{width:390,height:844}});
  await another.goto(origin+'/welcome.html?event=test-day-29',{waitUntil:'domcontentloaded'});
  await another.locator('#programLink').waitFor({state:'visible',timeout:12000});
  assert.equal(await another.locator('#audienceVoteLink').isVisible(),false);

  await staff.goto(origin+'/admin-auth.html?room=test-day-29-session',{waitUntil:'domcontentloaded'});
  await staff.locator('#appShell').waitFor({state:'visible',timeout:16000});
  assert.equal(await staff.locator('#audienceChoiceControl').isVisible(),false,'No ELINA voting controls on unrelated event');
  assert.deepEqual(pageErrors,[],'Admin page JS exceptions: '+pageErrors.join('; '));
  assert.deepEqual(guestErrors,[],'Guest page JS exceptions: '+guestErrors.join('; '));
  console.log('PASS: REAL login-auth + full admin-auth + event Q&A + guest welcome + real vote + tally + close + unrelated event isolation');
}finally{
  await browser?.close();
  await new Promise(done=>server.close(done));
}
