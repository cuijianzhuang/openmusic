import assert from 'node:assert/strict';
import test from 'node:test';
import { claimAccountRoom, createAccountRoomIndex } from './accountRooms.js';

test('账户房间索引支持幂等添加、删除和脏成员过滤', () => {
  const index = createAccountRoomIndex();
  const rooms = new Map([
    ['ABCD', { id: 'ABCD', name: '主房间', ownerAccountId: 'acct_demo', createdAt: 2 }],
    ['EFGH', { id: 'EFGH', name: '旧房间', ownerAccountId: null, createdAt: 1 }],
  ]);
  assert.equal(index.add('acct_demo', 'abcd'), true);
  assert.equal(index.add('acct_demo', 'ABCD'), false);
  index.add('acct_demo', 'EFGH');
  assert.deepEqual(index.list('acct_demo', rooms).map((room) => room.id), ['ABCD']);
  assert.equal(index.remove('acct_demo', 'ABCD'), true);
  assert.equal(index.remove('acct_demo', 'ABCD'), false);
});

test('认领要求服务端验证的 creatorId，且冲突和重复认领幂等', () => {
  const index = createAccountRoomIndex();
  const room = { id: 'ROOM1', creatorId: 'guest_1234', ownerAccountId: null };
  assert.equal(claimAccountRoom({ room, accountId: 'acct_one', verifiedCreatorId: 'attacker', index }).code, 'ROOM_CLAIM_FORBIDDEN');
  assert.equal(claimAccountRoom({ room, accountId: 'acct_one', verifiedCreatorId: 'guest_1234', index }).changed, true);
  assert.equal(claimAccountRoom({ room, accountId: 'acct_one', verifiedCreatorId: 'guest_1234', index }).changed, false);
  assert.equal(claimAccountRoom({ room, accountId: 'acct_two', verifiedCreatorId: 'guest_1234', index }).code, 'ROOM_ACCOUNT_CONFLICT');
});
