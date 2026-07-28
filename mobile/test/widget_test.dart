import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openmusic/app/theme.dart';
import 'package:flutter/material.dart';

void main() {
  testWidgets('theme builds', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(theme: OmTheme.darkTheme(), home: const Scaffold()),
      ),
    );
    expect(find.byType(Scaffold), findsOneWidget);
  });
}
