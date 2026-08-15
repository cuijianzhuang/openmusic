#!/usr/bin/env node
/**
 * Build Flutter APK and copy to server/downloads/openmusic.apk
 *
 *   node scripts/build-flutter-apk.mjs --server-url=https://example.com [--release]
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(mobileRoot, '..');

const args = process.argv.slice(2);
const release = args.includes('--release');
const noVersionBump = args.includes('--no-version-bump');
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

function bumpAndroidBuildNumber() {
  const pubspecPath = path.join(mobileRoot, 'pubspec.yaml');
  const pubspec = readFileSync(pubspecPath, 'utf8');
  const versionMatch = pubspec.match(/^version:\s*(\d+)\.(\d+)\.(\d+)\+(\d+)\s*$/m);
  if (!versionMatch) {
    console.error('Cannot find Flutter version in pubspec.yaml, expected: version: x.y.z+build');
    process.exit(1);
  }

  const [, major, minor, patch, build] = versionMatch;
  const nextBuild = Number(build) + 1;
  if (!Number.isSafeInteger(nextBuild) || nextBuild <= Number(build)) {
    console.error('Invalid Flutter build number in pubspec.yaml:', build);
    process.exit(1);
  }

  const previous = `${major}.${minor}.${patch}+${build}`;
  const next = `${major}.${minor}.${patch}+${nextBuild}`;
  writeFileSync(pubspecPath, pubspec.replace(versionMatch[0], `version: ${next}`));
  console.log(`Bumped Android version: ${previous} -> ${next}`);
  return next;
}

if (release && !noVersionBump) {
  bumpAndroidBuildNumber();
}

const buildType = release ? 'apk' : 'apk';
const mode = release ? '--release' : '--debug';
const r = spawnSync(
  flutter,
  [
    'build',
    buildType,
    mode,
    '--dart-define=OM_FLAVOR=prod',
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
