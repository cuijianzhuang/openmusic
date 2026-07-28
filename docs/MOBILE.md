# OpenMusic 原生移动端（Flutter）

## 目标

与网页共用 Node + Socket.IO 后端，实现一起听歌；**不使用 WebView**。

## 工程

路径：[`mobile/`](../mobile/)

| 模块 | 说明 |
|------|------|
| `lib/core` | HTTP 签名、会话 Cookie、Socket.IO |
| `lib/domain` | Room / Song / Playback 模型与权限 |
| `lib/data` | REST + Socket 房间仓库 |
| `lib/playback` | `just_audio` + `audio_service` + 同步引擎 |
| `lib/features` | 大厅 / 队列 / 点歌 / 聊天 / 设置 / 播放页 |

不做：沉浸模式、TV、Admin。

## 本地

1. 安装 [Flutter](https://docs.flutter.dev/get-started/install) stable
2. （可选）国内镜像：`FLUTTER_STORAGE_BASE_URL` / `PUB_HOSTED_URL`
3. `cd mobile && flutter create --platforms=android,ios --org=com.openmusic --project-name=openmusic .`
4. `flutter pub get`
5. `flutter run --dart-define=OM_SERVER_URL=https://your-host`

## CI

- `.github/workflows/flutter-android-apk.yml`
- `.github/workflows/flutter-ios-ipa.yml`

产物复制到 `server/downloads/openmusic.apk`（及 IPA）。

## Capacitor 退役

`client/android` WebView 壳见 `DEPRECATED.md`；旧 workflow 已标记 DEPRECATED。
