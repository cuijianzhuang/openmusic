import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeMusicAccounts } from './roomManager.js';

test('room music accounts retain a kugou FM credential entry', () => {
  const accounts = normalizeMusicAccounts({
    kugou: {
      cookieId: 'local-fm-kugou',
      platform: 'kugou',
      usage: 'fm',
      hasVip: false,
    },
  });

  assert.equal(accounts.kugou?.platform, 'kugou');
  assert.equal(accounts.kugou?.usage, 'fm');
});

test('sharing an existing room account preserves its login metadata when upstream omits data', async () => {
  const { mergeSharedMusicAccount } = await import('./roomManager.js');
  const current = normalizeMusicAccounts({
    qishui: { cookieId: 'local-room-qishui', platform: 'qishui', hasVip: true, shared: false, nickname: '汽水用户' },
  }).qishui;
  const next = mergeSharedMusicAccount(current, null);
  assert.equal(next?.cookieId, 'local-room-qishui');
  assert.equal(next?.nickname, '汽水用户');
  assert.equal(next?.shared, true);
});
