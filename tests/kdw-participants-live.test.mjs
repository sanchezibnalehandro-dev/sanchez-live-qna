import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const html = await readFile(new URL('../participants.html', import.meta.url), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);

test('KDW missing schedule shows 2026 without inventing a day or displaying 1970', () => {
  const start = script.indexOf('function formatDateTime(item) {');
  const end = script.indexOf('function createMember(', start);
  assert.ok(start >= 0 && end > start);
  const format = vm.runInNewContext(`${script.slice(start, end)}; formatDateTime`);
  for (const starts_at of [null, undefined, '', 'invalid']) {
    assert.deepEqual({ ...format({ starts_at }) }, {
      date: '2026 · дата уточняется', time: 'Время уточняется'
    });
  }
  assert.equal(format({ starts_at: '2026-10-28T12:00:00Z', duration_minutes: 60 }).date, '28 октября 2026 г.');
});

function element() {
  const classes = new Set();
  return {
    hidden: false,
    textContent: '',
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    setAttribute() {}, removeAttribute() {},
    append(...children) { this.children = [...(this.children || []), ...children]; },
    replaceChildren(...children) { this.children = children; }
  };
}

test('open KDW page follows operator changes without reload and gates Q&A on open intake', async () => {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  let onChange;
  let unsubscribed = 0;
  const events = {};
  const page = {
    items: [{ kind: 'session', mode: 'panel', room_id: 11, title: 'Панель',
      starts_at: '2026-10-28T12:00:00Z', duration_minutes: 60,
      moderator_name: 'Первый модератор', speakers: [{ name: 'Первый участник' }] }],
    operationalCurrentRoom: null
  };
  const context = {
    document: {
      getElementById: get,
      createElement: element,
      createDocumentFragment: element,
      body: { classList: element().classList },
      addEventListener: (name, callback) => { events[name] = callback; },
      hidden: false
    },
    window: { addEventListener: (name, callback) => { events[name] = callback; } },
    getEventKey: () => 'kdw-2026-finokhin', getBrandForRoute: () => ({}),
    applyBrandIdentity() {},
    loadGuestEventProgram: async () => structuredClone(page),
    subscribeGuestEventProgram: (key, ids, callback) => {
      assert.equal(key, 'kdw-2026-finokhin');
      onChange = callback;
      return () => { unsubscribed += 1; };
    },
    setTimeout, clearTimeout, console
  };
  vm.runInNewContext(script.replace(/^\s*import .*;\s*$/gm, ''), context);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  await settle();
  assert.equal(get('askLink').hidden, true);

  page.items[0].moderator_name = 'Новый модератор';
  page.items[0].speakers = [{ name: 'Новый участник' }];
  page.operationalCurrentRoom = { id: 11, is_questions_open: true };
  onChange();
  await settle();
  assert.equal(get('moderatorName').textContent, 'Новый модератор');
  assert.equal(get('participantGrid').children[0].children[0].children[0].children[1].textContent, 'Новый участник');
  assert.equal(get('askLink').hidden, false);

  page.operationalCurrentRoom.is_questions_open = false;
  events.visibilitychange();
  await settle();
  assert.equal(get('askLink').hidden, true);
  events.pagehide({ persisted: false });
  assert.equal(unsubscribed, 1);
});
