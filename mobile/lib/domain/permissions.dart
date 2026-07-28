import 'package:openmusic/domain/models.dart';

/// Permission helpers ported from `client/src/lib/roomPermissions.ts`.

bool canModerate(RoomRoles roles) => roles.isOwner || roles.isAdmin;

bool canPause(RoomState room, RoomRoles roles) =>
    roles.canControlPlayback || room.memberPauseEnabled;

bool canSeek(RoomState room, RoomRoles roles) =>
    roles.canControlPlayback || room.memberSeekEnabled;

bool canRequestSongs(RoomState room, RoomRoles roles) =>
    roles.canControlPlayback || room.songRequestEnabled;

bool systemPlayBound(RoomState room) => room.systemMediaPlayBound;

bool systemSkipBound(RoomState room) => room.systemMediaSkipBound;

String? songRequestBlockReason({
  required RoomState room,
  required RoomRoles roles,
}) {
  if (canRequestSongs(room, roles)) return null;
  return '房主已关闭成员点歌';
}
