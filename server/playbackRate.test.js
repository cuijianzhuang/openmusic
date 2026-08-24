import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PLAYBACK_RATE,
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  normalizePlaybackRate,
} from './roomManager.js';

test('playback rate accepts finite values from 0.1 through 3 and defaults to 1 otherwise', () => {
  assert.equal(MIN_PLAYBACK_RATE, 0.1);
  assert.equal(MAX_PLAYBACK_RATE, 3);
  assert.equal(DEFAULT_PLAYBACK_RATE, 1);
  for (const rate of [0.1, 0.25, 1, 1.1, 1.5, 2.75, 3]) {
    assert.equal(normalizePlaybackRate(rate), rate);
  }
  assert.equal(normalizePlaybackRate('1.5'), 1.5);
  assert.equal(normalizePlaybackRate(0), 1);
  assert.equal(normalizePlaybackRate(0.09), 1);
  assert.equal(normalizePlaybackRate(3.01), 1);
  assert.equal(normalizePlaybackRate(4), 1);
  assert.equal(normalizePlaybackRate(Number.NaN), 1);
});