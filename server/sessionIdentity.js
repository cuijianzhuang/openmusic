export function shouldRefreshRoomIdentity(currentIdentity, roomUserId) {
  return currentIdentity?.userId !== roomUserId;
}

export function shouldIssueGuestHandoff(currentIdentity, roomUserId) {
  return Boolean(currentIdentity?.userId && roomUserId);
}
