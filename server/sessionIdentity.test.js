import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldIssueGuestHandoff } from './sessionIdentity.js';

test('同一稳定房间身份重新登录时仍需签发游客收藏迁移凭证', () => {
  assert.equal(shouldIssueGuestHandoff({ userId: 'guest_same' }, 'guest_same', true), true);
});
