/**
 * 本地命令行打 APK（无需 Android Studio，但仍需 JDK + Android SDK）。
 * 用法：npm run cap:build:apk
 *
 * 默认每次打包自动 bump versionCode +1、versionName 末位 +1。
 * 跳过自增：npm run cap:build:apk -- --no-bump
 * GitHub Actions 见 .github/workflows/android-apk.yml（同样会 bump 并回写仓库）。
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bumpAndroidVersion, readAndroidVersion } from './bump-android-version.mjs';

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(clientRoot, '..');
const androidRoot = resolve(clientRoot, 'android');
const rawArgs = process.argv.slice(2);
const noBump = rawArgs.includes('--no-bump');
const buildType = (rawArgs.find((a) => !a.startsWith('--')) || 'debug').toLowerCase();
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

let versionLabel = '';
if (noBump) {
  const v = readAndroidVersion();
  versionLabel = `${v.versionName} (${v.versionCode})`;
  console.log(`[build-apk] 跳过版本自增，沿用 ${versionLabel}`);
} else {
  const bumped = bumpAndroidVersion();
  versionLabel = `${bumped.versionName} (${bumped.versionCode})`;
  console.log(`[build-apk] 版本已自增 → ${versionLabel}`);
}

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
const builtApk = readdirSync(apkDir).find((f) => f.endsWith('.apk'));
if (!builtApk) {
  console.error(`[build-apk] 未在 ${apkDir} 找到 APK`);
  process.exit(1);
}
const builtPath = resolve(apkDir, builtApk);
const downloadsDir = resolve(repoRoot, 'server', 'downloads');
mkdirSync(downloadsDir, { recursive: true });
const deployPath = resolve(downloadsDir, 'openmusic.apk');
copyFileSync(builtPath, deployPath);

console.log(`
[build-apk] 完成。
  版本:     ${versionLabel}
  构建产物: ${builtPath}
  下载位:   ${deployPath}

覆盖安装条件：同包名 com.openmusic.app + versionCode 更大 + 同一签名（openmusic.jks）。
若手机上旧包是以前 debug 随机签名，需先卸载一次，之后即可直接覆盖。
`);
