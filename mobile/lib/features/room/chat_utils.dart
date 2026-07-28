// Chat helpers ported from `client/src/lib/chatPanelUtils.ts` / `chatMute.ts`.

import 'package:openmusic/domain/models.dart';

const mentionAllLabel = '全体成员';
const maxChatLength = 500;

String buildMentionPrefix(String nickname) => '@$nickname ';

List<String> collectMentionLabels(Iterable<String> nicknames) {
  final labels = <String>{mentionAllLabel, ...nicknames.where((n) => n.isNotEmpty)};
  final list = labels.toList()
    ..sort((a, b) => b.length.compareTo(a.length));
  return list;
}

/// Extract query after the last `@` before [cursor] (nicknames may contain spaces).
String? getMentionQueryBeforeCursor(String text, int cursor) {
  final safeCursor = cursor.clamp(0, text.length);
  final before = text.substring(0, safeCursor);
  final atIndex = before.lastIndexOf('@');
  if (atIndex < 0) return null;
  return before.substring(atIndex + 1);
}

bool isCompletedMentionQuery(String query, Iterable<String> nicknames) {
  for (final label in collectMentionLabels(nicknames)) {
    if (query.startsWith('$label ')) return true;
  }
  return false;
}

bool hasMentionInText(String messageText, String targetNickname) {
  final prefix = '@$targetNickname';
  var from = 0;
  while (from < messageText.length) {
    final at = messageText.indexOf(prefix, from);
    if (at < 0) return false;
    final tail = messageText.substring(at + prefix.length);
    if (tail.isEmpty || tail.startsWith(' ')) return true;
    from = at + 1;
  }
  return false;
}

bool hasMentionAllInText(String messageText) =>
    hasMentionInText(messageText, mentionAllLabel);

bool matchesMentionAllQuery(String query) {
  final normalized = query.trim().toLowerCase();
  final label = mentionAllLabel.toLowerCase();
  return normalized.isEmpty ||
      label.startsWith(normalized) ||
      normalized.startsWith(label);
}

bool mentionQueryMatchesNickname(String query, String nickname) {
  final q = query.trim().toLowerCase();
  final name = nickname.toLowerCase();
  if (q.isEmpty) return true;
  return name.contains(q) || name.startsWith(q);
}

sealed class MentionTextSegment {
  const MentionTextSegment();
}

class MentionPlainSegment extends MentionTextSegment {
  const MentionPlainSegment(this.value);
  final String value;
}

class MentionHighlightSegment extends MentionTextSegment {
  const MentionHighlightSegment(this.value);
  final String value;
}

/// Longest-nickname-first split of `@` mentions (supports spaces in nicknames).
List<MentionTextSegment> tokenizeMentionSegments(
  String text,
  Iterable<String> nicknames,
) {
  final labels = collectMentionLabels(nicknames);
  final segments = <MentionTextSegment>[];
  var i = 0;

  while (i < text.length) {
    final at = text.indexOf('@', i);
    if (at < 0) {
      if (i < text.length) {
        segments.add(MentionPlainSegment(text.substring(i)));
      }
      break;
    }
    if (at > i) {
      segments.add(MentionPlainSegment(text.substring(i, at)));
    }

    final after = text.substring(at + 1);
    String? matched;
    for (final label in labels) {
      if (!after.startsWith(label)) continue;
      final tail = after.substring(label.length);
      if (tail.isEmpty || tail.startsWith(' ')) {
        matched = label;
        break;
      }
    }

    if (matched != null) {
      segments.add(MentionHighlightSegment('@$matched'));
      i = at + 1 + matched.length;
      continue;
    }

    final partialMatch = RegExp(r'^([^\s@]+)').firstMatch(after);
    if (partialMatch != null) {
      segments.add(MentionHighlightSegment('@${partialMatch.group(1)!}'));
      i = at + 1 + partialMatch.group(1)!.length;
    } else {
      segments.add(const MentionPlainSegment('@'));
      i = at + 1;
    }
  }

  return segments.isEmpty ? [MentionPlainSegment(text)] : segments;
}

List<ChatMention> buildMentions({
  required String messageText,
  required List<RoomUser> users,
  required String? myUserId,
}) {
  if (hasMentionAllInText(messageText)) {
    return users
        .where((u) => u.id != myUserId && !u.readOnly)
        .map((u) => ChatMention(id: u.id, nickname: u.nickname))
        .toList();
  }
  return users
      .where((u) => hasMentionInText(messageText, u.nickname))
      .take(10)
      .map((u) => ChatMention(id: u.id, nickname: u.nickname))
      .toList();
}

/// Creator never muted; otherwise `muteAll` or personal [RoomState.mutedUserIds].
/// For the current viewer, also trust server-personalized [RoomState.chatMuted]
/// (non-moderators do not receive `mutedUserIds`).
bool isChatMutedForUser(RoomState? room, String? userId) {
  if (room == null || userId == null || userId.isEmpty) return false;
  if (room.creatorId == userId) return false;
  if (room.muteAll) return true;
  if (room.mutedUserIds.contains(userId)) return true;
  return false;
}

/// Whether *I* am muted — combines list/muteAll with personalized `chatMuted`.
bool isSelfChatMuted(RoomState? room, String? myUserId) {
  if (isChatMutedForUser(room, myUserId)) return true;
  if (room == null || myUserId == null || myUserId.isEmpty) return false;
  if (room.creatorId == myUserId) return false;
  return room.chatMuted;
}
