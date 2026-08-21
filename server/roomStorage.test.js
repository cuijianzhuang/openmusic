import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRedisClient,
  getRedisConnectionOptions,
  importFavoriteSongs,
  initRoomStorage,
  listFavoriteSongs,
  setFavoriteSong,
} from './roomStorage.js';

test('Redis connection options require an explicit host or URL', () => {
  assert.equal(getRedisConnectionOptions({}), null);
});

test('Redis host configuration uses the safe default port and optional auth fields', () => {
  assert.deepEqual(getRedisConnectionOptions({ REDIS_HOST: 'redis' }), {
    socket: { host: 'redis', port: 6379 },
  });
  assert.deepEqual(getRedisConnectionOptions({
    REDIS_HOST: 'redis',
    REDIS_PORT: '6380',
    REDIS_USERNAME: 'app',
    REDIS_PASSWORD: 'secret',
    REDIS_DB: '2',
  }), {
    socket: { host: 'redis', port: 6380 },
    username: 'app',
    password: 'secret',
    database: 2,
  });
});

test('收藏并发更新通过 Redis CAS 保留全部成功操作', {
  skip: !process.env.TEST_REDIS_URL,
}, async (t) => {
  process.env.REDIS_URL = process.env.TEST_REDIS_URL;
  assert.equal(await initRoomStorage(), true);
  const client = getRedisClient();
  assert.ok(client);

  const userId = `favorite-cas-${process.pid}-${Date.now()}`;
  const key = `openmusic:favorites:${userId}`;
  t.after(async () => {
    await client.del(key);
    if (client.isOpen) client.destroy();
  });

  const songs = Array.from({ length: 8 }, (_, index) => ({
    id: String(index + 1),
    source: 'netease',
    name: `歌曲 ${index + 1}`,
    artist: '测试歌手',
  }));
  const added = await Promise.all(
    songs.map((song) => setFavoriteSong(userId, song, true)),
  );
  assert.equal(added.every((result) => !result.error), true);
  assert.deepEqual(
    new Set((await listFavoriteSongs(userId)).map((song) => song.id)),
    new Set(songs.map((song) => song.id)),
  );

  const importedSongs = [9, 10, 11].map((id) => ({
    id: String(id),
    source: 'netease',
    name: `歌曲 ${id}`,
    artist: '测试歌手',
  }));
  const updates = await Promise.all([
    setFavoriteSong(userId, songs[0], false),
    setFavoriteSong(userId, songs[1], false),
    importFavoriteSongs(userId, importedSongs),
  ]);
  assert.equal(updates.every((result) => !result.error), true);

  const finalIds = new Set((await listFavoriteSongs(userId)).map((song) => song.id));
  assert.equal(finalIds.has('1'), false);
  assert.equal(finalIds.has('2'), false);
  for (const id of ['3', '4', '5', '6', '7', '8', '9', '10', '11']) {
    assert.equal(finalIds.has(id), true);
  }

  await client.del(key);
  const bulk = Array.from({ length: 5005 }, (_, index) => ({
    id: `bulk-${index}`,
    source: 'netease',
    name: `批量歌曲 ${index}`,
    artist: '测试歌手',
  }));
  const capped = await importFavoriteSongs(userId, bulk);
  assert.equal(capped.error, undefined);
  assert.equal(capped.favorites.length, 5000);
  assert.equal(capped.imported, 5000);
  assert.equal(capped.dropped, 5);
  assert.equal((await listFavoriteSongs(userId)).length, 5000);

  const overflow = await importFavoriteSongs(userId, [{
    id: 'must-not-evict-existing',
    source: 'netease',
    name: '容量已满时的新歌曲',
    artist: '测试歌手',
  }]);
  assert.equal(overflow.error, undefined);
  assert.equal(overflow.imported, 0);
  assert.equal(overflow.dropped, 1);
  assert.equal(overflow.favorites.length, 5000);
  assert.equal(overflow.favorites.some((song) => song.id === 'must-not-evict-existing'), false);
  assert.equal(overflow.favorites.some((song) => song.id === 'bulk-4999'), true);
});
