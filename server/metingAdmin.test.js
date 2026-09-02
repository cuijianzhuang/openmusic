import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractMetingAdminPayload,
  extractMetingCookieList,
  isMusicAccountPlatform,
  toPublicMusicAccount,
} from './metingAdmin.js';

test('kugou is accepted as a room music account platform', () => {
  assert.equal(isMusicAccountPlatform('kugou'), true);
  assert.equal(isMusicAccountPlatform('unknown'), false);
});

test('public room music account retains kugou platform', () => {
  const account = toPublicMusicAccount({
    id: 'kugou-account',
    platform: 'kugou',
    userInfo: { nickname: 'Kugou User', canPlayVip: true },
  });

  assert.equal(account?.platform, 'kugou');
  assert.equal(account?.hasVip, true);
});

test('meting admin payload accepts data, account, and top-level response shapes', () => {
  const account = { id: 'account-1', platform: 'netease' };
  assert.deepEqual(extractMetingAdminPayload({ data: account }), account);
  assert.deepEqual(extractMetingAdminPayload({ account }), account);
  assert.deepEqual(extractMetingAdminPayload(account), account);
});

test('meting cookie list accepts data, cookies, and top-level array response shapes', () => {
  const cookies = [{ id: 'account-1', platform: 'netease' }];
  assert.deepEqual(extractMetingCookieList({ data: cookies }), cookies);
  assert.deepEqual(extractMetingCookieList({ cookies }), cookies);
  assert.deepEqual(extractMetingCookieList(cookies), cookies);
  assert.deepEqual(extractMetingCookieList({ data: { cookies } }), cookies);
});

test('public shared account honors the shared override for Meting admin records', () => {
  const account = toPublicMusicAccount({
    id: 'account-1',
    platform: 'netease',
    userInfo: { canPlayVip: true },
  }, { hasVip: true, shared: true });

  assert.equal(account?.shared, true);
});
