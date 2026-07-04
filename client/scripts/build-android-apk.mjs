/**
 * 本地命令行打 APK（无需 Android Studio，但仍需 JDK + Android SDK）。
 * 用法：npm run cap:build:apk
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidRoot = resolve(clientRoot, 'android');
const buildType = (process.argv[2] || 'debug').toLowerCase();
const task = buildType === 'release' ? 'assembleRelease' : 'assembleDebug';

function findAndroidHome() {
  if (process.env.ANDROID_HOME && existsSync(process.env.ANDROID_HOME)) {
    return process.env.ANDROID_HOME;
  }
  if (process.env.ANDROID_SDK_ROOT && existsSync(process.env.ANDROID_SDK_ROOT)) {
    return process.env.ANDROID_SDK_ROOT;
  }
  const localAppData = process.env.LOCALAPPDATA || process.env.HOME;
  if (localAppData) {
    const candidate = resolve(localAppData, 'Android', 'Sdk');
    if (existsSync(candidate)) return candidate;
  }
  return '';
}

const androidHome = findAndroidHome();
if (!androidHome) {
  console.error(`
[build-apk] 未找到 Android SDK。

没有 Android Studio 也可以，但需要安装：
  1. JDK 17+   winget install Microsoft.OpenJDK.17
  2. Android SDK 命令行工具（比 Android Studio 小很多）
     下载：https://developer.android.com/studio#command-line-tools-only
  3. 设置环境变量 ANDROID_HOME 指向 SDK 目录
  4. sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"

更简单的方式：用 GitHub Actions 云端打包（无需本地装任何 Android 工具）
  GitHub 仓库 → Actions → Android APK → Run workflow
`);
  process.exit(1);
}

process.env.ANDROID_HOME = androidHome;
process.env.ANDROID_SDK_ROOT = androidHome;

console.log('[build-apk] 先同步 Capacitor…');
const sync = spawnSync('node', ['scripts/cap-sync.mjs', 'android'], {
  cwd: clientRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (sync.status !== 0) process.exit(sync.status ?? 1);

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
console.log(`[build-apk] ${gradlew} ${task}`);
const build = spawnSync(gradlew, [task], {
  cwd: androidRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (build.status !== 0) process.exit(build.status ?? 1);

const apkDir = resolve(androidRoot, 'app', 'build', 'outputs', 'apk', buildType);
console.log(`\n[build-apk] 完成。APK 目录：\n  ${apkDir}\n`);
