import 'package:openmusic/domain/models.dart';

/// Mirrors web `client/src/lib/dislikeSkip.ts`.
int resolveDislikeSkipThreshold(RoomState room) {
  if (room.dislikeSkipMode == 'percent') {
    final userCount = room.userCount > 0
        ? room.userCount
        : (room.users.isEmpty ? 1 : room.users.length);
    final percent = room.dislikeSkipPercent.clamp(1, 100);
    return (userCount * percent / 100).ceil().clamp(1, 1 << 20);
  }
  return room.dislikeSkipThreshold.clamp(1, 1 << 20);
}
