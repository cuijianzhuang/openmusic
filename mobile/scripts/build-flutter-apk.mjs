#!/usr/bin/env node
/**
 * Build Flutter APK and copy to server/downloads/openmusic.apk
 *
 *   node scripts/build-flutter-apk.mjs --server-url=https://example.com [--release]
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(mobileRoot, '..');

const args = process.argv.slice(2);
const release = args.includes('--release');
const serverArg = args.find((a) => a.startsWith('--server-url='));
const serverUrl = serverArg?.slice('--server-url='.length) || process.env.OM_SERVER_URL;
if (!serverUrl) {
  console.error('Missing --server-url= or OM_SERVER_URL');
  process.exit(1);
}

const flutter =
  process.env.FLUTTER_ROOT
    ? path.join(process.env.FLUTTER_ROOT, 'bin', process.platform === 'win32' ? 'flutter.bat' : 'flutter')
    : process.platform === 'win32' && existsSync('C:\\flutter\\bin\\flutter.bat')
      ? 'C:\\flutter\\bin\\flutter.bat'
      : 'flutter';

const buildType = release ? 'apk' : 'apk';
const mode = release ? '--release' : '--debug';
const r = spawnSync(
  flutter,
  [
    'build',
    buildType,
    mode,
    `--dart-define=OM_SERVER_URL=${serverUrl}`,
  ],
  { cwd: mobileRoot, stdio: 'inherit', shell: process.platform === 'win32' },
);
if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);

const apkDir = path.join(
  mobileRoot,
  'build',
  'app',
  'outputs',
  'flutter-apk',
);
const apkName = release ? 'app-release.apk' : 'app-debug.apk';
const src = path.join(apkDir, apkName);
if (!existsSync(src)) {
  console.error('APK not found at', src);
  process.exit(1);
}
const destDir = path.join(repoRoot, 'server', 'downloads');
mkdirSync(destDir, { recursive: true });
const dest = path.join(destDir, 'openmusic.apk');
copyFileSync(src, dest);
console.log('Copied', src, '->', dest);
