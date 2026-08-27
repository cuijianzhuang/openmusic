import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlayModeSelection, shouldOpenPlayModeMenu } from './playMode.ts';

test('桌面右键和移动端双击打开播放模式菜单', () => {
  assert.equal(shouldOpenPlayModeMenu('contextmenu', false), true);
  assert.equal(shouldOpenPlayModeMenu('doubleclick', true), true);
  assert.equal(shouldOpenPlayModeMenu('contextmenu', true), false);
  assert.equal(shouldOpenPlayModeMenu('click', false), false);
});

test('播放模式菜单只接受已知模式', () => {
  assert.equal(resolvePlayModeSelection('loop-one'), 'loop-one');
  assert.equal(resolvePlayModeSelection(' LOOP-ALL '), 'loop-all');
  assert.equal(resolvePlayModeSelection('unknown-mode'), null);
});
