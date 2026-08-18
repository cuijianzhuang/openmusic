import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSocketEventArgs, socketPayload } from './socketPayload.js';

test('socketPayload keeps plain object payloads unchanged', () => {
  const payload = { queueId: 'q1' };
  assert.equal(socketPayload(payload), payload);
});

test('socketPayload normalizes invalid payloads to empty objects', () => {
  assert.deepEqual(socketPayload(null), {});
  assert.deepEqual(socketPayload(undefined), {});
  assert.deepEqual(socketPayload('bad'), {});
  assert.deepEqual(socketPayload(123), {});
  assert.deepEqual(socketPayload([]), {});
  assert.deepEqual(socketPayload(new Date()), {});
});

test('normalizeSocketEventArgs protects handlers and preserves acknowledgements', () => {
  const ack = () => {};
  assert.deepEqual(normalizeSocketEventArgs('rename_user', [null, ack]), [{}, ack]);
  assert.deepEqual(normalizeSocketEventArgs('rename_user', [ack]), [{}, ack]);
  assert.deepEqual(normalizeSocketEventArgs('rename_user', []), [{}]);
  assert.deepEqual(normalizeSocketEventArgs('disconnect', ['client namespace disconnect']), ['client namespace disconnect']);
});
