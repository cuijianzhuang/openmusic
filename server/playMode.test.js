import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAY_MODES,
  DEFAULT_PLAY_MODE,
  addUser,
  adminDestroyRoom,
  createRoom,
  finishCurrentSong,
  getRoom,
  getRoomInternal,
  normalizePlayMode,
  prepareRoomBroadcast,
  removeUser,
  setRoomAdmin,
  setRoomPlayMode,
  skipSong,
} from './roomManager.js';

const OWNER_ID = 'owner_0001';
const OWNER_CONNECTION = 'connection-owner';

function makeSong(id, queueId = `queue-${id}`) {
  return {
    queueId,
    id,
    source: 'netease',
    name: `歌曲 ${id}`,
    artist: '测试歌手',
    album: '测试专辑',
    pic: '',
    duration: 180_000,
    requestedBy: '测试用户',
    addedAt: Date.now(),
    likedByIds: [],
    dislikedByIds: [],
  };
}

function createTestRoom(t) {
  const created = createRoom({ name: '播放模式测试', creatorId: OWNER_ID });
  assert.ok(created?.id);
  const roomId = created.id;
  const joined = addUser(roomId, OWNER_ID, '房主', { connectionId: OWNER_CONNECTION });
  assert.equal(joined?.creatorId, OWNER_ID);

  const room = getRoomInternal(roomId);
  assert.ok(room);
  room.neteaseFmMode = 'OFF';
  room.nextRandom = null;
  room.nextRandomPromise = null;
  room.randomBatch = [];
  t.after(() => adminDestroyRoom(roomId));

  return { roomId, room };
}

function seedPlayback(room, currentId = 'a', queueIds = []) {
  room.current = makeSong(currentId);
  room.queue = queueIds.map((id) => makeSong(id));
  room.isPlaying = true;
  room.currentTime = 0;
  room.startedAt = Date.now();
  room.randomLoading = false;
  room.nextRandom = null;
  room.nextRandomPromise = null;
  room.randomBatch = [];
  room.lastRecycledQueueId = null;
}

test('播放模式使用固定五种顺序，未知值降级为顺序播放', () => {
  assert.deepEqual(PLAY_MODES, [
    'order',
    'shuffle',
    'loop-one',
    'loop-all',
    'shuffle-loop',
  ]);
  assert.equal(DEFAULT_PLAY_MODE, 'order');
  assert.equal(normalizePlayMode('LOOP-ONE'), 'loop-one');
  assert.equal(normalizePlayMode('legacy-mode'), 'order');
  assert.equal(normalizePlayMode(null), 'order');
});

test('房主切换五种模式后，房间快照和广播状态保持一致', (t) => {
  const { roomId } = createTestRoom(t);

  for (const mode of PLAY_MODES) {
    const result = setRoomPlayMode(roomId, OWNER_ID, mode, OWNER_CONNECTION);
    assert.equal(result.error, undefined);
    assert.equal(result.room?.playMode, mode);
    assert.equal(getRoom(roomId)?.playMode, mode);
    assert.equal(prepareRoomBroadcast(roomId)?.shared.playMode, mode);
  }

  const fallback = setRoomPlayMode(roomId, OWNER_ID, 'legacy-mode', OWNER_CONNECTION);
  assert.equal(fallback.error, undefined);
  assert.equal(fallback.room?.playMode, 'order');
});

test('仅房主、正式管理员和临时控播管理员可以切换模式', (t) => {
  const { roomId } = createTestRoom(t);
  const adminId = 'admin_0001';
  const memberId = 'member_001';
  const adminConnection = 'connection-admin';
  const memberConnection = 'connection-member';

  addUser(roomId, adminId, '管理员', { connectionId: adminConnection });
  addUser(roomId, memberId, '成员', { connectionId: memberConnection });

  const denied = setRoomPlayMode(roomId, memberId, 'shuffle', memberConnection);
  assert.match(denied.error || '', /仅房主或管理员/);

  const appointed = setRoomAdmin(roomId, OWNER_ID, adminId, true, OWNER_CONNECTION);
  assert.equal(appointed.error, undefined);
  assert.equal(setRoomPlayMode(roomId, adminId, 'shuffle', adminConnection).room?.playMode, 'shuffle');

  removeUser(roomId, OWNER_ID, OWNER_CONNECTION);
  removeUser(roomId, adminId, adminConnection);
  const temporaryController = getRoom(roomId);
  assert.equal(temporaryController?.ownerId, memberId);
  assert.deepEqual(temporaryController?.autoPromotedAdminIds, [memberId]);
  assert.equal(setRoomPlayMode(roomId, memberId, 'loop-one', memberConnection).room?.playMode, 'loop-one');
});

