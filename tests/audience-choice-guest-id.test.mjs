import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../audience-vote.html', import.meta.url), 'utf8');
const start = source.indexOf('function guestSessionId(key) {');
const end = source.indexOf('function optionLabel(', start);
assert.ok(start >= 0 && end > start);
const functionSource = source.slice(start, end);

function session(crypto, storage) {
  const context = { crypto, localStorage: storage, Uint8Array };
  vm.runInNewContext(`${functionSource}\nglobalThis.guestSessionId = guestSessionId;`, context);
  return context.guestSessionId;
}

test('older Safari without randomUUID creates and persists a valid v4 guest ID', () => {
  const saved = new Map();
  const storage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value)
  };
  const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);
  const guestSessionId = session({ getRandomValues: target => (target.set(bytes), target) }, storage);
  const id = guestSessionId('poll-a');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(saved.get('audience-choice-guest:poll-a'), id);
  assert.equal(guestSessionId('poll-a'), id, 'reload must reuse the same vote identity');
});

test('existing ID remains usable without either UUID API', () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  const guestSessionId = session({}, { getItem: () => id, setItem: () => assert.fail('must not overwrite ID') });
  assert.equal(guestSessionId('poll-a'), id);
});

test('storage failure does not create an unpersisted identity', () => {
  const guestSessionId = session({ randomUUID: () => '12345678-1234-4234-8234-123456789abc' }, {
    getItem: () => null,
    setItem: () => { throw new Error('storage disabled'); }
  });
  assert.equal(guestSessionId('poll-a'), null);
});
