import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveAdminOwnerLastJoinedAt } from './adminRoomUtils.js';

test('管理员房间列表返回当前房主最后进房时间', () => {
  const room = {
    ownerId: 'owner-1',
    creatorId: 'creator-1',
    ownerLastJoinedAtByUserId: new Map([
      ['owner-1', 1710000000000],
      ['creator-1', 1700000000000],
    ]),
    users: new Map(),
  };

  assert.equal(resolveAdminOwnerLastJoinedAt(room), 1710000000000);
});

test('没有房主专属记录时回退到在线房主进房时间', () => {
  const room = {
    ownerId: 'owner-1',
    creatorId: 'creator-1',
    ownerLastJoinedAtByUserId: new Map(),
    users: new Map([
      ['owner-1', { joinedAt: 1720000000000, readOnly: false }],
    ]),
  };

  assert.equal(resolveAdminOwnerLastJoinedAt(room), 1720000000000);
});

