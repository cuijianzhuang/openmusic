import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_PLAYBACK_RATES,
  DEFAULT_PLAYBACK_RATE,
  normalizePlaybackRate,
} from './roomManager.js';

test('playback rate accepts only the supported room-wide values and defaults to 1', () => {
  assert.deepEqual(ALLOWED_PLAYBACK_RATES, [0.25, 0.5, 1, 1.25, 1.5, 2, 3]);
  assert.equal(DEFAULT_PLAYBACK_RATE, 1);
  for (const rate of ALLOWED_PLAYBACK_RATES) {
    assert.equal(normalizePlaybackRate(rate), rate);
  }
  assert.equal(normalizePlaybackRate('1.5'), 1.5);
  assert.equal(normalizePlaybackRate(0), 1);
  assert.equal(normalizePlaybackRate(1.1), 1);
  assert.equal(normalizePlaybackRate(4), 1);
});
