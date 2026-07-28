import 'package:shared_preferences/shared_preferences.dart';

const _prefix = 'openmusic_announcement_seen:';

String announcementRevision(bool enabled, String text) =>
    '${enabled ? 1 : 0}\n${text.trim()}';

Future<bool> shouldAutoShowAnnouncement({
  required String roomId,
  required bool enabled,
  String? text,
}) async {
  final body = text?.trim() ?? '';
  if (!enabled || body.isEmpty) return false;
  final prefs = await SharedPreferences.getInstance();
  return prefs.getString('$_prefix$roomId') != announcementRevision(enabled, body);
}

Future<void> markAnnouncementSeen({
  required String roomId,
  required bool enabled,
  String? text,
}) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString(
    '$_prefix$roomId',
    announcementRevision(enabled, text ?? ''),
  );
}
