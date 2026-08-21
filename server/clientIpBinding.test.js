import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientNetworkBindingStore } from './clientIpBinding.js';

function createRedis() {
  const values = new Map();
  return {
    async get(key) { return values.get(key) || null; },
    async set(key, value, options = {}) {
      if (options.NX && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
  };
}

test('首次有效客户端网络信息会绑定到 userId 与 deviceId，后续上报不能覆盖', async () => {
  const redis = createRedis();
  const store = createClientNetworkBindingStore({ getRedisClient: () => redis });
  const identity = { userId: 'user_12345678', deviceId: 'device_12345678' };

  assert.deepEqual(await store.resolve(identity, { ip: '198.51.100.10', location: '四川 成都' }), {
    ip: '198.51.100.10', location: '四川 成都',
  });
  assert.deepEqual(await store.resolve(identity, { ip: '203.0.113.20', location: '北京' }), {
    ip: '198.51.100.10', location: '四川 成都',
  });
});

test('无效首个 IP 不会占用绑定，之后的有效网络信息可以建立绑定', async () => {
  const redis = createRedis();
  const store = createClientNetworkBindingStore({ getRedisClient: () => redis });
  const identity = { userId: 'user_12345678', deviceId: 'device_12345678' };

  assert.deepEqual(await store.resolve(identity, { ip: 'not-an-ip', location: '四川' }), {
    ip: '', location: '',
  });
  assert.deepEqual(await store.resolve(identity, { ip: '198.51.100.10', location: '四川' }), {
    ip: '198.51.100.10', location: '四川',
  });
});
