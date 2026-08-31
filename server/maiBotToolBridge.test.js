import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMaiBotToolCall, isMaiBotToolAllowed } from './maiBotToolBridge.js';

test('normalizes a MaiBot tool call and clamps untrusted fields', () => {
  const call = normalizeMaiBotToolCall({
    tool: 'search_songs',
    arguments: { keyword: 'x'.repeat(400), limit: 99 },
    context: { room_id: ' ROOM ', user_id: ' USER ', request_text: '点歌' },
  });
  assert.equal(call.tool, 'search_songs');
  assert.equal(call.arguments.keyword.length, 200);
  assert.equal(call.arguments.limit, 5);
  assert.deepEqual(call.context, { roomId: 'ROOM', userId: 'USER', requestText: '点歌', userNickname: '' });
});

test('rejects tools outside the server allowlist', () => {
  assert.equal(isMaiBotToolAllowed('request_song', ['search_songs', 'request_song']), true);
  assert.equal(isMaiBotToolAllowed('clear_queue', ['clear_queue']), false);
  assert.equal(isMaiBotToolAllowed('send_sticker', []), false);
});
