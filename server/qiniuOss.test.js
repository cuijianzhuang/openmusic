import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CHAT_IMAGE_BYTES } from './qiniuOss.js';

test('房间聊天七牛上传上限与客户端约定为 5 MiB', () => {
  assert.equal(MAX_CHAT_IMAGE_BYTES, 5 * 1024 * 1024);
});
