import 'package:flutter_test/flutter_test.dart';
import 'package:openmusic/core/api_sign.dart';
import 'package:openmusic/domain/models.dart';
import 'package:openmusic/domain/permissions.dart';
import 'package:openmusic/features/room/chat_utils.dart';
import 'package:openmusic/features/room/playlist_import_helper.dart';

void main() {
  group('api_sign', () {
    test('public rooms GET does not need sign', () {
      final uri = Uri.parse('https://example.com/api/rooms');
      expect(needsApiSign(uri, 'GET'), false);
      expect(needsApiSign(uri, 'POST'), true);
    });

    test('bootstrap is public', () {
      final uri = Uri.parse('https://example.com/api/session/bootstrap');
      expect(needsApiSign(uri), false);
    });

    test('builds headers when key set', () {
      setApiSignKey('test-key');
      final headers = buildApiSignHeaders(
        method: 'GET',
        path: '/api/meting',
        query: 'type=search&id=a',
      );
      expect(headers.containsKey('X-OM-Sign'), true);
      expect(headers.containsKey('X-OM-Ts'), true);
      setApiSignKey(null);
    });
  });

  group('roles', () {
    test('derives owner and leader', () {
      final room = RoomState(
        id: 'r1',
        name: 't',
        ownerId: 'u1',
        creatorId: 'u1',
        queue: const [],
        users: const [],
        userCount: 1,
        isPlaying: false,
        currentTime: 0,
      );
      final roles = RoomRoles.derive(room, 'u1');
      expect(roles.isOwner, true);
      expect(roles.isPlaybackLeader, true);
      expect(roles.canControlPlayback, true);
      expect(canPause(room, roles), true);
    });

    test('room preserves and clears chat visible since', () {
      final room = RoomState(
        id: 'r1',
        name: 't',
        ownerId: 'u1',
        creatorId: 'u1',
        queue: const [],
        users: const [],
        userCount: 1,
        isPlaying: false,
        currentTime: 0,
        chatVisibleSince: 1234,
      );
      expect(room.copyWith().chatVisibleSince, 1234);
      expect(room.copyWith(clearChatVisibleSince: true).chatVisibleSince, isNull);
    });

    test('room parses permanent application snapshot', () {
      final room = RoomState.fromJson({
        'id': 'r1',
        'name': 't',
        'ownerId': 'u1',
        'creatorId': 'u1',
        'queue': const [],
        'users': const [],
        'userCount': 1,
        'isPlaying': false,
        'currentTime': 0,
        'protectedFromDestroy': false,
        'permanentApplication': {
          'status': 'pending',
          'appliedAt': 123,
          'note': 'keep me',
        },
      });
      expect(room.permanentApplication?.status, 'pending');
      expect(room.permanentApplication?.note, 'keep me');
    });

    test('room parses banned songs and forbidden words', () {
      final room = RoomState.fromJson({
        'id': 'r1',
        'name': 't',
        'ownerId': 'u1',
        'creatorId': 'u1',
        'queue': const [],
        'users': const [],
        'userCount': 1,
        'isPlaying': false,
        'currentTime': 0,
        'bannedSongs': [
          {'id': '1', 'source': 'netease', 'name': 'A', 'artist': 'B'},
        ],
        'forbiddenWords': [
          {'word': 'spam', 'isDefault': false},
        ],
      });
      expect(room.bannedSongs.single.name, 'A');
      expect(room.forbiddenWords.single.word, 'spam');
    });

    test('room parses join notice and song request limits', () {
      final room = RoomState.fromJson({
        'id': 'r1',
        'name': 't',
        'ownerId': 'u1',
        'creatorId': 'u1',
        'queue': const [],
        'users': const [],
        'userCount': 1,
        'isPlaying': false,
        'currentTime': 0,
        'joinNoticeEnabled': true,
        'joinNoticeCooldownSec': 180,
        'clearSongsOnLeaveEnabled': true,
        'clearSongsOnLeaveDelaySec': 120,
        'songRequestMinStaySec': 300,
        'songRequestMaxPerUser': 3,
        'songRequestCooldownSec': 45,
        'queueMaxLength': 80,
      });
      expect(room.joinNoticeEnabled, true);
      expect(room.joinNoticeCooldownMinutes, 3);
      expect(room.clearSongsOnLeaveEnabled, true);
      expect(room.songRequestMinStaySec, 300);
      expect(room.songRequestMaxPerUser, 3);
      expect(room.songRequestCooldownSec, 45);
      expect(room.queueMaxLength, 80);
    });

    test('room parses member tiers and member defaults', () {
      final room = RoomState.fromJson({
        'id': 'r1',
        'name': 't',
        'ownerId': 'u1',
        'creatorId': 'u1',
        'queue': const [],
        'users': const [],
        'userCount': 1,
        'isPlaying': false,
        'currentTime': 0,
        'memberTiers': {
          'u2': {
            'badgeLabel': 'SVIP',
            'badgeColor': '#f6d365',
            'borderStyleId': 'solid',
            'borderColor': '#f6d365',
            'welcomeTemplateId': 'royal',
            'confettiEnabled': true,
          },
        },
        'memberSettings': {
          'welcomeEnabled': true,
          'welcomeTemplateId': 'wave',
          'welcomeCooldownSec': 600,
        },
      });
      expect(room.memberTiers['u2']?.badgeLabel, 'SVIP');
      expect(room.memberSettings.welcomeTemplateId, 'wave');
      expect(room.memberSettings.welcomeCooldownSec, 600);
    });
  });

  group('chat utils', () {
    test('tokenizes mentions with longest nickname first', () {
      final segs = tokenizeMentionSegments('你好 @全体成员 和 @小明', ['小明']);
      expect(segs.whereType<MentionHighlightSegment>().map((s) => s.value).toList(), [
        '@全体成员',
        '@小明',
      ]);
    });

    test('buildMentions expands @全体成员', () {
      final users = [
        RoomUser(id: 'a', nickname: '甲', joinedAt: 1),
        RoomUser(id: 'b', nickname: '乙', joinedAt: 2),
        RoomUser(id: 'c', nickname: '丙', joinedAt: 3, readOnly: true),
      ];
      final mentions = buildMentions(
        messageText: '@全体成员 大家好',
        users: users,
        myUserId: 'a',
      );
      expect(mentions.map((m) => m.id).toList(), ['b']);
    });

    test('self mute uses personalized chatMuted', () {
      final room = RoomState(
        id: 'r1',
        name: 't',
        ownerId: 'owner',
        creatorId: 'owner',
        queue: const [],
        users: const [],
        userCount: 1,
        isPlaying: false,
        currentTime: 0,
        chatMuted: true,
      );
      expect(isSelfChatMuted(room, 'member'), true);
      expect(isChatMutedForUser(room, 'other'), false);
      expect(isSelfChatMuted(room, 'owner'), false);
    });

    test('chat message parses reply target', () {
      final message = ChatMessage.fromJson({
        'id': 'm1',
        'userId': 'u2',
        'nickname': '乙',
        'text': '收到',
        'timestamp': 123,
        'replyTo': {
          'id': 'm0',
          'userId': 'u1',
          'nickname': '甲',
          'text': '你好',
        },
      });
      expect(message.replyTo?.id, 'm0');
      expect(message.replyTo?.nickname, '甲');
    });

    test('chat message parses reactions and member tier', () {
      final message = ChatMessage.fromJson({
        'id': 'm1',
        'userId': 'u2',
        'nickname': '乙',
        'text': '[鼓掌]',
        'timestamp': 123,
        'memberTier': {
          'userId': 'u2',
          'badgeLabel': '贵宾',
          'badgeColor': '#f6d365',
          'borderStyleId': 'solid',
          'borderColor': '#f6d365',
        },
        'reactions': [
          {
            'emoji': '[爱心]',
            'users': [
              {'userId': 'u1', 'nickname': '甲'},
            ],
          },
        ],
      });
      expect(message.memberTier?.badgeLabel, '贵宾');
      expect(message.reactions.single.emoji, '[爱心]');
      expect(message.reactions.single.users.single.nickname, '甲');
    });

    test('welcome message parses target user and confetti state', () {
      final message = ChatMessage.fromJson({
        'id': 'w1',
        'userId': 'system',
        'nickname': '系统',
        'text': '欢迎回来',
        'timestamp': 456,
        'kind': 'welcome',
        'targetUserId': 'u9',
        'targetNickname': '新贵宾',
        'confettiEnabled': true,
      });
      expect(message.kind, 'welcome');
      expect(message.targetUserId, 'u9');
      expect(message.targetNickname, '新贵宾');
      expect(message.confettiEnabled, true);
    });
  });

  group('playlist import helper', () {
    test('normalizes qq platform to tencent', () {
      expect(normalizePlaylistPlatform('qq'), 'tencent');
      expect(normalizePlaylistPlatform(''), 'netease');
    });

    test('parses imported songs with dedupe and limit', () {
      final songs = parseImportedSongs(
        List.generate(
          105,
          (i) => {
            'id': '${i % 3 == 0 ? 1 : i}',
            'name': 'Song $i',
            'artist': 'Artist $i',
          },
        ),
        platform: 'qq',
      );
      expect(songs.first.source, 'tencent');
      expect(songs.length, lessThanOrEqualTo(maxPlaylistImportSongs));
      expect(
        songs.map((s) => s.songKey).toSet().length,
        songs.length,
      );
    });
  });
}
