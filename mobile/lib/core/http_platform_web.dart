import 'package:dio/browser.dart';
import 'package:dio/dio.dart';

void configureHttpAdapter(Dio dio) {
  final adapter = BrowserHttpClientAdapter();
  adapter.withCredentials = true;
  dio.httpClientAdapter = adapter;
}

Future<void> attachNativeCookieManager(Dio dio) async {
  // Browser cookies via withCredentials.
}

Future<dynamic> getSharedCookieJar() async => null;
