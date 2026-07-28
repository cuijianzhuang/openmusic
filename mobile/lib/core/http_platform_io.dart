import 'dart:io';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:path_provider/path_provider.dart';

void configureHttpAdapter(Dio dio) {}

PersistCookieJar? _sharedCookieJar;

Future<void> attachNativeCookieManager(Dio dio) async {
  final dir = await getApplicationSupportDirectory();
  final cookiePath = Directory('${dir.path}/cookies');
  if (!await cookiePath.exists()) {
    await cookiePath.create(recursive: true);
  }
  final jar = _sharedCookieJar ??= PersistCookieJar(storage: FileStorage(cookiePath.path));
  dio.interceptors.add(CookieManager(jar));
}

Future<PersistCookieJar> getSharedCookieJar() async {
  if (_sharedCookieJar != null) return _sharedCookieJar!;
  final dir = await getApplicationSupportDirectory();
  final cookiePath = Directory('${dir.path}/cookies');
  if (!await cookiePath.exists()) {
    await cookiePath.create(recursive: true);
  }
  _sharedCookieJar = PersistCookieJar(storage: FileStorage(cookiePath.path));
  return _sharedCookieJar!;
}
