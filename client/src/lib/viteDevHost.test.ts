import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const configPath = fileURLToPath(new URL('../../vite.config.ts', import.meta.url));
const config = readFileSync(configPath, 'utf8');

test('开发服务器允许 cpolar 测试域名访问', () => {
  assert.match(config, /allowedHosts\s*:\s*\[[\s\S]*?3c602da\.r21\.cpolar\.top[\s\S]*?\]/);
});
