import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MUSIC_SOURCES_ENABLED,
  isMusicSourceEnabled,
  normalizeMusicSourcesEnabled,
} from './musicSources.js';

test('all four music sources are enabled by default', () => {
  assert.deepEqual(normalizeMusicSourcesEnabled(), DEFAULT_MUSIC_SOURCES_ENABLED);
});

test('disabling one source does not disable the others', () => {
  const enabled = normalizeMusicSourcesEnabled({ kugou: false });
  assert.equal(isMusicSourceEnabled('kugou', enabled), false);
  assert.equal(isMusicSourceEnabled('netease', enabled), true);
  assert.equal(isMusicSourceEnabled('tencent', enabled), true);
  assert.equal(isMusicSourceEnabled('qishui', enabled), true);
});

test('unknown sources are never enabled', () => {
  assert.equal(isMusicSourceEnabled('youtube'), false);
});