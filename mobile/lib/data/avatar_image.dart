import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:image_picker/image_picker.dart';

/// 与网页端 `avatarImage.ts` / 服务端 `MAX_AVATAR_DATA_URL_LENGTH` 对齐。
const int maxAvatarDataUrlLength = 200 * 1024;
const int avatarPixelSize = 128;

/// 选相册或拍照，裁成居中正方形并压成 data URL。
Future<String?> pickAvatarDataUrl({
  required ImageSource source,
  ImagePicker? picker,
}) async {
  final picked = await (picker ?? ImagePicker()).pickImage(
    source: source,
    imageQuality: 92,
  );
  if (picked == null) return null;
  return fileToAvatarDataUrl(File(picked.path));
}

Future<String> fileToAvatarDataUrl(File file) async {
  final bytes = await file.readAsBytes();
  if (bytes.isEmpty) {
    throw StateError('图片为空');
  }

  final codec = await ui.instantiateImageCodec(bytes);
  final frame = await codec.getNextFrame();
  final srcImage = frame.image;
  try {
    final side = math.min(srcImage.width, srcImage.height);
    if (side <= 0) throw StateError('无法解析图片');
    final sx = (srcImage.width - side) / 2.0;
    final sy = (srcImage.height - side) / 2.0;

    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder);
    canvas.drawImageRect(
      srcImage,
      ui.Rect.fromLTWH(sx, sy, side.toDouble(), side.toDouble()),
      ui.Rect.fromLTWH(0, 0, avatarPixelSize.toDouble(), avatarPixelSize.toDouble()),
      ui.Paint()..filterQuality = ui.FilterQuality.medium,
    );
    final picture = recorder.endRecording();
    final out = await picture.toImage(avatarPixelSize, avatarPixelSize);
    try {
      final png = await out.toByteData(format: ui.ImageByteFormat.png);
      if (png == null) throw StateError('图片处理失败');
      final encoded = base64Encode(png.buffer.asUint8List());
      final dataUrl = 'data:image/png;base64,$encoded';
      if (dataUrl.length > maxAvatarDataUrlLength) {
        throw StateError('图片过大，请换一张');
      }
      return dataUrl;
    } finally {
      out.dispose();
    }
  } finally {
    srcImage.dispose();
  }
}

bool isSupportedAvatarDataUrl(String value) {
  final raw = value.trim();
  if (raw.isEmpty) return true;
  if (raw.startsWith('data:')) {
    return RegExp(r'^data:image/(jpeg|png);base64,', caseSensitive: false)
            .hasMatch(raw) &&
        raw.length <= maxAvatarDataUrlLength;
  }
  return RegExp(r'^https?://', caseSensitive: false).hasMatch(raw) &&
      raw.length <= 500;
}
