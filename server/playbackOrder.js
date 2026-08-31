/**
 * Build a fair playback order by rotating through requesters.
 * Songs within each requester remain in request-time order unless pickSong is provided.
 */
export function buildUserRoundRobinOrder(songs, options = {}) {
  const input = Array.isArray(songs) ? songs : [];
  const pickSong = typeof options.pickSong === "function"
    ? options.pickSong
    : (userSongs) => userSongs[0];
  const groups = new Map();
  const order = [];

  input.forEach((song, index) => {
    const userId = String(song?.requestedById || "").trim() || `anonymous-${index}`;
    if (!groups.has(userId)) {
      groups.set(userId, []);
      order.push(userId);
    }
    groups.get(userId).push(song);
  });

  const requestedOrder = Array.isArray(options.userOrder)
    ? options.userOrder.map((id) => String(id || "").trim()).filter((id) => groups.has(id))
    : [];
  const userOrder = [...new Set([...requestedOrder, ...order.filter((id) => !requestedOrder.includes(id))])];
  const result = [];
  while (userOrder.some((userId) => groups.get(userId)?.length)) {
    for (const userId of userOrder) {
      const userSongs = groups.get(userId);
      if (!userSongs?.length) continue;
      const selected = pickSong(userSongs, userId);
      const index = userSongs.indexOf(selected);
      result.push(userSongs.splice(index >= 0 ? index : 0, 1)[0]);
    }
  }
  return result;
}
