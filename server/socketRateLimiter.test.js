import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSocketRatePrincipal,
  createDistributedSocketRateLimiter,
  getSocketEventRatePolicy,
} from './socketRateLimiter.js';

test('Socket 限流身份不依赖 socket.id', () => {
  assert.equal(
    buildSocketRatePrincipal({ userId: 'user-1', ip: '203.0.113.1' }),
    'user:user-1',
  );
  assert.equal(
    buildSocketRatePrincipal({ userId: '', ip: '203.0.113.1' }),
    'ip:203.0.113.1',
  );
});

test('Socket 高频读写事件都有固定策略', () => {
  assert.deepEqual(getSocketEventRatePolicy('set_favorite'), { windowMs: 60_000, max: 90 });
  assert.deepEqual(getSocketEventRatePolicy('send_chat'), { windowMs: 60_000, max: 30 });
  assert.deepEqual(getSocketEventRatePolicy('list_favorites'), { windowMs: 60_000, max: 60 });
  assert.equal(getSocketEventRatePolicy('disconnect'), null);
});

test('无 Redis 时同一稳定身份跨连接共享内存额度', async () => {
  let currentTime = 1000;
  const limiter = createDistributedSocketRateLimiter({
    getRedisClient: () => null,
    now: () => currentTime,
  });
  const request = {
    scope: 'event:send_chat',
    principal: 'user:user-1',
    windowMs: 1000,
    max: 2,
  };
  assert.equal((await limiter.consume(request)).allowed, true);
  assert.equal((await limiter.consume(request)).allowed, true);
  assert.equal((await limiter.consume(request)).allowed, false);

  currentTime = 2001;
  assert.equal((await limiter.consume(request)).allowed, true);
});

test('多个限流器实例通过 Redis 共享额度', async () => {
  const counts = new Map();
  const redis = {
    isReady: true,
    async eval(_script, { keys }) {
      const count = (counts.get(keys[0]) || 0) + 1;
      counts.set(keys[0], count);
      return [count, 60_000];
    },
  };
  const first = createDistributedSocketRateLimiter({ getRedisClient: () => redis });
  const second = createDistributedSocketRateLimiter({ getRedisClient: () => redis });
  const request = {
    scope: 'event:send_chat',
    principal: 'user:user-1',
    windowMs: 60_000,
    max: 1,
  };
  assert.equal((await first.consume(request)).allowed, true);
  assert.equal((await second.consume(request)).allowed, false);
});

test('真实 Redis 原子窗口在多个限流器实例间生效', {
  skip: !process.env.TEST_REDIS_URL,
}, async (t) => {
  const { createClient } = await import('redis');
  const redis = createClient({ url: process.env.TEST_REDIS_URL });
  await redis.connect();
  t.after(() => {
    if (redis.isOpen) redis.destroy();
  });

  const first = createDistributedSocketRateLimiter({ getRedisClient: () => redis });
  const second = createDistributedSocketRateLimiter({ getRedisClient: () => redis });
  const request = {
    scope: `test:${process.pid}:${Date.now()}`,
    principal: 'user:redis-shared-user',
    windowMs: 1000,
    max: 1,
  };
  const initial = await first.consume(request);
  const repeated = await second.consume(request);
  assert.equal(initial.source, 'redis');
  assert.equal(initial.allowed, true);
  assert.equal(repeated.source, 'redis');
  assert.equal(repeated.allowed, false);
  assert.ok(repeated.retryAfterMs > 0);
});
