import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoomSharePayload } from './roomShare';

test('buildRoomSharePayload uses the entry URL for both QR and invite copy', () => {
  const payload = buildRoomSharePayload({
    inviterNickname: '小明',
    roomId: 'ABC123',
    roomName: '深夜电台',
    password: 'secret',
    currentSong: { name: '晴天', artist: '周杰伦' },
    isPlaying: true,
    origin: 'https://openmusic.example',
  });

  assert.equal(payload.url, 'https://openmusic.example/room/ABC123?pwd=secret');
  assert.match(payload.text, /小明 邀请你加入 OpenMusic 房间「深夜电台」/);
  assert.match(payload.text, /正在播放《晴天》— 周杰伦/);
  assert.match(payload.text, /密码：secret/);
  assert.ok(payload.text.endsWith(`👉 ${payload.url}`));
});
