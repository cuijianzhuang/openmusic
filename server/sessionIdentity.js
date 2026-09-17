export function shouldRefreshRoomIdentity(currentIdentity, roomUserId) {
  return currentIdentity?.userId !== roomUserId;
}
