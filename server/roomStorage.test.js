import test from 'node:test';
import assert from 'node:assert/strict';
import { getRedisConnectionOptions } from './roomStorage.js';

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