test('顺序播放自然结束后按队列顺序消费歌曲，空队列时停止', async (t) => {
  const { roomId, room } = createTestRoom(t);
  room.playMode = 'order';
  seedPlayback(room, 'a', ['b', 'c']);

  const advanced = await finishCurrentSong(roomId, OWNER_ID, OWNER_CONNECTION, room.current.queueId);
  assert.equal(advanced.error, undefined);
  assert.equal(advanced.room?.current?.id, 'b');
  assert.deepEqual(advanced.room?.queue.map((song) => song.id), ['c']);

  seedPlayback(room, 'only', []);
  const stopped = await finishCurrentSong(roomId, OWNER_ID, OWNER_CONNECTION, room.current.queueId);
  assert.equal(stopped.room?.current, null);
  assert.equal(stopped.room?.isPlaying, false);
  assert.deepEqual(stopped.room?.queue, []);
});

test('随机播放自然结束后随机选取并消费一首待播歌曲', async (t) => {
  const { roomId, room } = createTestRoom(t);
  room.playMode = 'shuffle';
  seedPlayback(room, 'a', ['b', 'c', 'd']);

  const advanced = await finishCurrentSong(roomId, OWNER_ID, OWNER_CONNECTION, room.current.queueId);
  assert.equal(advanced.error, undefined);
  assert.ok(['b', 'c', 'd'].includes(advanced.room?.current?.id));
  assert.equal(advanced.room?.queue.length, 2);
  assert.equal(advanced.room?.queue.some((song) => song.id === 'a'), false);
});

test('随机播放时房主置顶歌曲优先于随机抽样', async (t) => {
  const { roomId, room } = createTestRoom(t);
  room.playMode = 'shuffle';
  seedPlayback(room, 'a', ['b', 'c', 'd']);
  room.queue[1].ownerPriority = Date.now();
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const advanced = await finishCurrentSong(roomId, OWNER_ID, OWNER_CONNECTION, room.current.queueId);
    assert.equal(advanced.error, undefined);
    assert.equal(advanced.room?.current?.id, 'c');
  } finally {
    Math.random = originalRandom;
  }
});

test('单曲循环只在自然结束时重播，手动切歌仍然前进', async (t) => {
  const { roomId, room } = createTestRoom(t);
  room.playMode = 'loop-one';
  seedPlayback(room, 'a', ['b', 'c']);
  const originalQueueId = room.current.queueId;

  const replayed = await finishCurrentSong(roomId, OWNER_ID, OWNER_CONNECTION, originalQueueId);
  assert.equal(replayed.error, undefined);
  assert.equal(replayed.room?.current?.id, 'a');
  assert.equal(replayed.room?.current?.queueId, originalQueueId);
  assert.deepEqual(replayed.room?.queue.map((song) => song.id), ['b', 'c']);

  const skipped = await skipSong(roomId, OWNER_ID, OWNER_CONNECTION);
  assert.equal(skipped.error, undefined);
  assert.equal(skipped.room?.current?.id, 'b');
  assert.deepEqual(skipped.room?.queue.map((song) => song.id), ['c']);
});

test('列表循环会回收已播歌曲，并兼容只有一首歌的队列', async (t) => {
  const { roomId, room } = createTestRoom(t);
  room.playMode = 'loop-all';
  seedPlayback(room, 'a', ['b', 'c']);

  const advanced = await finishCurrentSong(roomId, OWNER_ID, OWNER_CONNECTION, room.current.queueId);
  assert.equal(advanced.room?.current?.id, 'b');
  assert.deepEqual(advanced.room?.queue.map((song) => song.id), ['c', 'a']);

  seedPlayback(room, 'only', []);
  const replayed = await finishCurrentSong(roomId, OWNER_ID, OWNER_CONNECTION, room.current.queueId);
  assert.equal(replayed.room?.current?.id, 'only');
  assert.deepEqual(replayed.room?.queue, []);
});

test('列表内随机会回收歌曲，多首时避免立即重复，单首时继续循环', async (t) => {
  const { roomId, room } = createTestRoom(t);
  room.playMode = 'shuffle-loop';
  seedPlayback(room, 'a', ['b', 'c']);

  const advanced = await finishCurrentSong(roomId, OWNER_ID, OWNER_CONNECTION, room.current.queueId);
  assert.ok(['b', 'c'].includes(advanced.room?.current?.id));
  assert.notEqual(advanced.room?.current?.id, 'a');
  assert.equal(advanced.room?.queue.length, 2);
  assert.equal(advanced.room?.queue.some((song) => song.id === 'a'), true);

  seedPlayback(room, 'only', []);
  const replayed = await finishCurrentSong(roomId, OWNER_ID, OWNER_CONNECTION, room.current.queueId);
  assert.equal(replayed.room?.current?.id, 'only');
  assert.deepEqual(replayed.room?.queue, []);
});
