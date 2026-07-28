import 'package:flutter/material.dart';

/// App icon aliases. Uses Material Icons (system) — Lucide package is
/// incompatible with current Flutter (IconData is final).
abstract final class OmIcons {
  static const home = Icons.home_rounded;
  static const search = Icons.search_rounded;
  static const library = Icons.library_music_rounded;
  static const music = Icons.music_note_rounded;
  static const listMusic = Icons.queue_music_rounded;
  static const messageCircle = Icons.chat_bubble_outline_rounded;
  static const play = Icons.play_arrow_rounded;
  static const pause = Icons.pause_rounded;
  static const skipForward = Icons.skip_next_rounded;
  static const skipBack = Icons.skip_previous_rounded;
  static const heart = Icons.favorite_rounded;
  static const thumbsDown = Icons.thumb_down_alt_rounded;
  static const plus = Icons.add_rounded;
  static const logIn = Icons.login_rounded;
  static const users = Icons.people_outline_rounded;
  static const settings = Icons.tune_rounded;
  static const moreHorizontal = Icons.more_horiz_rounded;
  static const copy = Icons.copy_rounded;
  static const chevronDown = Icons.keyboard_arrow_down_rounded;
  static const chevronLeft = Icons.chevron_left_rounded;
  static const x = Icons.close_rounded;
  static const send = Icons.send_rounded;
  static const smile = Icons.emoji_emotions_outlined;
  static const lock = Icons.lock_outline_rounded;
  static const unlock = Icons.lock_open_rounded;
  static const radio = Icons.radio_rounded;
  static const refresh = Icons.refresh_rounded;
  static const flag = Icons.flag_outlined;
  static const arrowUp = Icons.north_rounded;
  static const doorOpen = Icons.door_front_door_outlined;
  static const megaphone = Icons.campaign_outlined;
}

Icon omIcon(IconData icon, {double size = 22, Color? color}) =>
    Icon(icon, size: size, color: color);
