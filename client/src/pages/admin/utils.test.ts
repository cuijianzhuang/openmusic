import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoRefreshAdminTab } from './utils.ts';

test('只有已登录的概览页启用自动刷新', () => {
  assert.equal(shouldAutoRefreshAdminTab(true, 'overview'), true);
  assert.equal(shouldAutoRefreshAdminTab(false, 'overview'), false);
  assert.equal(shouldAutoRefreshAdminTab(true, 'settings'), false);
  assert.equal(shouldAutoRefreshAdminTab(true, 'rooms'), false);
});
