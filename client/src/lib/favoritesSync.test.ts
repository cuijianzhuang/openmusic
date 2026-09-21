import assert from 'node:assert/strict';
import test from 'node:test';
import type { FavoriteSong } from '../types';
import { syncFavoriteBatches, type FavoriteSyncBatchResponse } from './favoritesSync';

const song = (id: number): FavoriteSong => ({ id: String(id), source: 'netease', name: `歌曲 ${id}`, artist: '测试' });

test('超过单次上限的游客收藏会分批完整同步', async () => {
  const batches: number[] = [];
  const result = await syncFavoriteBatches(
    Array.from({ length: 1001 }, (_, index) => song(index + 1)),
    async (songs): Promise<FavoriteSyncBatchResponse> => {
      batches.push(songs.length);
      return { success: true, favorites: songs, imported: songs.length, dropped: 0 };
    },
  );

  assert.deepEqual(batches, [1000, 1]);
  assert.equal(result.success, true);
  assert.equal(result.complete, true);
  assert.equal(result.imported, 1001);
});

test('容量拒绝时保留未完成状态，调用方不可删除游客缓存', async () => {
  const result = await syncFavoriteBatches(
    [song(1), song(2)],
    async (songs): Promise<FavoriteSyncBatchResponse> => ({
      success: true,
      favorites: songs,
      imported: 1,
      dropped: 1,
    }),
  );

  assert.equal(result.success, true);
  assert.equal(result.complete, false);
  assert.equal(result.dropped, 1);
});
