import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../index.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

test('播放器底栏不因队列绘制问题被强制覆盖为不透明深色', () => {
  assert.doesNotMatch(
    css,
    /\.room-player-bar\.room-chrome-bar:not\(\.room-chrome-bar--ambient\)[\s\S]*?background:\s*rgba\(8,\s*10,\s*14,\s*0\.88\)\s*!important/,
  );
});

test('播放队列面板使用独立绘制层，避免播放器交互时队列区域闪黑', () => {
  const marker = '.room-main-panel--queue {';
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, '缺少播放队列的稳定绘制规则');

  const block = css.slice(start, css.indexOf('\n}', start) + 2);
  assert.match(block, /isolation:\s*isolate/);
  assert.match(block, /contain:\s*paint/);
  assert.match(block, /transform:\s*translateZ\(0\)/);
});
