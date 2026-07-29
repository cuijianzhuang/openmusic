import assert from 'node:assert/strict';
import {
  checkRoomCreateCooldown,
  recordRoomCreateAndMaybeAutoBan,
  evaluateRoomCreateRejectAutoBan,
  _resetRoomCreateGuardForTests,
} from '../roomCreateGuard.js';

async function main() {
  _resetRoomCreateGuardForTests();

  const ip = '203.0.113.10';
  const deviceId = 'testdevice12345678';

  // 5 分钟只能建一次
  assert.equal(checkRoomCreateCooldown({ ip, deviceId }).allowed, true);
  await recordRoomCreateAndMaybeAutoBan({
    ip,
    deviceId,
    name: '自用',
    roomId: 'AAAAAA',
    listRoomsForGuard: () => [],
  });
  const blocked = checkRoomCreateCooldown({ ip, deviceId });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec > 0);

  // 撞限流会计入拒绝历史，评估不抛错
  for (let i = 0; i < 5; i += 1) {
    assert.equal(checkRoomCreateCooldown({ ip, deviceId }).allowed, false);
  }
  const rejectEval = await evaluateRoomCreateRejectAutoBan({
    ip,
    deviceId,
    listRoomsForGuard: () => [],
  });
  assert.ok(Array.isArray(rejectEval.bans));

  // 不同 IP 不受影响
  assert.equal(checkRoomCreateCooldown({ ip: '203.0.113.11', deviceId: 'otherdevice123456' }).allowed, true);

  console.log('roomCreateGuard smoke ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
