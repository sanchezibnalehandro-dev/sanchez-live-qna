import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const brand = await readFile(new URL('../brand.js',import.meta.url),'utf8');
const page = await readFile(new URL('../mod-auth.html',import.meta.url),'utf8');
const css = await readFile(new URL('../brands/kod-rosta-2026.css',import.meta.url),'utf8');

const stripped=brand.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=(?:const|function|async|class))/g,'');
const context={};
vm.runInNewContext([
  'const TASIGO_ESG_BRAND={key:"tasigo-esg"};',
  'const ELINA_28_BRAND={key:"elina-28"};',
  'const KDW_2026_BRAND={key:"kdw-2026"};',
  stripped,
  'globalThis.route=getBrandForRoute;'
].join('\n'),context,{timeout:1000});
const route=context.route;

test('only Kod Rosta event and its rooms receive the new brand',()=>{
 const event=route(null,'kod-rosta-2026');
 const room=route('kod-rosta-2026-defense-1',null);
 assert.equal(event.key,'kod-rosta-2026');
 assert.equal(event.stylesheetHref,'./brands/kod-rosta-2026.css');
 assert.equal(event.name,'КОД РОСТА · 2026');
 assert.equal(room.key,event.key);
 assert.equal(route(null,'tasigo-esg-2026').key,'tasigo-esg');
 assert.equal(route('elina-28-session',null).key,'elina-28');
 assert.equal(route('kdw-2026-finokhin','kdw-2026-finokhin').key,'kdw-2026');
 assert.equal(route('sanchez-live',null).key,'sanchez');
 assert.equal(route(null,'kod-rosta-2026-unrelated').key,'sanchez');
});

const earlyScripts=[...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(earlyScripts.length,2,'Moderator bootstraps brand in two ordinary head scripts');

function headTheme(search){
 const link={href:''};
 const document={
  documentElement:{dataset:{},style:{}},
  querySelector:selector=>selector==='[data-brand-stylesheet]'?link:null
 };
 const ctx={document,location:{search},URLSearchParams};
 for(const source of earlyScripts)vm.runInNewContext(source,ctx,{timeout:1000});
 return {brand:document.documentElement.dataset.brand,background:document.documentElement.style.backgroundColor,href:link.href};
}

test('moderator first paint and module choose the SAME Kod Rosta stylesheet',()=>{
 const event=headTheme('?event=kod-rosta-2026');
 assert.equal(event.brand,'kod-rosta-2026');
 assert.equal(event.href,'./brands/kod-rosta-2026.css');
 assert.equal(event.background,'#090f0f');
 const direct=headTheme('?room=kod-rosta-2026-panel');
 assert.equal(direct.brand,event.brand);
 assert.equal(direct.href,event.href);
});
test('other events stay on their own existing stylesheet from first paint',()=>{
 for(const [query,brand,href] of [
  ['?event=tasigo-esg-2026','tasigo-esg','./brands/tasigo-esg.css'],
  ['?event=elina-28-2026','elina-28','./brands/elina-28.css'],
  ['?event=kdw-2026-finokhin','kdw-2026','./brands/kdw-2026.css'],
  ['?room=sanchez-live','sanchez','./brands/sanchez.css']
 ]){
  const theme=headTheme(query);
  assert.equal(theme.brand,brand,query);
  assert.equal(theme.href,href,query);
 }
});

test('Kod Rosta styling uses the Event Guide emerald/lime palette with scoped selectors',()=>{
 assert.match(css,/^@import url\('\.\/sanchez\.css'\);/);
 assert.match(css,/html\[data-brand="kod-rosta-2026"\]/);
 assert.match(css,/--color-accent:\s*#c5f18e;/);
 assert.match(css,/--color-bg:\s*var\(--bg\);/);
 assert.match(css,/--color-text-on-accent:\s*#142417;/);
 assert.match(css,/\.filter-tab\.active/);
 assert.match(css,/\.question-sort-btn\.active/);
 assert.match(css,/\.question-card\.is-pending/);
 assert.match(page,/import \{ applyBrandIdentity, getBrandForRoute \} from '\.\/brand\.js'/);
});
