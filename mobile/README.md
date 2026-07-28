# OpenMusic Mobile (Flutter)

原生 Android / iOS / Windows / Web 客户端，**不嵌入 WebView**。与现有 Node + Socket.IO 后端互通。

## 本地调试（推荐）

见 [LOCAL.md](./LOCAL.md)。最短路径：

```powershell
# 终端 1：仓库根目录
npm run dev

# 终端 2
cd mobile
.\scripts\run-local.ps1
```

会用 Chrome 打开 App，默认连 `http://127.0.0.1:4000`。

## 要求

- Flutter 3.24+ / Dart 3.5+
- 本机调试优先 Chrome；Windows 桌面需 VS「使用 C++ 的桌面开发」
- Android Studio / Xcode（按移动平台）

## 配置

| 场景 | 地址 |
|------|------|
| 本机 Chrome / Windows | `http://127.0.0.1:4000` |
| Android 模拟器 | `http://10.0.2.2:4000` |
| 真机连本机 | `http://<电脑局域网IP>:4000` |
| 正式服 | `https://qqovo.top` |

也可 `--dart-define=OM_SERVER_URL=...`，或大厅右上角改地址。

## 构建

```bash
cd mobile
flutter build apk --release --split-per-abi --dart-define=OM_FLAVOR=prod
flutter build appbundle --release --dart-define=OM_FLAVOR=prod
```

产物可复制到 `server/downloads/openmusic.apk`。

## 范围

一起听歌用户端对等；不做沉浸模式、TV、Admin。
