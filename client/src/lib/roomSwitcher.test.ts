import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRoomSwitcherRooms } from './roomSwitcher';

test('房间切换菜单把当前房间置顶，并优先展示最近访问的房间', () => {
  const rooms = [
    { id: 'OPEN', name: '开放房', userCount: 20 },
    { id: 'MINE', name: '我的房间', userCount: 1, isOwner: true },
    { id: 'RECENT', name: '最近房间', userCount: 3 },
    { id: 'ADMIN', name: '管理房', userCount: 2, isAdmin: true },
  ];

  const sorted = sortRoomSwitcherRooms(rooms, 'mine', ['recent', 'open']);

  assert.deepEqual(sorted.map((room) => room.id), ['MINE', 'RECENT', 'OPEN', 'ADMIN']);
});
