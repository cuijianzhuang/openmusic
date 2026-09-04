import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getChatImageDisplayUrl } from './chatImage';

test('聊天列表使用七牛缩略图，原图地址保持不变', () => {
  const original = 'https://cdn.example.com/openmusic/chat/room/a.jpg';
  assert.equal(
    getChatImageDisplayUrl(original, 'openmusic/chat/room/a.jpg'),
    `${original}?imageView2/2/w/440/interlace/1`,
  );
  assert.equal(getChatImageDisplayUrl(original, null), original);
});
