import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const names = [
  'normalizeQuestion', 'cleanOptional',
  'submitGuestQuestion', 'addVote', 'removeVote',
  'moderateQuestionStatus', 'moderateQuestionPinned', 'setCurrentEventSession'
];

function extractFunction(source, name) {
  const marker = `export ${['normalizeQuestion','cleanOptional'].includes(name) ? '' : 'async '}function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') depth--;
    if (depth === 0) return source.slice(start, index + 1).replace(/^export\s+/, '');
  }
  throw new Error(`Unterminated function: ${name}`);
}

async function harness(handler = async () => ({ data: null, error: null })) {
  const source = await readFile(new URL('../supabase-qna.js', import.meta.url), 'utf8');
  const calls = [];
  const context = {
    supabase: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return handler(name, args);
      },
      from: () => { throw new Error('Critical guest/moderator operation must use scoped RPC'); }
    }
  };
  const script = names.map(name => extractFunction(source, name)).join('\n') +
    '\nObject.assign(globalThis, {' + names.join(', ') + '});';
  vm.runInNewContext(script, context);
  return { calls, context };
}

test('guest submission normalizes input and uses guarded database RPC', async () => {
  const { context, calls } = await harness(async () => ({ data: [{ id: 7, status: 'pending' }], error: null }));
  const result = await context.submitGuestQuestion({
    roomId: 32, speakerId: 6, text: '  Вопрос   спикеру?  ',
    authorName: '  Анна   ', authorCompany: '', sessionId: 'local-session-123'
  });
  assert.equal(result.id, 7);
  assert.equal(result.status, 'pending');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'submit_guest_question');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), {
    p_room_id: 32, p_speaker_id: 6, p_text: 'Вопрос спикеру?',
    p_author_name: 'Анна', p_author_company: null, p_session_id: 'local-session-123'
  });
});

test('vote toggle uses server-side scoped functions and propagates failures', async () => {
  const { context, calls } = await harness();
  await context.addVote(999, 'guest-session');
  await context.removeVote(999, 'guest-session');
  assert.deepEqual(calls.map(x => x.name), ['add_vote', 'remove_vote']);
  for (const call of calls) {
    assert.deepEqual(JSON.parse(JSON.stringify(call.args)), { p_question_id: 999, p_session_id: 'guest-session' });
  }
  const error = new Error('VOTE_NOT_ALLOWED');
  const rejecting = await harness(async () => ({ data: null, error }));
  await assert.rejects(rejecting.context.addVote(999, 'guest-session'), error);
  await assert.rejects(rejecting.context.removeVote(999, 'guest-session'), error);
});

test('moderation keeps both room and question ids on the server RPC', async () => {
  const { context, calls } = await harness(async () => ({
    data: [{ id: 8, status: 'asked', is_pinned: true }], error: null
  }));
  await context.moderateQuestionStatus(12, 8, 'asked');
  await context.moderateQuestionPinned(12, 8, true);
  assert.deepEqual(calls.map(x => x.name), ['moderate_qna_question_status', 'moderate_qna_question_pin']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), {
    p_room_id: 12, p_question_id: 8, p_status: 'asked'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].args)), {
    p_room_id: 12, p_question_id: 8, p_is_pinned: true
  });
  const error = new Error('SESSION_NOT_CURRENT');
  const rejecting = await harness(async () => ({ data: null, error }));
  await assert.rejects(rejecting.context.moderateQuestionStatus(12, 8, 'asked'), error);
});

test('event current-session selection calls atomic server RPC and reports errors', async () => {
  const { context, calls } = await harness();
  await context.setCurrentEventSession(77);
  assert.deepEqual(calls.map(x => x.name), ['set_current_event_session']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), { p_room_id: 77 });
  const error = new Error('Unauthorized session switch');
  const rejecting = await harness(async () => ({ data: null, error }));
  await assert.rejects(rejecting.context.setCurrentEventSession(77), error);
});
