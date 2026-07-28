# OpenMusic Mobile — 本地调试

测试环境默认连 `http://localhost:4000`（仓库根目录 `npm run dev`）。  
**App 内不显示、不可改服务器地址** — 只在打包/启动时通过 `--dart-define` 注入。

## 一分钟上手

1. 根目录执行 `npm run dev`
2. 新开终端：

```powershell
cd e:\python\openmusic\mobile
.\scripts\run-local.ps1
```

脚本使用 `web-server` 模式（避免 `flutter run -d chrome` 时 Flutter 工具崩溃），约 12 秒后**自动用 Chrome** 打开 `http://localhost:57920`。  
若要用 Edge：`.\scripts\run-local.ps1 -Device edge`

## Cursor / VS Code

Run and Debug → **OpenMusic Mobile (local Web)**

## 指定服务器（仅构建时）

```powershell
# 本地（默认）
.\scripts\run-local.ps1

# 正式服对比
.\scripts\run-local.ps1 -Prod

# 自定义
.\scripts\run-local.ps1 -ServerUrl https://qqovo.top

# Android 模拟器
.\scripts\run-local.ps1 -Device android
```

打包 APK 时在 CI 或命令行传入：

```powershell
flutter build apk --release `
  --dart-define=OM_FLAVOR=prod `
  --dart-define=OM_SERVER_URL=https://qqovo.top
```

## 真机连本机 API

打包时指定局域网 IP，例如：

```powershell
flutter run `
  --dart-define=OM_FLAVOR=local `
  --dart-define=OM_SERVER_URL=http://192.168.1.8:4000
```

## Flutter 崩溃说明

若 `flutter run -d chrome` 报 `FormatException`（Chrome DevTools 协议问题），请改用本脚本的 `web-server` 模式，或 VS Code 配置 **local Web**。
