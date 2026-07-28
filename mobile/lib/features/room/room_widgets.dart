import 'package:flutter/material.dart';
import 'package:openmusic/app/theme.dart';
import 'package:openmusic/domain/models.dart';
import 'package:openmusic/features/room/member_tier_ui.dart';
import 'package:openmusic/widgets/om_cover_image.dart';
import 'package:openmusic/widgets/om_ui.dart';

/// NetEase-style section header with red accent bar.
class OmSectionHeader extends StatelessWidget {
  const OmSectionHeader(this.title, {super.key, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 16, 8),
      child: Row(
        children: [
          Container(
            width: 3,
            height: 14,
            decoration: BoxDecoration(
              color: OmTheme.red,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            title,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: OmTheme.textPrimary,
            ),
          ),
          const Spacer(),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// Horizontal song row — NetEase playlist style.
class OmSongRow extends StatelessWidget {
  const OmSongRow({
    super.key,
    required this.title,
    required this.subtitle,
    this.coverUrl,
    this.leading,
    this.trailing,
    this.onTap,
    this.highlight = false,
    this.memberTier,
    this.showDivider = true,
    this.dividerIndent = 80,
  });

  final String title;
  final String subtitle;
  final String? coverUrl;
  final Widget? leading;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool highlight;
  final RoomMemberTier? memberTier;
  final bool showDivider;
  final double dividerIndent;

  @override
  Widget build(BuildContext context) {
    final content = Column(
      children: [
        Material(
          color: memberTier != null
              ? memberTierColor(memberTier!.borderColor).withValues(alpha: 0.08)
              : (highlight ? OmTheme.red.withValues(alpha: 0.06) : Colors.transparent),
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
              child: Row(
                children: [
                  if (leading != null) ...[
                    leading!,
                    const SizedBox(width: 12),
                  ] else if (coverUrl != null || leading == null) ...[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(6),
                      child: SizedBox(
                        width: 48,
                        height: 48,
                        child: coverUrl != null
                            ? OmCoverImage(
                                url: coverUrl,
                                sizePx: 96,
                                fallback: const _CoverPlaceholder(),
                              )
                            : const _CoverPlaceholder(),
                      ),
                    ),
                    const SizedBox(width: 12),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w500,
                            color: highlight ? OmTheme.red : OmTheme.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                subtitle,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: OmTheme.textHint,
                                ),
                              ),
                            ),
                            if (memberTier != null) ...[
                              const SizedBox(width: 8),
                              MemberTierBadge(tier: memberTier!, compact: true),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                  if (trailing != null) trailing!,
                ],
              ),
            ),
          ),
        ),
        if (showDivider)
          Divider(height: 1, indent: dividerIndent, color: OmTheme.divider),
      ],
    );
    if (memberTier == null) return content;
    final color = memberTierColor(memberTier!.borderColor);
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.55)),
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.08),
            blurRadius: 10,
            spreadRadius: 1,
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: content,
      ),
    );
  }
}

class _CoverPlaceholder extends StatelessWidget {
  const _CoverPlaceholder();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: OmTheme.elevated,
      child: const Center(
        child: Icon(Icons.music_note, color: OmTheme.textHint, size: 22),
      ),
    );
  }
}

/// Now playing hero card at top of queue — Spotify-like dense tile.
class OmNowPlayingCard extends StatelessWidget {
  const OmNowPlayingCard({
    super.key,
    required this.title,
    required this.artist,
    required this.coverUrl,
    required this.isPlaying,
    this.requestedBy,
    this.memberTier,
    this.onTap,
    this.trailing,
  });

  final String title;
  final String artist;
  final String? coverUrl;
  final bool isPlaying;
  final String? requestedBy;
  final RoomMemberTier? memberTier;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final color = memberTier == null ? null : memberTierColor(memberTier!.borderColor);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(OmTheme.radiusMd),
          border: color == null ? null : Border.all(color: color.withValues(alpha: 0.6)),
          boxShadow: color == null
              ? null
              : [
                  BoxShadow(
                    color: color.withValues(alpha: 0.08),
                    blurRadius: 14,
                    spreadRadius: 1,
                  ),
                ],
        ),
        child: Material(
          color: color == null ? OmTheme.elevated : color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(OmTheme.radiusMd),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Row(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: SizedBox(
                      width: 72,
                      height: 72,
                      child: OmCoverImage(
                        url: coverUrl,
                        sizePx: 144,
                        fallback: const _CoverPlaceholder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          isPlaying ? '正在播放' : '已暂停',
                          style: TextStyle(
                            fontSize: 11,
                            color: isPlaying ? OmTheme.red : OmTheme.textHint,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.2,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: OmTheme.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                [
                                  artist,
                                  if (requestedBy != null) '点歌 $requestedBy',
                                ].join(' · '),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: OmTheme.textSecondary,
                                ),
                              ),
                            ),
                            if (memberTier != null) ...[
                              const SizedBox(width: 8),
                              MemberTierBadge(tier: memberTier!, compact: true),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                  if (trailing != null) trailing!,
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Filter chip for search tab.
class OmFilterChip extends StatelessWidget {
  const OmFilterChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? OmTheme.red.withValues(alpha: 0.12) : OmTheme.elevated,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? OmTheme.red.withValues(alpha: 0.5) : Colors.transparent,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
            color: selected ? OmTheme.red : OmTheme.textSecondary,
          ),
        ),
      ),
    );
  }
}

/// Room top tab bar — red underline indicator.
class OmRoomTabBar extends StatelessWidget {
  const OmRoomTabBar({
    super.key,
    required this.tabs,
    required this.index,
    required this.onTap,
  });

  final List<String> tabs;
  final int index;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: OmTheme.divider, width: 0.5)),
      ),
      child: Row(
        children: List.generate(tabs.length, (i) {
          final selected = i == index;
          return Expanded(
            child: GestureDetector(
              onTap: () => onTap(i),
              behavior: HitTestBehavior.opaque,
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      tabs[i],
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                        color: selected ? OmTheme.textPrimary : OmTheme.textHint,
                      ),
                    ),
                  ),
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    height: 2,
                    width: selected ? 24 : 0,
                    decoration: BoxDecoration(
                      color: OmTheme.red,
                      borderRadius: BorderRadius.circular(1),
                    ),
                  ),
                ],
              ),
            ),
          );
        }),
      ),
    );
  }
}
