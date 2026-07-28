import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:openmusic/core/api_sign.dart';
import 'package:openmusic/core/config.dart';
import 'package:openmusic/core/http_platform.dart';
import 'package:openmusic/core/session.dart';

class OmHttp {
  OmHttp._();

  static Dio? _dio;

  static Dio get client {
    final dio = _dio;
    if (dio == null) throw StateError('OmHttp.init() required');
    return dio;
  }

  static Future<void> init() async {
    if (_dio != null) return;
    await _createClient();
  }

  /// Re-create Dio after server URL change.
  static Future<void> reinit() async {
    _dio?.close(force: true);
    _dio = null;
    await _createClient();
  }

  static Future<void> _createClient() async {
    final dio = Dio(
      BaseOptions(
        baseUrl: AppConfig.serverUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 20),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      ),
    );

    configureHttpAdapter(dio);
    await attachNativeCookieManager(dio);

    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final method = options.method.toUpperCase();

          // Serialize JSON body once so signature hash matches wire bytes.
          final data = options.data;
          if (data != null &&
              data is! String &&
              data is! List<int> &&
              method != 'GET' &&
              method != 'HEAD') {
            final ct = options.contentType?.toLowerCase() ?? '';
            if (ct.contains('json') || data is Map || data is List) {
              options.data = jsonEncode(data);
            }
          }

          final uri = options.uri;
          if (needsApiSign(uri, method)) {
            await SessionBootstrap.ensure();
            if (getApiSignKey() == null) {
              await SessionBootstrap.require(force: true);
            }
            final bodyForSign = _bodyForSign(options.data);
            final query = canonicalApiQuery(
              Map<String, String>.from(uri.queryParameters),
            );
            final signHeaders = buildApiSignHeaders(
              method: method,
              path: uri.path,
              query: query,
              body: bodyForSign,
            );
            if (signHeaders.isEmpty) {
              handler.reject(
                DioException(
                  requestOptions: options,
                  type: DioExceptionType.unknown,
                  message: '会话签名未就绪，请重试',
                ),
              );
              return;
            }
            options.headers.addAll(signHeaders);
          }
          handler.next(options);
        },
        onError: (error, handler) {
          final data = error.response?.data;
          if (data is Map && data['error'] != null) {
            handler.reject(
              DioException(
                requestOptions: error.requestOptions,
                response: error.response,
                type: error.type,
                error: data['error'],
                message: '${data['error']}',
              ),
            );
            return;
          }
          handler.next(error);
        },
      ),
    );
    _dio = dio;
    if (kDebugMode) {
      // ignore: avoid_print
      print('[OmHttp] baseUrl=${AppConfig.serverUrl}');
    }
  }

  static String _bodyForSign(dynamic data) {
    if (data == null) return '';
    if (data is String) return data;
    if (data is Map || data is List) return jsonEncode(data);
    return '';
  }

  static Future<Response<T>> get<T>(
    String path, {
    Map<String, dynamic>? query,
    Options? options,
  }) {
    return client.get<T>(path, queryParameters: query, options: options);
  }

  static Future<Response<T>> post<T>(
    String path, {
    Object? data,
    Map<String, dynamic>? query,
    Options? options,
  }) {
    return client.post<T>(
      path,
      data: data,
      queryParameters: query,
      options: options,
    );
  }
}
