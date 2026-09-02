import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFmQuery, normalizeFmSource } from './metingFm.js';

test('酷狗私人漫游使用酷狗 fm 请求且不附带模式参数', () => {
  assert.equal(normalizeFmSource('kugou'), 'kugou');
  assert.deepEqual(buildFmQuery('DEFAULT', 'kugou'), { server: 'kugou', type: 'fm' });
  assert.deepEqual(buildFmQuery('FAMILIAR', 'kugou'), { server: 'kugou', type: 'fm' });
});
