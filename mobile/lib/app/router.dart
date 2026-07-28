import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:openmusic/features/lobby/lobby_page.dart';
import 'package:openmusic/features/room/room_page.dart';
import 'package:openmusic/features/room/player_page.dart';

final _rootKey = GlobalKey<NavigatorState>();

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/',
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => const LobbyPage(),
      ),
      GoRoute(
        path: '/room/:roomId',
        builder: (context, state) {
          final id = state.pathParameters['roomId']!;
          final pwd = state.uri.queryParameters['password'];
          return RoomPage(roomId: id, password: pwd);
        },
        routes: [
          GoRoute(
            path: 'player',
            builder: (context, state) => const PlayerPage(),
          ),
        ],
      ),
    ],
  );
});
