import 'package:flutter/material.dart';
import 'package:openmusic/app/theme.dart';
import 'package:openmusic/domain/models.dart';

const List<String> memberTierColorPresets = <String>[
  '#f6d365',
  '#fde68a',
  '#d4a574',
  '#b45309',
  '#ff8a4c',
  '#ff7a59',
  '#fb7185',
  '#e11d48',
  '#f4a5c0',
  '#e879f9',
  '#c084fc',
  '#c4b5fd',
  '#818cf8',
  '#67e8f9',
  '#2dd4bf',
  '#99f6e4',
  '#6ee7b7',
  '#86efac',
  '#a3e635',
  '#e2e8f0',
  '#94a3b8',
];

const List<String> memberWelcomeTemplateIds = <String>[
  'none',
  'royal',
  'sparkle',
  'vip-lounge',
  'spotlight',
  'wave',
  'custom',
];

const List<int> memberWelcomeCooldownMinuteOptions = <int>[0, 1, 5, 10, 30, 60, 180, 1440];

const Map<String, String> memberWelcomeTemplateLabels = <String, String>{
  'none': '关闭欢迎语',
  'royal': '皇家欢迎',
  'sparkle': '闪耀登场',
  'vip-lounge': '贵宾 lounge',
  'spotlight': '聚光灯',
  'wave': '排面欢迎',
  'custom': '自定义',
};

Color memberTierColor(String value) {
  final hex = value.trim();
  if (hex.length == 7 && hex.startsWith('#')) {
    final parsed = int.tryParse(hex.substring(1), radix: 16);
    if (parsed != null) return Color(0xFF000000 | parsed);
  }
  return const Color(0xFFF6D365);
}

String normalizeMemberTierColor(String value) {
  final trimmed = value.trim();
  if (memberTierColorPresets.contains(trimmed)) return trimmed;
  if (trimmed.length == 7 && trimmed.startsWith('#')) {
    final parsed = int.tryParse(trimmed.substring(1), radix: 16);
    if (parsed != null) return '#${trimmed.substring(1).toUpperCase()}';
  }
  return memberTierColorPresets.first;
}

String normalizeMemberWelcomeTemplateId(String value) {
  final trimmed = value.trim();
  return memberWelcomeTemplateIds.contains(trimmed) ? trimmed : 'royal';
}

int normalizeMemberWelcomeCooldownSec(int? value) {
  final sec = value ?? 300;
  if (sec < 0) return 300;
  if (sec > 24 * 60 * 60) return 24 * 60 * 60;
  return sec;
}

RoomMemberTier buildDefaultMemberTier(String userId) {
  const color = '#f6d365';
  return const RoomMemberTier(
    userId: '',
    badgeLabel: '贵宾',
    badgeColor: color,
    borderStyleId: 'solid',
    borderColor: color,
    welcomeEnabled: true,
    welcomeTemplateId: 'royal',
    welcomeCustomText: '',
    confettiEnabled: true,
    welcomeCooldownSec: 300,
  ).copyWithUserId(userId);
}

String buildMemberWelcomePreview({
  required String templateId,
  required String customText,
  required String badgeLabel,
  required String nickname,
}) {
  final template = switch (normalizeMemberWelcomeTemplateId(templateId)) {
    'none' => '',
    'royal' => '👑 欢迎尊贵 {badge} {nickname} 驾临本房，请享受专属视听盛宴 👑',
    'sparkle' => '✨ {badge} {nickname} 闪耀登场，音乐殿堂因你而亮 ✨',
    'vip-lounge' => '🥂 贵宾 {badge} {nickname} 已就位，专属 lounge 体验开启 🥂',
    'spotlight' => '💫 聚光灯亮起 —— 欢迎 {badge} {nickname} 加入同步听歌 💫',
    'wave' => '🎵 {badge} {nickname} 来了！队列已为你预留排面，一起嗨 🎵',
    'custom' => customText.trim().isEmpty ? '{badge} {nickname} 欢迎回来' : customText.trim(),
    _ => '👑 欢迎尊贵 {badge} {nickname} 驾临本房，请享受专属视听盛宴 👑',
  };
  return template
      .replaceAll('{badge}', '「${badgeLabel.trim().isEmpty ? '贵宾' : badgeLabel.trim()}」')
      .replaceAll('{nickname}', nickname.trim().isEmpty ? '贵宾' : nickname.trim());
}

class MemberTierBadge extends StatelessWidget {
  const MemberTierBadge({super.key, required this.tier, this.compact = false});

  final RoomMemberTier tier;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final color = memberTierColor(tier.badgeColor);
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 6 : 8,
        vertical: compact ? 1.5 : 2.5,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: compact ? 0.18 : 0.2),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.6)),
      ),
      child: Text(
        tier.badgeLabel.trim().isEmpty ? '贵宾' : tier.badgeLabel.trim(),
        style: TextStyle(
          fontSize: compact ? 10 : 11,
          height: 1.1,
          fontWeight: FontWeight.w700,
          color: color.computeLuminance() > 0.7 ? OmTheme.textPrimary : color,
        ),
      ),
    );
  }
}

extension on RoomMemberTier {
  RoomMemberTier copyWithUserId(String userId) => RoomMemberTier(
        userId: userId,
        badgeLabel: badgeLabel,
        badgeColor: badgeColor,
        borderStyleId: borderStyleId,
        borderColor: borderColor,
        assignedAt: assignedAt,
        welcomeEnabled: welcomeEnabled,
        welcomeTemplateId: welcomeTemplateId,
        welcomeCustomText: welcomeCustomText,
        confettiEnabled: confettiEnabled,
        welcomeCooldownSec: welcomeCooldownSec,
      );
}
