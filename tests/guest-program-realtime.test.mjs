import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

function extractFunction(source, name) {
  const marker = `export function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1).replace(/^export\s+/, '');
  }
  throw new Error(`Could not extract ${name}`);
}

function wait(milliseconds = 125) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

test('G/H: guest program subscription reconciles, coalesces and ignores disposed callbacks', async () => {
  const source = await readFile(new URL('../supabase-qna.js', import.meta.url), 'utf8');
  const functionSource = extractFunction(source, 'subscribeGuestEventProgram');
  const listeners = [];
  let statusCallback = null;
  let removed = 0;
  const channel = {
    on(type, filter, callback) {
      listeners.push({ type, filter, callback });
      return this;
    },
    subscribe(callback) {
      statusCallback = callback;
      return this;
    }
  };
  const supabase = {
    channel() { return channel; },
    removeChannel(value) {
      assert.equal(value, channel);
      removed += 1;
    }
  };
  const context = { supabase, setTimeout, clearTimeout, console };
  vm.runInNewContext(`${functionSource}\nglobalThis.subscribeGuestEventProgram = subscribeGuestEventProgram;`, context);

  let refreshes = 0;
  const statuses = [];
  const unsubscribe = context.subscribeGuestEventProgram(
    'event-a',
    () => new Set(['11']),
    () => { refreshes += 1; },
    status => statuses.push(status)
  );

  assert.deepEqual(listeners.map(entry => entry.filter.table), [
    'qna_rooms',
    'qna_event_program_items',
    'qna_speakers'
  ]);
  assert.equal(listeners[0].filter.filter, 'event_key=eq.event-a');

  statusCallback('SUBSCRIBED');
  await wait();
  assert.deepEqual(statuses, ['SUBSCRIBED']);
  assert.equal(refreshes, 1, 'SUBSCRIBED must reconcile with a fetch');

  const programListener = listeners[1].callback;
  programListener({ eventType: 'UPDATE', new: { event_key: 'other-event' } });
  await wait();
  assert.equal(refreshes, 1, 'another event must not refresh this page');

  programListener({ eventType: 'UPDATE', new: { event_key: 'event-a' } });
  programListener({ eventType: 'UPDATE', new: { event_key: 'event-a' } });
  await wait();
  assert.equal(refreshes, 2, 'program order/duration signals must coalesce');

  listeners[0].callback({ eventType: 'UPDATE', new: { event_key: 'event-a' } });
  await wait();
  assert.equal(refreshes, 3, 'operational current room changes must refresh');

  const speakerListener = listeners[2].callback;
  speakerListener({ eventType: 'UPDATE', new: { room_id: 99 } });
  await wait();
  assert.equal(refreshes, 3, 'unrelated speaker changes must be ignored');
  speakerListener({ eventType: 'DELETE', old: { id: 5 } });
  await wait();
  assert.equal(refreshes, 4, 'incomplete DELETE payload must reconcile conservatively');

  unsubscribe();
  programListener({ eventType: 'DELETE', old: { id: 2 } });
  await wait();
  assert.equal(refreshes, 4, 'disposed callbacks must not refresh');
  assert.equal(removed, 1);
});
