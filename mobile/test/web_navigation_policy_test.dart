import 'package:flutter_test/flutter_test.dart';
import 'package:openmusic/features/web/web_navigation_policy.dart';

void main() {
  final trusted = Uri.parse('https://music.example.com');

  test('same-origin pages stay inside the WebView', () {
    expect(
      decideWebNavigation(
        candidate: Uri.parse('https://music.example.com/room/ABCD'),
        trustedOrigin: trusted,
        oauthActive: false,
        hasUserGesture: false,
      ),
      WebNavigationDecision.allowTrusted,
    );
    expect(
      isTrustedWebOrigin(Uri.parse('https://music.example.com:443/'), trusted),
      isTrue,
    );
  });

  test('only known same-origin endpoints start OAuth', () {
    expect(
      isOauthStartUrl(Uri.parse('https://music.example.com/api/auth/github/start'), trusted),
      isTrue,
    );
    expect(
      isOauthStartUrl(Uri.parse('https://music.example.com/api/admin/linuxdo/login/start'), trusted),
      isTrue,
    );
    expect(
      isOauthStartUrl(Uri.parse('https://evil.example/api/auth/github/start'), trusted),
      isFalse,
    );
  });

  test('OAuth allows HTTPS providers while ordinary external links leave WebView', () {
    expect(
      decideWebNavigation(
        candidate: Uri.parse('https://github.com/login/oauth/authorize'),
        trustedOrigin: trusted,
        oauthActive: true,
        hasUserGesture: false,
      ),
      WebNavigationDecision.allowOauth,
    );
    expect(
      decideWebNavigation(
        candidate: Uri.parse('https://example.org/docs'),
        trustedOrigin: trusted,
        oauthActive: false,
        hasUserGesture: true,
      ),
      WebNavigationDecision.openExternal,
    );
  });

  test('untrusted redirects and unsafe schemes are blocked', () {
    expect(
      decideWebNavigation(
        candidate: Uri.parse('https://evil.example/redirect'),
        trustedOrigin: trusted,
        oauthActive: false,
        hasUserGesture: false,
      ),
      WebNavigationDecision.block,
    );
    expect(
      decideWebNavigation(
        candidate: Uri.parse('javascript:alert(1)'),
        trustedOrigin: trusted,
        oauthActive: true,
        hasUserGesture: true,
      ),
      WebNavigationDecision.block,
    );
  });
}
