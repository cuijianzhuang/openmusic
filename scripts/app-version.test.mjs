import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeReleaseNotes } from './app-version.mjs';

test('选择续写时把新更新说明追加到历史记录后面', () => {
  assert.deepEqual(
    mergeReleaseNotes(['旧功能', '旧修复'], ['新功能'], true),
    ['旧功能', '旧修复', '新功能'],
  );
});

test('不选择续写时只保留本次更新说明', () => {
  assert.deepEqual(mergeReleaseNotes(['旧功能'], ['新功能'], false), ['新功能']);
});
