/**
 * Capacitor sync：远程 URL 模式用 capacitor-stub 占位 webDir，避免每次全量 build。
 * 未配置 CAPACITOR_SERVER_URL 时会先执行 vite build。
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stubDir = resolve(clientRoot, 'capacitor-stub');
const distDir = resolve(clientRoot, 'dist');
const envPath = resolve(clientRoot, '.env.capacitor');
const configPath = resolve(clientRoot, 'capacitor.config.json');

function getServerUrl() {
  if (process.env.CAPACITOR_SERVER_URL?.trim()) {
    return process.env.CAPACITOR_SERVER_URL.trim();
  }
  if (!existsSync(envPath)) return '';
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^CAPACITOR_SERVER_URL=(.+)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

function writeCapacitorConfig(serverUrl) {
  const base = JSON.parse(readFileSync(configPath, 'utf8'));
  const normalized = serverUrl.replace(/\/+$/, '');
  if (normalized) {
    base.server = {
      url: normalized,
      cleartext: normalized.startsWith('http://'),
      androidScheme: normalized.startsWith('https://') ? 'https' : 'http',
    };
    console.log(`[cap-sync] 远程 URL 模式: ${normalized}`);
  } else {
    delete base.server;
    console.log('[cap-sync] 未配置 CAPACITOR_SERVER_URL，将同步本地 dist');
  }
  writeFileSync(configPath, `${JSON.stringify(base, null, 2)}\n`);
}

const serverUrl = getServerUrl();
const platform = process.argv[2] || '';

writeCapacitorConfig(serverUrl);

if (serverUrl) {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  cpSync(stubDir, distDir, { recursive: true });
} else {
  console.log('[cap-sync] 执行 vite build…');
  const build = spawnSync('npm run build', { cwd: clientRoot, stdio: 'inherit', shell: true });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const capArgs = ['cap', 'sync', ...(platform ? [platform] : [])];
const sync = spawnSync('npx', capArgs, { cwd: clientRoot, stdio: 'inherit', shell: true });

// 恢复仓库内的基础配置，避免 server.url 被提交
writeCapacitorConfig('');

process.exit(sync.status ?? 1);
