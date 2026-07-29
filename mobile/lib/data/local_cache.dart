import 'package:shared_preferences/shared_preferences.dart';

/// Lightweight local cache (prefs-backed).
/// API shaped so we can swap to Isar later without rewriting call sites.
class LocalCache {
  LocalCache._();

  static const _nickKey = 'sjb_nickname';
  static const _avatarKey = 'avatar_url';
  static const _recentRoomsKey = 'om_recent_rooms';
  static const _searchHistoryKey = 'om_search_history';

  static Future<SharedPreferences> get _prefs => SharedPreferences.getInstance();

  static Future<String> getNickname() async =>
      (await _prefs).getString(_nickKey) ?? '';

  static Future<void> setNickname(String value) async {
    await (await _prefs).setString(_nickKey, value.trim());
  }

  static Future<String> getAvatarUrl() async =>
      (await _prefs).getString(_avatarKey) ?? '';

  static Future<void> setAvatarUrl(String value) async {
    final prefs = await _prefs;
    final next = value.trim();
    if (next.isEmpty) {
      await prefs.remove(_avatarKey);
      return;
    }
    await prefs.setString(_avatarKey, next);
  }

  static Future<List<String>> getRecentRoomIds() async =>
      (await _prefs).getStringList(_recentRoomsKey) ?? const [];

  static Future<List<String>> rememberRoom(String roomId) async {
    final prefs = await _prefs;
    final prev = prefs.getStringList(_recentRoomsKey) ?? const <String>[];
    final next = <String>[
      roomId,
      ...prev.where((id) => id != roomId),
    ].take(20).toList();
    await prefs.setStringList(_recentRoomsKey, next);
    return next;
  }

  static Future<List<String>> getSearchHistory() async =>
      (await _prefs).getStringList(_searchHistoryKey) ?? const [];

  static Future<List<String>> pushSearchQuery(String query) async {
    final q = query.trim();
    if (q.isEmpty) return getSearchHistory();
    final prefs = await _prefs;
    final prev = prefs.getStringList(_searchHistoryKey) ?? const <String>[];
    final next = <String>[
      q,
      ...prev.where((e) => e != q),
    ].take(20).toList();
    await prefs.setStringList(_searchHistoryKey, next);
    return next;
  }

  static Future<void> clearSearchHistory() async {
    await (await _prefs).remove(_searchHistoryKey);
  }
}
