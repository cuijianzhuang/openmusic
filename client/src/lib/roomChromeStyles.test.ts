import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../index.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

function touchChromeFallbackBlock() {
  const marker = '@media (hover: none) and (pointer: coarse) {';
  const start = css.indexOf(marker);
  if (start < 0) return '';

  let depth = 0;
  for (let index = start; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, index + 1);
    }
  }

  return '';
}

test('触控设备底栏使用稳定合成，避免点击按钮时队列底部闪黑', () => {
  const block = touchChromeFallbackBlock();

  assert.notEqual(block, '', '缺少触控设备底栏合成降级规则');
  assert.match(block, /\.mineradio-bottom-bar\.visible[\s\S]*?backdrop-filter:\s*none\s*!important/);
  assert.match(block, /\.mineradio-bottom-bar\.visible[\s\S]*?-webkit-backdrop-filter:\s*none\s*!important/);
  assert.match(block, /\.room-chrome-bar[\s\S]*?backdrop-filter:\s*none\s*!important/);
  assert.match(block, /\.room-chrome-bar[\s\S]*?-webkit-backdrop-filter:\s*none\s*!important/);
});

test('鼠标设备底栏保持稳定合成，避免悬停按钮时队列底部闪烁', () => {
  const marker = '@media (hover: hover) and (pointer: fine) {';
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, 'missing fine pointer bottom bar fallback');

  const block = css.slice(start, css.indexOf('\n}', start) + 2);
  assert.match(block, /\.room-player-bar\.room-chrome-bar/);
  assert.match(block, /backdrop-filter:\s*none\s*!important/);
  assert.match(block, /-webkit-backdrop-filter:\s*none\s*!important/);
});

test('鼠标设备底栏允许音量提示向上溢出，避免被绘制裁剪', () => {
  const marker = '@media (hover: hover) and (pointer: fine) {';
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, 'missing fine pointer bottom bar fallback');

  const block = css.slice(start, css.indexOf('\n}', start) + 2);
  assert.match(block, /contain:\s*layout/);
  assert.doesNotMatch(block, /contain:\s*paint/);
});
