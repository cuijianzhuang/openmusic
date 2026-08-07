import 'package:shared_preferences/shared_preferences.dart';

import 'package:openmusic/core/http_client.dart';
import 'package:openmusic/core/session.dart';
import 'package:openmusic/domain/models.dart';

const _storageKey = 'openmusic:user-audio-quality';

class QualityOption {
  const QualityOption(this.value, this.label, {this.svip = false});
  final String value;
  final String label;
  final bool svip;
}

const neteaseQualityOptions = <QualityOption>[
  QualityOption('standard', '标准'),
  QualityOption('higher', '较高'),
  QualityOption('exhigh', '极高'),
  QualityOption('lossless', '无损'),
  QualityOption('hires', '高解析度无损'),
  QualityOption('jyeffect', '高清臻音'),
  QualityOption('sky', '沉浸环绕声', svip: true),
  QualityOption('jymaster', '超清母带', svip: true),
  QualityOption('dolby', '杜比全景声', svip: true),
];

const tencentQualityOptions = <QualityOption>[
  QualityOption('standard', '标准品质'),
  QualityOption('exhigh', 'HQ高品质'),
  QualityOption('lossless', 'SQ无损品质'),
  QualityOption('atmos', '臻品全景声', svip: true),
  QualityOption('master', '臻品母带', svip: true),
];

const defaultUserAudioQuality = RoomAudioQuality(
  netease: 'jyeffect',
  tencent: 'lossless',
);

final _neteaseSvip = {
  for (final o in neteaseQualityOptions)
    if (o.svip) o.value,
};
final _tencentSvip = {
  for (final o in tencentQualityOptions)
    if (o.svip) o.value,
};

List<QualityOption> qualityOptionsForSource(
  String source, {
  required bool svipEnabled,
}) {
  final all = source == 'tencent' ? tencentQualityOptions : neteaseQualityOptions;
  if (svipEnabled) return all;
  return all.where((o) => !o.svip).toList();
}

String _normalizeNetease(String? raw, {required bool svipEnabled}) {
  switch (raw) {
    case '128':
      return 'standard';
    case '320':
      return 'exhigh';
    case 'flac':
      return 'lossless';
  }
  final value = neteaseQualityOptions.any((e) => e.value == raw)
      ? raw!
      : defaultUserAudioQuality.netease;
  if (!svipEnabled && _neteaseSvip.contains(value)) {
    return defaultUserAudioQuality.netease;
  }
  return value;
}

String _normalizeTencent(String? raw, {required bool svipEnabled}) {
  switch (raw) {
    case '128':
      return 'standard';
    case '320':
      return 'exhigh';
    case 'flac':
      return 'lossless';
  }
  final value = tencentQualityOptions.any((e) => e.value == raw)
      ? raw!
      : defaultUserAudioQuality.tencent;
  if (!svipEnabled && _tencentSvip.contains(value)) {
    return defaultUserAudioQuality.tencent;
  }
  return value;
}

RoomAudioQuality normalizeUserAudioQuality(
  RoomAudioQuality? input, {
  bool svipEnabled = true,
}) {
  return RoomAudioQuality(
    netease: _normalizeNetease(input?.netease, svipEnabled: svipEnabled),
    tencent: _normalizeTencent(input?.tencent, svipEnabled: svipEnabled),
  );
}

String getQualityLabelForSource(String source, String quality) {
  final options = source == 'tencent' ? tencentQualityOptions : neteaseQualityOptions;
  for (final option in options) {
    if (option.value == quality) return option.label;
  }
  return quality;
}

String getAudioQualitySummary(RoomAudioQuality quality) {
  final q = normalizeUserAudioQuality(quality);
  return '网易 ${getQualityLabelForSource('netease', q.netease)} · QQ ${getQualityLabelForSource('tencent', q.tencent)}';
}

/// Site feature: whether SVIP quality tiers are exposed to clients.
class QualityCapabilities {
  QualityCapabilities._();

  static bool? _svipEnabled;
  static DateTime? _fetchedAt;

  static bool get svipQualityEnabled => _svipEnabled ?? false;

  static Future<bool> refresh({bool force = false}) async {
    if (!force &&
        _fetchedAt != null &&
        DateTime.now().difference(_fetchedAt!) < const Duration(minutes: 5) &&
        _svipEnabled != null) {
      return _svipEnabled!;
    }
    try {
      await SessionBootstrap.require();
      final res = await OmHttp.get<dynamic>('/api/music/quality-capabilities');
      final data = res.data;
      final enabled = data is Map && data['svipQualityEnabled'] == true;
      _svipEnabled = enabled;
      _fetchedAt = DateTime.now();
      return enabled;
    } catch (_) {
      _svipEnabled ??= false;
      return _svipEnabled!;
    }
  }
}

class UserAudioQualityStore {
  UserAudioQualityStore._();

  static Future<RoomAudioQuality?> read() async {
    final prefs = await SharedPreferences.getInstance();
    final netease = prefs.getString('$_storageKey:netease');
    final tencent = prefs.getString('$_storageKey:tencent');
    if (netease == null && tencent == null) return null;
    return RoomAudioQuality(
      netease: netease ?? defaultUserAudioQuality.netease,
      tencent: tencent ?? defaultUserAudioQuality.tencent,
    );
  }

  static Future<RoomAudioQuality> resolve(
    RoomAudioQuality? roomQuality, {
    bool? svipEnabled,
  }) async {
    final enabled = svipEnabled ?? await QualityCapabilities.refresh();
    final stored = await read();
    return normalizeUserAudioQuality(
      stored ?? roomQuality ?? defaultUserAudioQuality,
      svipEnabled: enabled,
    );
  }

  static Future<void> write(RoomAudioQuality quality) async {
    final enabled = await QualityCapabilities.refresh();
    final q = normalizeUserAudioQuality(quality, svipEnabled: enabled);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('$_storageKey:netease', q.netease);
    await prefs.setString('$_storageKey:tencent', q.tencent);
  }
}
