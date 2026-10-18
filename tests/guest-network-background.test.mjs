// Run with: node --test tests/guest-network-background.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const source = read('guest-network-background.js');
const { initGuestNetworkBackground, GUEST_NETWORK_PRESETS } = await import(
  'data:text/javascript;charset=utf-8,' + encodeURIComponent(source)
);

function fixture(brand, backgroundColor, mobile = false, reducedMotion = true) {
  const children = [];
  const classes = new Set();
  const ctx = {
    fills: [],
    setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, arc() {}, fill() {},
    fillRect() { this.fills.push(this.fillStyle); }
  };
  const doc = {
    documentElement: { dataset: { brand } },
    hidden: false,
    body: {
      dataset: {},
      classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); } },
      prepend(el) { children.unshift(el); }
    },
    createElement(tag) {
      return {
        tag, id: '', style: {}, className: '', attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        getContext() { return ctx; },
        remove() { const index = children.indexOf(this); if (index >= 0) children.splice(index, 1); }
      };
    },
    getElementById(id) { return children.find(el => el.id === id) || null; },
    addEventListener() {}, removeEventListener() {}
  };
  const media = { addEventListener() {}, removeEventListener() {} };
  const win = {
    innerWidth: mobile ? 390 : 1440, innerHeight: 900, devicePixelRatio: 2,
    matchMedia(query) {
      return { ...media, matches: query.includes('max-width') ? mobile : reducedMotion };
    },
    addEventListener() {}, removeEventListener() {}
  };
  const original = ['document', 'window', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']
    .map(name => [name, globalThis[name]]);
  let animationFrames = 0;
  globalThis.document = doc;
  globalThis.window = win;
  globalThis.getComputedStyle = () => ({
    getPropertyValue(name) {
      return { '--color-bg': backgroundColor, '--color-accent': '#2288dd',
        '--color-accent-hover': '#55aaff', '--color-accent-active-text': '#ddeeff' }[name] || '';
    }
  });
  globalThis.requestAnimationFrame = () => ++animationFrames;
  globalThis.cancelAnimationFrame = () => {};
  return {
    children, classes, ctx, doc,
    get animationFrames() { return animationFrames; },
    restore() {
      for (const [name, value] of original) {
        if (value === undefined) delete globalThis[name];
        else globalThis[name] = value;
      }
    }
  };
}

test('same renderer supports all four branded guest views and cleans up', () => {
  const cases = [
    ['sanchez', '#020810', false],
    ['tasigo-esg', '#101612', true],
    ['elina-28', '#080d15', true],
    ['kdw-2026', '#08292d', false]
  ];
  for (const [brand, background, mobile] of cases) {
    const f = fixture(brand, background, mobile);
    try {
      const dispose = initGuestNetworkBackground('questions');
      assert.equal(f.children.length, 2, brand);
      assert.equal(f.doc.body.dataset.guestNetworkSurface, 'questions');
      assert.ok(f.classes.has('guest-network-enabled'));
      assert.equal(f.ctx.fills[0], background, brand);
      initGuestNetworkBackground('questions');
      assert.equal(f.children.length, 2, 'must not mount twice');
      assert.equal(f.animationFrames, 0, 'reduced motion is static');
      dispose();
      assert.equal(f.children.length, 0);
      assert.equal(f.classes.has('guest-network-enabled'), false);
    } finally {
      f.restore();
    }
  }
});

test('animation can run when reduced-motion is off; unavailable surfaces do nothing', () => {
  const f = fixture('elina-28', '#080d15', true, false);
  try {
    const noOp = initGuestNetworkBackground('admin');
    assert.equal(f.children.length, 0);
    noOp();
    const dispose = initGuestNetworkBackground('welcome');
    assert.ok(f.animationFrames > 0);
    dispose();
  } finally {
    f.restore();
  }
});

test('guest pages use the shared entry; admin, moderator and login stay untouched', () => {
  for (const page of ['welcome.html', 'ask.html', 'program.html']) {
    assert.match(read(page), /initGuestNetworkBackground/);
    assert.match(read(page), /guest-network-background\\.css/);
    assert.doesNotMatch(read(page), /kdw-guest-background\\.js/);
  }
  for (const page of ['admin-auth.html', 'mod-auth.html', 'login-auth.html']) {
    assert.doesNotMatch(read(page), /initGuestNetworkBackground/);
  }
  assert.equal(GUEST_NETWORK_PRESETS['kdw-2026'].density, 62);
  assert.equal(GUEST_NETWORK_PRESETS['tasigo-esg'].glow, 28);
});
