import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFavoritesSyncResult, favoriteSongKey, mergeFavoriteSnapshots } from './favoritesSync.js';

const song = (id, source = 'netease') => ({ id, source, name: id });

test('favorites are merged by source and song id with account order preserved', () => {
  const result = mergeFavoriteSnapshots([song('1'), song('2')], [song('2'), song('3'), song('4', 'qq')]);
  assert.deepEqual(result.map(favoriteSongKey), ['netease:1', 'netease:2', 'netease:3', 'qq:4']);
});
test('same stable identity reports identity_same while still returning local snapshot merge result', () => {
  const result = buildFavoritesSyncResult({
    sourceUserId: 'guest-123',
    targetUserId: 'guest-123',
    accountFavorites: [song('1')],
    guestFavorites: [song('1'), song('2')],
  });
  assert.equal(result.status, 'identity_same');
  assert.equal(result.imported, 1);
  assert.deepEqual(result.favorites.map(favoriteSongKey), ['netease:1', 'netease:2']);
});

test('different identities report merged and remain idempotent', () => {
  const input = { sourceUserId: 'guest-123', targetUserId: 'account-456', accountFavorites: [song('1')], guestFavorites: [song('1'), song('2')] };
  const first = buildFavoritesSyncResult(input);
  const second = buildFavoritesSyncResult({ ...input, accountFavorites: first.favorites, guestFavorites: input.guestFavorites });
  assert.equal(first.status, 'merged');
  assert.equal(first.imported, 1);
  assert.equal(second.imported, 0);
  assert.deepEqual(second.favorites, first.favorites);
});
