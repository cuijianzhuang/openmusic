const MAX_FAVORITES = 5000;

export function favoriteSongKey(song) {
  const source = String(song?.source || 'netease').trim();
  const id = String(song?.id || '').trim();
  return source && id ? `${source}:${id}` : '';
}

export function filterFavoriteCategories(songs, categories) {
  const allowed = new Set(
    (Array.isArray(categories) ? categories : [])
      .map((category) => String(category || '').trim().toLowerCase())
      .filter(Boolean),
  );
  return (Array.isArray(songs) ? songs : []).map((song) => {
    if (!song || typeof song !== 'object') return song;
    const category = String(song?.category || '').trim();
    if (!category || allowed.has(category.toLowerCase())) return song;
    const { category: _category, ...withoutCategory } = song;
    return withoutCategory;
  });
}

export function mergeFavoriteSnapshots(accountFavorites, guestFavorites) {
  const result = [];
  const seen = new Set();
  for (const song of [...(Array.isArray(accountFavorites) ? accountFavorites : []), ...(Array.isArray(guestFavorites) ? guestFavorites : [])]) {
    const key = favoriteSongKey(song);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(song);
    if (result.length >= MAX_FAVORITES) break;
  }
  return result;
}

export function getFavoritesSyncStatus({ sourceUserId, targetUserId } = {}) {
  const source = String(sourceUserId || '').trim();
  const target = String(targetUserId || '').trim();
  if (source && target && source === target) return 'identity_same';
  return 'merged';
}

export function buildFavoritesSyncResult({ sourceUserId, targetUserId, accountFavorites = [], guestFavorites = [] } = {}) {
  const favorites = mergeFavoriteSnapshots(accountFavorites, guestFavorites);
  const accountKeys = new Set((Array.isArray(accountFavorites) ? accountFavorites : []).map(favoriteSongKey));
  const imported = favorites.filter((song) => !accountKeys.has(favoriteSongKey(song))).length;
  return {
    status: getFavoritesSyncStatus({ sourceUserId, targetUserId }),
    imported,
    favorites,
  };
}
