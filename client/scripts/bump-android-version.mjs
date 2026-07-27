/**
 * 自增 Android versionCode / versionName（写入 app/build.gradle）。
 * 用法：node scripts/bump-android-version.mjs
 * 仅打印当前版本：node scripts/bump-android-version.mjs --print
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gradlePath = resolve(clientRoot, 'android', 'app', 'build.gradle');

export function readAndroidVersion(filePath = gradlePath) {
  const src = readFileSync(filePath, 'utf8');
  const codeMatch = src.match(/versionCode\s+(\d+)/);
  const nameMatch = src.match(/versionName\s+"([^"]+)"/);
  if (!codeMatch || !nameMatch) {
    throw new Error(`无法在 ${filePath} 解析 versionCode / versionName`);
  }
  return {
    versionCode: Number(codeMatch[1]),
    versionName: nameMatch[1],
    src,
    filePath,
  };
}

/** versionCode +1，versionName 末位 +1（1.0.2 → 1.0.3） */
export function bumpAndroidVersion(filePath = gradlePath) {
  const current = readAndroidVersion(filePath);
  const nextCode = current.versionCode + 1;
  const parts = current.versionName.split('.').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`versionName 格式异常: ${current.versionName}`);
  }
  while (parts.length < 3) parts.push(0);
  parts[parts.length - 1] += 1;
  const nextName = parts.join('.');

  const next = current.src
    .replace(/versionCode\s+\d+/, `versionCode ${nextCode}`)
    .replace(/versionName\s+"[^"]+"/, `versionName "${nextName}"`);
  writeFileSync(filePath, next, 'utf8');
  return {
    versionCode: nextCode,
    versionName: nextName,
    previousCode: current.versionCode,
    previousName: current.versionName,
  };
}

const isMain = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const printOnly = process.argv.includes('--print');
  if (printOnly) {
    const v = readAndroidVersion();
    console.log(`${v.versionName} (${v.versionCode})`);
  } else {
    const v = bumpAndroidVersion();
    console.log(
      `[bump-android] ${v.previousName} (${v.previousCode}) → ${v.versionName} (${v.versionCode})`,
    );
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `version_name=${v.versionName}\nversion_code=${v.versionCode}\n`,
      );
    }
  }
}
