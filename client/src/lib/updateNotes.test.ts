import test from 'node:test';
import assert from 'node:assert/strict';
import { getDisplayUpdateNotes } from './updateNotes';

test('版本更新提醒展示全部更新内容，不再截断为四条', () => {
  const notes = ['1', '2', '3', '4', '5'];
  assert.deepEqual(getDisplayUpdateNotes(notes), notes);
});
