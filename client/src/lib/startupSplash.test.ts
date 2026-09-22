import assert from 'node:assert/strict';
import test from 'node:test';
import { isStartupSplashDismissKey } from './startupSplash';

test('启动页仅接受 Enter 和 Space 键进入应用', () => {
  assert.equal(isStartupSplashDismissKey('Enter'), true);
  assert.equal(isStartupSplashDismissKey(' '), true);
  assert.equal(isStartupSplashDismissKey('Spacebar'), true);
  assert.equal(isStartupSplashDismissKey('Escape'), false);
});
