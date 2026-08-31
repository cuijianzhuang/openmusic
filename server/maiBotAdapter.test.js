import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaiBotMessage, extractMaiBotText, MaiBotAdapter } from './maiBotAdapter.js';

test('createMaiBotMessage builds a legacy envelope', () => {
  const message = createMaiBotMessage({ messageId: 'om-1', platform: 'openmusic', accountId: 'bot', roomId: 'room-1', userId: 'user-1', userNickname: 'user', text: 'hello' });
  assert.equal(message.message_info.platform, 'openmusic');
  assert.equal(message.message_info.message_id, 'om-1');
  assert.equal(message.message_info.group_info.group_id, 'room-1');
  assert.equal(message.message_info.user_info.user_id, 'user-1');
  assert.deepEqual(message.message_segment, { type: 'seglist', data: [{ type: 'text', data: 'hello' }] });
});

test('extractMaiBotText supports standard and raw component messages', () => {
  assert.equal(extractMaiBotText({ message_segment: { type: 'seglist', data: [{ type: 'text', data: 'reply' }] } }), 'reply');
  assert.equal(extractMaiBotText({ raw_message: { components: [{ type: 'text', text: 'hello' }, { type: 'image', url: 'x' }] } }), 'hello');
  assert.equal(extractMaiBotText({ type: 'echo', echo: 'id', actual_id: 'real' }), '');
});

test('MaiBotAdapter parses a Buffer WebSocket response', async () => {
  const sent = [];
  const listeners = {};
  const socket = { connected: false, once(name, handler) { listeners[name] = handler; }, on(name, handler) { listeners[name] = handler; }, emit(name, value) { sent.push({ name, value }); }, disconnect() {} };
  const fakeSocketIo = (url, options) => { socket.url = url; socket.options = options; return socket; };
  const adapter = new MaiBotAdapter({ wsUrl: 'ws://127.0.0.1:8000/ws', socketIo: fakeSocketIo, timeoutMs: 100 });
  const pending = adapter.sendMessage({ roomId: 'room-buffer', userId: 'user-1', text: 'hello' });
  await new Promise((resolve) => setImmediate(resolve));
  socket.connected = true;
  listeners.connect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  listeners.message({ message_info: { group_info: { group_id: 'room-buffer' } }, message_segment: { type: 'seglist', data: [{ type: 'text', data: 'buffer reply' }] } });
  assert.equal(await pending, 'buffer reply');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].name, 'message');
});

test('MaiBotAdapter sends token metadata and resolves the next bot message', async () => {
  const sent = [];
  const listeners = {};
  const socket = { connected: false, once(name, handler) { listeners[name] = handler; }, on(name, handler) { listeners[name] = handler; }, emit(name, value) { sent.push({ name, value }); }, disconnect() {} };
  const fakeSocketIo = (url, options) => { socket.url = url; socket.options = options; return socket; };
  const adapter = new MaiBotAdapter({ wsUrl: 'ws://127.0.0.1:8000/ws', authMode: 'token', authToken: 'secret', socketIo: fakeSocketIo, timeoutMs: 100 });
  const pending = adapter.sendMessage({ messageId: 'om-2', roomId: 'room-1', userId: 'user-1', userNickname: 'user', text: 'hello' });
  await new Promise((resolve) => setImmediate(resolve));
  socket.connected = true;
  listeners.connect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(socket.options, { path: '/ws', transports: ['polling', 'websocket'], extraHeaders: { Authorization: 'secret', platform: 'openmusic' } });
  assert.equal(sent[0].value.message_info.message_id, 'om-2');
  listeners.message({ message_info: { message_id: 'reply-1' }, message_segment: { type: 'seglist', data: [{ type: 'text', data: 'done' }] } });
  assert.equal(await pending, 'done');
});
