import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWechatUin,
  createWechatUinStore,
  WECHAT_UIN_CONFLICT,
} from './wechatUinAuth.js';

function createFakeRedis() {
  const data = new Map();
  return {
    async get(key) { return data.get(key) || null; },
    async set(key, value) { data.set(key, String(value)); },
    async del(...keys) { keys.forEach((key) => data.delete(key)); },
  };
}

test('微信 UIN 只接受非空数字字符串并保持原始精度', () => {
  assert.equal(normalizeWechatUin('001234567890123456789'), '001234567890123456789');
  assert.equal(normalizeWechatUin(123456789), '123456789');
  assert.equal(normalizeWechatUin(''), null);
  assert.equal(normalizeWechatUin('12.3'), null);
  assert.equal(normalizeWechatUin('abc'), null);
});

test('微信 UIN 绑定后可按 UIN 和用户查询，并清理旧绑定', async () => {
  const redis = createFakeRedis();
  const store = createWechatUinStore({ redis, enabled: true });
  await store.bindToUser('123', 'user-a', 'ROOMAAA');
  assert.equal(await store.getUserIdForUin('123', 'ROOMAAA'), 'user-a');
  const profile = await store.getProfileForUser('user-a', 'ROOMAAA');
  assert.equal(profile.wechatUin, '123');
  assert.equal(typeof profile.boundAt, 'number');
  await store.bindToUser('456', 'user-a', 'ROOMAAA');
  assert.equal(await store.getUserIdForUin('123'), null);
  assert.equal(await store.getUserIdForUin('456', 'ROOMAAA'), 'user-a');
});

test('微信 UIN 已绑定其他用户时拒绝覆盖', async () => {
  const redis = createFakeRedis();
  const store = createWechatUinStore({ redis, enabled: true });
  await store.bindToUser('123', 'user-a', 'ROOMAAA');
  await assert.rejects(() => store.bindToUser('123', 'user-b', 'ROOMAAA'), (error) => error.code === WECHAT_UIN_CONFLICT);
  assert.equal(await store.getUserIdForUin('123', 'ROOMAAA'), 'user-a');
});

test('同一用户重复绑定同一微信 UIN 幂等成功', async () => {
  const redis = createFakeRedis();
  const store = createWechatUinStore({ redis, enabled: true });
  const first = await store.bindToUser('123', 'user-a', 'ROOMAAA');
  const second = await store.bindToUser('123', 'user-a', 'ROOMAAA');
  assert.equal(second.userId, first.userId);
  assert.equal(second.wechatUin, first.wechatUin);
  assert.equal(await store.getUserIdForUin('123', 'ROOMAAA'), 'user-a');
});
