import 'package:flutter_test/flutter_test.dart';
import 'package:openmusic/core/config.dart';

void main() {
  test('local builds accept and normalize HTTP origins', () {
    expect(
      normalizeServerOrigin('http://192.168.1.8:4000/', requireHttps: false),
      'http://192.168.1.8:4000',
    );
  });

  test('production builds require HTTPS', () {
    expect(
      () => normalizeServerOrigin('http://music.example.com', requireHttps: true),
      throwsStateError,
    );
    expect(
      normalizeServerOrigin('https://music.example.com/', requireHttps: true),
      'https://music.example.com',
    );
  });

  test('server URL must be an origin without credentials or paths', () {
    for (final value in [
      'ftp://music.example.com',
      'https://user:pass@music.example.com',
      'https://music.example.com/app',
      'https://music.example.com/?a=1',
    ]) {
      expect(
        () => normalizeServerOrigin(value, requireHttps: false),
        throwsStateError,
      );
    }
  });
}
