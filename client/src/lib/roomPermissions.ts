import type { RoomState } from '../types';

export function canModerateRoom(isOwner: boolean, isAdmin: boolean): boolean {
  return isOwner || isAdmin;
}

export function canRequestSong(
  room: RoomState | null,
  isOwner: boolean,
  isAdmin: boolean,
): boolean {
  if (!room) return false;
  if (room.songRequestEnabled !== false) return true;
  return isOwner || isAdmin;
}
