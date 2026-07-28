import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:openmusic/core/config.dart';
import 'package:openmusic/core/http_client.dart';
import 'package:openmusic/features/room/chat_utils.dart';

class QFaceItem {
  const QFaceItem({required this.id, required this.text});
  final String id;
  final String text;

  String get token => '[qqface:$id]';
  String get url => '${AppConfig.serverUrl}/qface/${Uri.encodeComponent(id)}.apng';
}

const _popularIds = ['0', '1', '2', '4', '5', '9', '13', '14', '21', '23', '27', '63'];

final _popularLabels = <String, String>{
  '0': '/惊讶',
  '1': '/撇嘴',
  '2': '/色',
  '4': '/得意',
  '5': '/流泪',
  '9': '/大哭',
  '13': '/呲牙',
  '14': '/微笑',
  '21': '/偷笑',
  '23': '/酷',
  '27': '/奋斗',
  '63': '/玫瑰',
};

final _qqFaceTokenRe = RegExp(r'\[qqface:([^\]]+)\]');

class QFaceCatalog {
  QFaceCatalog._();

  static List<QFaceItem>? _faces;
  static Future<List<QFaceItem>>? _pending;

  static List<QFaceItem> popular() => [
        for (final id in _popularIds)
          QFaceItem(id: id, text: _popularLabels[id] ?? '/表情$id'),
      ];

  static Future<List<QFaceItem>> load() {
    if (_faces != null) return Future.value(_faces!);
    return _pending ??= _fetch();
  }

  static Future<List<QFaceItem>> _fetch() async {
    try {
      await OmHttp.init();
      final res = await OmHttp.client.get<dynamic>('/qface/manifest.json');
      final data = res.data;
      List list;
      if (data is List) {
        list = data;
      } else if (data is String) {
        list = jsonDecode(data) as List;
      } else {
        list = const [];
      }
      final faces = <QFaceItem>[];
      for (final raw in list.whereType<Map>()) {
        final id = '${raw['id'] ?? ''}';
        final text = '${raw['text'] ?? ''}';
        if (id.isEmpty) continue;
        faces.add(QFaceItem(id: id, text: text.isEmpty ? '/表情$id' : text));
      }
      _faces = faces.isEmpty ? popular() : faces;
    } catch (_) {
      _faces = popular();
    }
    return _faces!;
  }
}

/// Split chat text into plain runs, @mentions, and QQ face tokens.
List<InlineSpan> buildChatTextSpans(
  String text, {
  required TextStyle textStyle,
  TextStyle? mentionStyle,
  List<String> nicknames = const [],
  double faceSize = 22,
}) {
  final spans = <InlineSpan>[];
  var start = 0;
  for (final match in _qqFaceTokenRe.allMatches(text)) {
    if (match.start > start) {
      spans.addAll(
        _spansForPlainChunk(
          text.substring(start, match.start),
          textStyle: textStyle,
          mentionStyle: mentionStyle,
          nicknames: nicknames,
        ),
      );
    }
    final id = match.group(1)!;
    spans.add(
      WidgetSpan(
        alignment: PlaceholderAlignment.middle,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 1),
          child: Image.network(
            '${AppConfig.serverUrl}/qface/${Uri.encodeComponent(id)}.apng',
            width: faceSize,
            height: faceSize,
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) => Text('[表情]', style: textStyle),
          ),
        ),
      ),
    );
    start = match.end;
  }
  if (start < text.length) {
    spans.addAll(
      _spansForPlainChunk(
        text.substring(start),
        textStyle: textStyle,
        mentionStyle: mentionStyle,
        nicknames: nicknames,
      ),
    );
  }
  if (spans.isEmpty) {
    spans.add(TextSpan(text: text, style: textStyle));
  }
  return spans;
}

List<InlineSpan> _spansForPlainChunk(
  String chunk, {
  required TextStyle textStyle,
  TextStyle? mentionStyle,
  required List<String> nicknames,
}) {
  if (mentionStyle == null) {
    return [TextSpan(text: chunk, style: textStyle)];
  }
  final out = <InlineSpan>[];
  for (final segment in tokenizeMentionSegments(chunk, nicknames)) {
    switch (segment) {
      case MentionHighlightSegment(:final value):
        out.add(TextSpan(text: value, style: mentionStyle));
      case MentionPlainSegment(:final value):
        out.add(TextSpan(text: value, style: textStyle));
    }
  }
  return out;
}
