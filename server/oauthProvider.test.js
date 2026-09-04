import test from 'node:test';
import assert from 'node:assert/strict';
import { createOAuthProvider } from './oauthProvider.js';

function createFakeRedis() {
  const data = new Map();
  return {
    async get(key) { return data.get(key) || null; },
    async set(key, value) { data.set(key, String(value)); },
    async del(...keys) { keys.forEach((key) => data.delete(key)); },
    async *scanIterator({ MATCH }) {
      const pattern = String(MATCH || '').replaceAll('*', '.*');
      const regex = new RegExp(`^${pattern}$`);
      for (const key of [...data.keys()]) {
        if (regex.test(key)) yield key;
      }
    },
  };
}

test('清理房间 OAuth 绑定时删除该房间全部绑定且保留其他房间', async () => {
  const redis = createFakeRedis();
  const provider = createOAuthProvider({
    idField: 'linuxdoId',
    bindPrefix: 'openmusic:test:bind:',
    profilePrefix: 'openmusic:test:profile:',
    redis,
  });
  await provider.bindToUser('linux-a', 'user-a', { username: 'a' }, 'ROOMAAA');
  await provider.bindToUser('linux-b', 'user-b', { username: 'b' }, 'ROOMAAA');
  await provider.bindToUser('linux-c', 'user-c', { username: 'c' }, 'ROOMBBB');

  await provider.clearBindingsForRoom('ROOMAAA');

  assert.equal(await provider.getUserIdFor('linux-a', 'ROOMAAA'), null);
  assert.equal(await provider.getUserIdFor('linux-b', 'ROOMAAA'), null);
  assert.equal(await provider.getProfileForUser('user-a', 'ROOMAAA'), null);
  assert.equal(await provider.getProfileForUser('user-b', 'ROOMAAA'), null);
  assert.equal(await provider.getUserIdFor('linux-c', 'ROOMBBB'), 'user-c');
});
