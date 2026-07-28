import 'package:flutter/material.dart';
import 'package:openmusic/app/theme.dart';

/// Vinyl + waveform brand mark.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 40});

  final double size;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(size * 0.22),
      child: Image.asset(
        'assets/brand/icon.png',
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => Container(
          width: size,
          height: size,
          decoration: const BoxDecoration(gradient: OmTheme.brandGradient),
          child: Icon(Icons.music_note_rounded, color: Colors.white, size: size * 0.5),
        ),
      ),
    );
  }
}

/// Simple dark backdrop — NetEase flat style, no heavy blur.
class OmBackdrop extends StatelessWidget {
  const OmBackdrop({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: OmTheme.bg,
      child: child,
    );
  }
}
