import test from 'node:test';
import assert from 'node:assert/strict';
import { isQishuiLocalPlaybackUrl } from './qishuiLocalPlayback.ts';

test('识别汽水本地解密播放会话地址', () => {
  assert.equal(isQishuiLocalPlaybackUrl('/api/qishui-source?t=token'), true);
  assert.equal(isQishuiLocalPlaybackUrl('https://music.example/api/qishui-source?t=token'), true);
  assert.equal(isQishuiLocalPlaybackUrl('/api/meting?server=qishui&type=url&id=1'), false);
  assert.equal(isQishuiLocalPlaybackUrl('blob:https://music.example/id'), false);
});
