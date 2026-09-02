import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeMusicAccounts, mergeRoomMusicAccountsWithUpstream } from './roomManager.js';

test('refreshing accounts does not overwrite a newer shared account with stale upstream data', () => {
  const local = normalizeMusicAccounts({
    qishui: { cookieId: 'local-room-qishui', platform: 'qishui', hasVip: true, shared: true, nickname: '汽水用户' },
  });
  const merged = mergeRoomMusicAccountsWithUpstream(local, { qishui: null });
  assert.equal(merged.qishui?.shared, true);
  assert.equal(merged.qishui?.cookieId, 'local-room-qishui');
});
