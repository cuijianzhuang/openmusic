import type { RoomSummary } from '../types';

/** 无密码上锁：他人无法进入，大厅卡片不可点 */
export function isLobbyHardLocked(room: Pick<RoomSummary, 'isLocked' | 'hasPassword'>): boolean {
  return Boolean(room.isLocked && !room.hasPassword);
}

/** 大厅排序：人数多的靠前，无密码上锁一律最后 */
export function sortLobbyRooms<T extends Pick<RoomSummary, 'userCount' | 'isLocked' | 'hasPassword' | 'createdAt'>>(
  rooms: T[],
): T[] {
  return [...rooms].sort((a, b) => {
    const aLocked = isLobbyHardLocked(a) ? 1 : 0;
    const bLocked = isLobbyHardLocked(b) ? 1 : 0;
    if (aLocked !== bLocked) return aLocked - bLocked;
    return b.userCount - a.userCount || b.createdAt - a.createdAt;
  });
}

function roomSummarySignature(room: RoomSummary): string {
  const song = room.currentSong;
  return [
    room.id,
    room.name,
    room.userCount,
    room.hasPassword,
    room.isLocked ?? false,
    room.isPlaying,
    song?.name ?? '',
    song?.artist ?? '',
    room.queueLength,
    room.createdAt,
  ].join('\0');
}

export function areRoomListsEqual(a: RoomSummary[], b: RoomSummary[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (roomSummarySignature(a[i]) !== roomSummarySignature(b[i])) return false;
  }
  return true;
}
