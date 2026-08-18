import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, getMetricsSnapshot, incrementMetric, _resetLoggerMetricsForTests } from './logger.js';

test('logger metrics count events by metric name and labels', () => {
  _resetLoggerMetricsForTests();
  assert.equal(incrementMetric('redis_error_total', { phase: 'connect' }), 1);
  assert.equal(incrementMetric('redis_error_total', { phase: 'connect' }), 2);
  assert.deepEqual(getMetricsSnapshot(), [
    {
      metric: 'redis_error_total',
      labels: { phase: 'connect' },
      value: 2,
    },
  ]);
});

test('logger exports scoped logging methods', () => {
  const log = createLogger('test-scope');
  assert.equal(typeof log.debug, 'function');
  assert.equal(typeof log.info, 'function');
  assert.equal(typeof log.warn, 'function');
  assert.equal(typeof log.error, 'function');
});
