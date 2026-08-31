import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addUser,
  adminDestroyRoom,
  adminTransferOwner,
  createRoom,
  getRoomInternal,
} from './roomManager.js';

test('站点管理员可以强制将房主转让给在线成员', (t) => {
  const created = createRoom({ name: '管理员转让测试', creatorId: 'creator-1234' });
  assert.ok(created?.id);
  const roomId = created.id;
  t.after(() => adminDestroyRoom(roomId));

  addUser(roomId, 'creator-1234', '原房主', { connectionId: 'connection-creator' });
  addUser(roomId, 'member-1234', '新房主', { connectionId: 'connection-member' });

  const result = adminTransferOwner(roomId, 'member-1234');
  assert.equal(result.error, undefined);
  assert.equal(result.message, '已将房主转让给「新房主」');
  assert.equal(result.systemMessage?.text, '站点管理员将房主从 原房主 转让给了 新房主');

  const room = getRoomInternal(roomId);
  assert.equal(room?.creatorId, 'member-1234');
  assert.equal(room?.ownerId, 'member-1234');
  assert.equal(room?.adminIds.has('creator-1234'), true);
});

test('站点管理员不能把房主转让给只读成员或不存在的成员', (t) => {
  const created = createRoom({ name: '管理员转让校验测试', creatorId: 'creator-5678' });
  assert.ok(created?.id);
  const roomId = created.id;
  t.after(() => adminDestroyRoom(roomId));

  addUser(roomId, 'creator-5678', '原房主', { connectionId: 'connection-creator' });
  addUser(roomId, 'tv-user-1234', '电视', { connectionId: 'connection-tv', readOnly: true });

  assert.equal(adminTransferOwner(roomId, 'missing-1234').error, '用户不在房间中');
  assert.equal(adminTransferOwner(roomId, 'tv-user-1234').error, '不能转让给 TV / 只读用户');
});
