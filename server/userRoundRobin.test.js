import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addUser,
  adminDestroyRoom,
  createRoom,
  finishCurrentSong,
  getRoomInternal,
} from './roomManager.js';

const ownerId = 'round-robin-owner';
const connectionId = 'round-robin-connection';

function song(id, requestedById, addedAt) {
  return {
    queueId: `queue-${id}`,
    id,
    source: 'netease',
    name: id,
    artist: '测试歌手',
    album: '测试专辑',
    pic: '',
    duration: 180_000,
    requestedBy: requestedById,
    requestedById,
    addedAt,
    likedByIds: [],
    dislikedByIds: [],
  };
}

test('用户轮播每轮为每位点歌用户播放一首', async (t) => {
  const created = createRoom({ name: '用户轮播测试', creatorId: ownerId });
  const roomId = created.id;
  addUser(roomId, ownerId, '房主', { connectionId });
  addUser(roomId, 'A', 'A', { connectionId: 'connection-A' });
  addUser(roomId, 'B', 'B', { connectionId: 'connection-B' });
  addUser(roomId, 'C', 'C', { connectionId: 'connection-C' });
  addUser(roomId, 'D', 'D', { connectionId: 'connection-D' });
  t.after(() => adminDestroyRoom(roomId));

  const room = getRoomInternal(roomId);
  assert.deepEqual([...room.users.keys()].sort(), ['A', 'B', 'C', 'D', ownerId].sort());
  room.neteaseFmMode = 'OFF';
  room.playMode = 'user-round-robin';
  room.current = song('a0', 'A', 0);
  room.lastPlaybackRequesterId = 'A';
  room.isPlaying = true;
  room.startedAt = Date.now();
  room.queue = [
    song('a1', 'A', 1), song('a2', 'A', 2), song('a3', 'A', 3),
    song('b1', 'B', 4), song('b2', 'B', 5),
    song('c1', 'C', 6),
    song('d1', 'D', 7), song('d2', 'D', 8),
  ];

  const played = [];
  for (let index = 0; index < 4; index += 1) {
    const result = await finishCurrentSong(roomId, ownerId, connectionId, room.current.queueId);
    assert.equal(result.error, undefined);
    played.push(result.room.current?.id);
  }

  assert.deepEqual(played, ['b1', 'c1', 'd1', 'a1']);
  assert.deepEqual(room.queue.map((item) => item.id), ['a2', 'a3', 'b2', 'd2']);

  room.users.delete('D');
  const skippedOffline = await finishCurrentSong(roomId, ownerId, connectionId, room.current.queueId);
  assert.equal(skippedOffline.room.current.id, 'b2');
  assert.equal(room.queue.some((item) => item.requestedById === 'D'), true);

  room.users.delete('A');
  room.users.delete('B');
  room.users.delete('C');
  const fallback = await finishCurrentSong(roomId, ownerId, connectionId, room.current.queueId);
  assert.equal(fallback.room.current.id, 'd2');
});
