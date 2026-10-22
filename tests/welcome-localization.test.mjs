import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { deriveGuestProgramState, PROGRAM_HERO_STATE } from '../guest-program-state.mjs';
import { ELINA_28_EVENT_KEYS, voteButtonVisible } from '../audience-choice-flow.mjs';

const html = await readFile(new URL('../welcome.html', import.meta.url), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const decode = value => value.replaceAll('&amp;', '&');

// Build only the DOM surface used by welcome from its real markup. In particular,
// querySelector('span') must return the icon before the explanatory copy.
function element(markup = '') {
  let innerHTML = markup;
  const children = [...markup.matchAll(/<(span|strong)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
    .map(([, tag, attributes, content]) => ({
      tag, classes: attributes.match(/class="([^"]*)"/)?.[1].split(' ') || [],
      node: element(content)
    }));
  return {
    hidden: false, dataset: {},
    classList: { add() {}, remove() {} },
    removeAttribute() {}, setAttribute() {},
    get innerHTML() { return innerHTML; },
    get textContent() { return decode(innerHTML.replace(/<[^>]*>/g, '')); },
    set textContent(value) { innerHTML = String(value); },
    querySelector(selector) {
      return children.find(child => selector.startsWith('.')
        ? child.classes.includes(selector.slice(1)) : child.tag === selector)?.node || null;
    }
  };
}

async function welcome(eventKey) {
  const nodes = new Map();
  for (const [, attributes, id] of html.matchAll(/<\w+\b([^>]*\bid="([^"]*)"[^>]*)>/g)) {
    const node = element();
    node.hidden = /\bhidden\b/.test(attributes);
    nodes.set(id, node);
  }
  for (const id of ['askLink', 'askClosedState', 'programLink']) {
    const match = html.match(new RegExp(`<([a-z]+)\\b([^>]*id="${id}"[^>]*)>([\\s\\S]*?)<\\/\\1>`));
    assert.ok(match, `${id} must exist`);
    const node = element(match[3]);
    node.hidden = /\bhidden\b/.test(match[2]);
    nodes.set(id, node);
  }
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const events = {};
  let changed;
  let unsubscribed = false;
  const snapshot = {
    items: [{ id: 1, kind: 'session', room_id: 11, title: 'Session', is_current: true }],
    operationalCurrentRoom: null
  };
  const document = {
    documentElement: { lang: 'ru' }, body: element(), getElementById: get,
    addEventListener() {}
  };
  vm.runInNewContext(script.replace(/^\s*import .*;\s*$/gm, ''), {
    document, window: { addEventListener: (name, callback) => { events[name] = callback; } },
    getEventKey: () => eventKey, getBrandForRoute: () => ({}), applyBrandIdentity() {},
    deriveGuestProgramState, PROGRAM_HERO_STATE, ELINA_28_EVENT_KEYS, voteButtonVisible,
    loadGuestEventProgram: async () => structuredClone(snapshot),
    subscribeGuestEventProgram: (key, ids, callback) => {
      assert.equal(key, eventKey);
      changed = callback;
      return () => { unsubscribed = true; };
    },
    supabase: { rpc: async () => ({ data: { status: 'draft' }, error: null }) },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    console: { warn() {}, error: error => { throw error; } }
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  return { get, document, async setOpen(open) {
    snapshot.operationalCurrentRoom = { id: 11, is_questions_open: open };
    changed();
    await settle();
  }, close() {
    events.pagehide({ persisted: false });
    assert.equal(unsubscribed, true);
  } };
}

for (const [event, lang, heading, copy, destination] of [
  ['elina-28-2026', 'en', 'Q&A is currently closed', 'The Ask a question button will appear when Q&A opens.', 'program'],
  ['elina-28-rehearsal', 'ru', 'Q&A пока закрыт', 'Когда Q&A откроется, здесь появится кнопка «Задать вопрос».', 'program'],
  ['kdw-2026-finokhin', 'ru', 'Q&A пока закрыт', 'Когда Q&A откроется, здесь появится кнопка «Задать вопрос».', 'participants']
]) {
  test(`${event}: localizes closed Q&A copy, preserves SVG and toggles intake`, async () => {
    const page = await welcome(event);
    const closed = page.get('askClosedState');
    const assertCopy = () => {
      assert.equal(page.document.documentElement.lang, lang);
      assert.equal(closed.querySelector('strong').textContent, heading);
      assert.equal(closed.querySelector('.ask-closed-copy').textContent, copy);
      assert.match(closed.querySelector('.kdw-action-icon').innerHTML, /<svg\b/);
      assert.equal(page.get('askLink').href, `./ask.html?event=${event}`);
      assert.equal(page.get('programLink').href, `./${destination}.html?event=${event}`);
    };
    try {
      assertCopy();
      for (const open of [false, true, false]) {
        await page.setOpen(open);
        assert.equal(closed.hidden, open);
        assert.equal(page.get('askLink').hidden, !open);
        assertCopy();
      }
    } finally { page.close(); }
  });
}
