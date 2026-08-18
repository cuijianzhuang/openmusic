import test from 'node:test';
import assert from 'node:assert/strict';
import {
  _resetRoomCreateGuardForTests,
  _setRoomCreateGuardSettingsForTests,
  checkRoomCreateCooldown,
  recordRoomCreate,
} from './roomCreateGuard.js';
import { SOFT_BLOCK_CODES } from './softBlock.js';

test('room create guard blocks repeated creates by device id during cooldown', () => {
  _resetRoomCreateGuardForTests();
  _setRoomCreateGuardSettingsForTests({ cooldownMs: 60_000, ipLooseCooldownMs: 0 });

  const identity = { deviceId: 'device_12345678', userId: '', ip: '203.0.113.10' };
  assert.deepEqual(checkRoomCreateCooldown(identity), { allowed: true });

  recordRoomCreate(identity);
  const blocked = checkRoomCreateCooldown(identity);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, SOFT_BLOCK_CODES.ROOM_CREATE_COOLDOWN);
  assert.equal(blocked.retryAfterSec > 0, true);

  _resetRoomCreateGuardForTests();
});

test('room create guard uses loose IP cooldown when device and user ids are absent', () => {
  _resetRoomCreateGuardForTests();
  _setRoomCreateGuardSettingsForTests({ cooldownMs: 60_000, ipLooseCooldownMs: 30_000 });

  const identity = { ip: '203.0.113.20' };
  assert.deepEqual(checkRoomCreateCooldown(identity), { allowed: true });

  recordRoomCreate(identity);
  const blocked = checkRoomCreateCooldown(identity);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, SOFT_BLOCK_CODES.ROOM_CREATE_COOLDOWN_IP);

  _resetRoomCreateGuardForTests();
});
