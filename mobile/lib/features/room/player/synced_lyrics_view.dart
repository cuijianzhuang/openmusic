import 'package:flutter/material.dart';

/// NetEase-style synced lyrics — filtered credits, one clear active line.
class OmLyricPanel extends StatefulWidget {
  const OmLyricPanel({
    super.key,
    required this.lrc,
    required this.position,
    this.loading = false,
    this.isPlaying = true,
    this.onSeek,
  });

  final String? lrc;
  final Duration position;
  /// True while lyrics are fetching — avoid flashing「暂无歌词」.
  final bool loading;
  /// When false, highlight the line but do not keep auto-scrolling.
  final bool isPlaying;
  final ValueChanged<Duration>? onSeek;

  @override
  State<OmLyricPanel> createState() => _OmLyricPanelState();
}

class _LrcLine {
  const _LrcLine(this.time, this.text);
  final Duration time;
  final String text;
}

class _OmLyricPanelState extends State<OmLyricPanel> {
  final _scroll = ScrollController();
  List<_LrcLine> _lines = const [];
  String? _loaded;
  var _active = -1;
  var _userScrolling = false;
  DateTime? _userScrollUntil;
  static const _lead = Duration(milliseconds: 280);
  static const _userScrollHold = Duration(seconds: 4);

  static final _creditRe = RegExp(
    r'^(作词|作曲|编曲|制作|监制|录音|混音|母带|出品|发行|原唱|翻唱|歌手|演唱|吉他|贝斯|鼓|键盘|和声|弦乐|钢琴|策划|统筹|宣传|版权|未经许可|OP|SP)\s*[:：]',
    caseSensitive: false,
  );
  static final _promoRe = RegExp(
    r'(网易飓风计划|现金激励|流量扶持|业务联系|vip\.163\.com|来自〖|〗)',
    caseSensitive: false,
  );
  static final _tagRe = RegExp(r'\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]');

  @override
  void initState() {
    super.initState();
    _reload();
    _syncActive(forceScroll: true);
  }

  @override
  void didUpdateWidget(covariant OmLyricPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.lrc != widget.lrc) {
      _reload();
      _syncActive(forceScroll: true);
    } else if (oldWidget.position != widget.position ||
        oldWidget.isPlaying != widget.isPlaying) {
      _syncActive();
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _reload() {
    final raw = widget.lrc?.trim() ?? '';
    if (raw == _loaded) return;
    _loaded = raw;
    _lines = _parse(raw);
    _active = -1;
  }

  List<_LrcLine> _parse(String raw) {
    if (raw.isEmpty) return const [];
    final out = <_LrcLine>[];
    for (final line in raw.split('\n')) {
      final matches = _tagRe.allMatches(line).toList();
      if (matches.isEmpty) continue;
      final text = line.substring(matches.last.end).trim();
      if (text.isEmpty) continue;
      if (_creditRe.hasMatch(text) || _promoRe.hasMatch(text)) continue;
      // Drop phantom 99:xx promo footers.
      for (final m in matches) {
        final min = int.parse(m.group(1)!);
        if (min >= 90) continue;
        final sec = int.parse(m.group(2)!);
        final frac = m.group(3);
        var ms = 0;
        if (frac != null && frac.isNotEmpty) {
          final padded = frac.padRight(3, '0').substring(0, 3);
          ms = int.parse(padded);
        }
        out.add(_LrcLine(Duration(minutes: min, seconds: sec, milliseconds: ms), text));
      }
    }
    out.sort((a, b) => a.time.compareTo(b.time));
    return out;
  }

  bool get _holdingUserScroll {
    final until = _userScrollUntil;
    return until != null && DateTime.now().isBefore(until);
  }

  void _syncActive({bool forceScroll = false}) {
    if (_lines.isEmpty) return;
    final t = widget.position + _lead;
    var idx = 0;
    for (var i = 0; i < _lines.length; i++) {
      if (_lines[i].time <= t) {
        idx = i;
      } else {
        break;
      }
    }
    if (idx == _active && !forceScroll) return;
    final prev = _active;
    _active = idx;
    if (mounted) setState(() {});

    // Enter / lyric reload: snap once. While paused or user dragging: no chase.
    final shouldScroll = forceScroll ||
        (widget.isPlaying && !_holdingUserScroll && (idx - prev).abs() >= 1);
    if (shouldScroll) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _scrollTo(idx, animate: !forceScroll && widget.isPlaying);
      });
    }
  }

  void _scrollTo(int idx, {required bool animate}) {
    if (!_scroll.hasClients || _lines.isEmpty) return;
    const itemExtent = 44.0;
    final viewport = _scroll.position.viewportDimension;
    final target = (idx * itemExtent) - (viewport * 0.38) + (itemExtent / 2);
    final max = _scroll.position.maxScrollExtent;
    final offset = target.clamp(0.0, max);
    if (animate) {
      _scroll.animateTo(
        offset,
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
      );
    } else {
      _scroll.jumpTo(offset);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.loading && _lines.isEmpty) {
      return const Center(
        child: SizedBox(
          width: 22,
          height: 22,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            color: Colors.white38,
          ),
        ),
      );
    }

    if (_lines.isEmpty) {
      return const Center(
        child: Text(
          '暂无歌词',
          style: TextStyle(color: Colors.white38, fontSize: 15, letterSpacing: 0.5),
        ),
      );
    }

    return NotificationListener<ScrollNotification>(
      onNotification: (n) {
        if (n is ScrollStartNotification && n.dragDetails != null) {
          _userScrolling = true;
          _userScrollUntil = DateTime.now().add(_userScrollHold);
        } else if (n is ScrollEndNotification && _userScrolling) {
          _userScrolling = false;
          _userScrollUntil = DateTime.now().add(_userScrollHold);
        }
        return false;
      },
      child: ListView.builder(
        controller: _scroll,
        physics: const BouncingScrollPhysics(),
        padding: const EdgeInsets.symmetric(vertical: 48),
        itemExtent: 44,
        itemCount: _lines.length,
        itemBuilder: (context, i) {
          final line = _lines[i];
          final active = i == _active;
          final dist = (i - _active).abs();
          final opacity = active
              ? 1.0
              : dist == 1
                  ? 0.45
                  : dist == 2
                      ? 0.28
                      : 0.16;
          return GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: widget.onSeek == null ? null : () => widget.onSeek!(line.time),
            child: AnimatedDefaultTextStyle(
              duration: const Duration(milliseconds: 180),
              curve: Curves.easeOut,
              style: TextStyle(
                fontSize: active ? 20 : 15,
                fontWeight: active ? FontWeight.w700 : FontWeight.w400,
                color: Colors.white.withValues(alpha: opacity),
                height: 1.25,
                letterSpacing: active ? 0.2 : 0,
              ),
              textAlign: TextAlign.center,
              child: Text(
                line.text,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
              ),
            ),
          );
        },
      ),
    );
  }
}
