export 'http_platform_stub.dart'
    if (dart.library.html) 'http_platform_web.dart'
    if (dart.library.io) 'http_platform_io.dart';
