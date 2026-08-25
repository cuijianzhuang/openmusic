import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const configPath = fileURLToPath(new URL('../../vite.config.ts', import.meta.url));
const config = readFileSync(configPath, 'utf8');

test('开发服务器保留本地 API 代理配置', () => {
  assert.match(config, /server:\s*\{[\s\S]*?port:\s*5173/);
  assert.match(config, /'\/api':\s*\{\s*target:\s*'http:\/\/localhost:4000'/);
});