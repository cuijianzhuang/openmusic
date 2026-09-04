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
  reuseIdleOwnedRoom,
  setRoomAdmin,
  setRoomPlayMode,
  setRoomFmMode,
  setRoomPlaylistRoaming,
  selectPlaylistRoamingSong,
  selectRandomFavoriteSong,
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

test('播放模式使用固定六种顺序，未知值降级为顺序播放', () => {
  assert.deepEqual(PLAY_MODES, [
    'order',
    'shuffle',
    'user-round-robin',
    'favorite-shuffle',
    'loop-one',
    'loop-all',
    'shuffle-loop',
  ]);
  assert.equal(DEFAULT_PLAY_MODE, 'order');
  assert.equal(normalizePlayMode('LOOP-ONE'), 'loop-one');
  assert.equal(normalizePlayMode('legacy-mode'), 'order');
  assert.equal(normalizePlayMode(null), 'order');
});

test('房主切换六种模式后，房间快照和广播状态保持一致', (t) => {
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

test('收藏随机模式从收藏列表选取下一首，并排除当前曲和已播放曲', () => {
  const favorites = [makeSong('a'), makeSong('b'), makeSong('c')];
  const selected = selectRandomFavoriteSong(favorites, favorites[0], new Set(['netease:b']), () => 0);
  assert.equal(selected?.id, 'c');
});

test('收藏随机模式只有一首收藏时下一首仍可继续播放该歌曲', () => {
  const only = makeSong('only');
  const selected = selectRandomFavoriteSong([only], only, new Set(['netease:only']), () => 0);
  assert.equal(selected?.id, 'only');
});

test('指定歌单漫游只从歌单歌曲中选择，优先避开当前曲和已播放歌曲', () => {
  const songs = [makeSong('a'), makeSong('b'), makeSong('c')];
  const selected = selectPlaylistRoamingSong(songs, songs[0], new Set(['netease:b']), () => 0);
  assert.equal(selected?.id, 'c');
});

test('指定歌单全部播放过后仍只在该歌单内循环', () => {
  const songs = [makeSong('a'), makeSong('b')];
  const selected = selectPlaylistRoamingSong(songs, songs[0], new Set(['netease:a', 'netease:b']), () => 0);
  assert.equal(selected?.id, 'b');
});

test('指定歌单默认保留不同平台的同名歌曲', () => {
  const neteaseSong = makeSong('same');
  neteaseSong.name = '同名歌曲';
  const qqSong = { ...makeSong('same'), source: 'tencent', name: '同名歌曲' };

  const selected = selectPlaylistRoamingSong([neteaseSong, qqSong], null, new Set(['netease:same']), () => 0);
  assert.equal(selected?.source, 'tencent');
  assert.equal(selected?.id, 'same');
});

test('指定歌单按歌名去重时按网易、QQ、汽水、酷狗优先保留', () => {
  const kugouSong = { ...makeSong('kg'), source: 'kugou', name: '同名歌曲' };
  const qishuiSong = { ...makeSong('qs'), source: 'qishui', name: '同名歌曲' };
  const qqSong = { ...makeSong('qq'), source: 'tencent', name: '同名歌曲' };
  const neteaseSong = { ...makeSong('wy'), source: 'netease', name: '同名歌曲' };

  const selected = selectPlaylistRoamingSong(
    [kugouSong, qishuiSong, qqSong, neteaseSong],
    null,
    new Set(),
    () => 0,
    { dedupeByName: true },
  );
  assert.equal(selected?.source, 'netease');
  assert.equal(selected?.id, 'wy');
});

test('指定歌单保留超过 500 首歌曲，避免与外部整单导入行为不一致', (t) => {
  const { roomId, room } = createTestRoom(t);
  room.playlistRoaming = {
    playlists: [{
      id: 'large-playlist',
      source: 'netease',
      name: '大歌单',
      songs: Array.from({ length: 600 }, (_, index) => makeSong(`song-${index}`)),
    }],
  };

  const broadcast = prepareRoomBroadcast(roomId);
  assert.equal(broadcast?.shared.playlistRoaming?.playlists[0]?.songs.length, 600);
});

test('切回私人漫游只停用指定歌单，切回指定歌单可恢复原歌单', async (t) => {
  const { roomId, room } = createTestRoom(t);
  room.playlistRoaming = {
    enabled: true,
    dedupeByName: false,
    playlists: [{ id: 'playlist-1', source: 'netease', name: '测试歌单', songs: [makeSong('a')] }],
  };

  const switchedToFm = setRoomFmMode(roomId, OWNER_ID, 'default', OWNER_CONNECTION, 'netease');
  assert.equal(switchedToFm.error, undefined);
  assert.equal(room.playlistRoaming?.playlists.length, 1);
  assert.equal(room.playlistRoaming?.enabled, false);

  const restored = await setRoomPlaylistRoaming(roomId, OWNER_ID, { playlistEnabled: true }, OWNER_CONNECTION);
  assert.equal(restored.error, undefined);
  assert.equal(room.playlistRoaming?.playlists.length, 1);
  assert.equal(room.playlistRoaming?.enabled, true);
});

test('FM 关闭时指定歌单仍会自动续播且保留来源标记', async (t) => {
  const { roomId, room } = createTestRoom(t);
  room.playlistRoaming = {
    playlists: [{
      id: 'playlist-1',
      source: 'netease',
      name: '测试歌单',
      songs: [makeSong('a'), makeSong('b')],
    }],
  };
  seedPlayback(room, 'a', []);
  room.current.requestedBy = '指定歌单';
  room.randomPlayedKeys = new Set(['netease:a']);

  const advanced = await finishCurrentSong(roomId, OWNER_ID, OWNER_CONNECTION, room.current.queueId);
  assert.equal(advanced.error, undefined);
  assert.equal(advanced.room?.current?.id, 'b');
  assert.equal(advanced.room?.current?.requestedBy, '指定歌单');
  assert.equal(room.randomPlayedKeys.has('netease:b'), true);
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

test('复用 QQ 漫游房间时清除上次网易预取歌曲并保留 QQ 配置', (t) => {
  const { roomId, room } = createTestRoom(t);
  room.neteaseFmMode = 'DEFAULT';
  room.fmSource = 'tencent';
  room.nextRandom = makeSong('netease-prefetch');
  room.nextRandom.source = 'netease';
  room.randomBatch = [makeSong('netease-batch')];
  room.randomBatch[0].source = 'netease';
  room.nextRandomPromise = Promise.resolve();
  removeUser(roomId, OWNER_ID, OWNER_CONNECTION);

  const reused = reuseIdleOwnedRoom(roomId, { name: '复用后的 QQ 漫游房间' });
  assert.ok(reused);
  assert.equal(getRoomInternal(roomId)?.fmSource, 'tencent');
  assert.equal(getRoomInternal(roomId)?.nextRandom, null);
  assert.deepEqual(getRoomInternal(roomId)?.randomBatch, []);
  assert.equal(getRoomInternal(roomId)?.nextRandomPromise, null);
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

test('随机播放时多首房主置顶歌曲按置顶先后顺序播放', async (t) => {
  const { roomId, room } = createTestRoom(t);
  room.playMode = 'shuffle';
  seedPlayback(room, 'a', ['b', 'c', 'd']);
  room.queue[1].ownerPriority = 100;
  room.queue[0].ownerPriority = 200;
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const first = await finishCurrentSong(roomId, OWNER_ID, OWNER_CONNECTION, room.current.queueId);
    assert.equal(first.error, undefined);
    assert.equal(first.room?.current?.id, 'c');

    const second = await finishCurrentSong(roomId, OWNER_ID, OWNER_CONNECTION, first.room.current.queueId);
    assert.equal(second.error, undefined);
    assert.equal(second.room?.current?.id, 'b');
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
