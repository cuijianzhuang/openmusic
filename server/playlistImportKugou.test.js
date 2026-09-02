import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseKugouPlaylistId } from './playlistImport.js';

test('parseKugouPlaylistId accepts a Kugou global collection id and share URL', () => {
  assert.equal(parseKugouPlaylistId('12345678'), '12345678');
  assert.equal(parseKugouPlaylistId('collection_3_2120207009_138_0'), 'collection_3_2120207009_138_0');
  assert.equal(
    parseKugouPlaylistId('https://www.kugou.com/yy/special/single/12345678.html'),
    '12345678',
  );
});
