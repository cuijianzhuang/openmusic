import test from "node:test";
import assert from "node:assert/strict";
import {
  addUser,
  createRoom,
  removeRoomMemberTier,
  setRoomAdmin,
  setRoomMemberTier,
  setRoomAdminSelfManageMemberTier,
} from "./roomManager.js";

function createRoomWithOwnerAndAdmin() {
  const created = createRoom({ name: "贵宾权限测试", creatorId: "owner-user-1" });
  assert.ok(created?.id);
  const roomId = created.id;
  assert.equal(created.adminSelfManageMemberTierEnabled, false);
  assert.ok(addUser(roomId, "owner-user-1", "房主", { connectionId: "owner-connection" }));
  assert.ok(addUser(roomId, "admin-user-1", "管理员", { connectionId: "admin-connection" }));
  const adminResult = setRoomAdmin(roomId, "owner-user-1", "admin-user-1", true, "owner-connection");
  assert.equal(adminResult.error, undefined);
  return roomId;
}

const tier = {
  badgeLabel: "自定义",
  badgeColor: "#f6d365",
  borderStyleId: "solid",
  borderColor: "#f6d365",
};

test("管理员默认不能修改自己的贵宾标识", () => {
  const roomId = createRoomWithOwnerAndAdmin();
  const result = setRoomMemberTier(roomId, "admin-user-1", "admin-user-1", tier, "admin-connection");
  assert.equal(result.error, "仅房主可修改房主或管理员的贵宾设置");
});

test("房主开启后管理员可以修改自己的贵宾标识但不能修改别人的", () => {
  const roomId = createRoomWithOwnerAndAdmin();
  const enabled = setRoomAdminSelfManageMemberTier(roomId, "owner-user-1", true, "owner-connection");
  assert.equal(enabled.error, undefined);

  const selfResult = setRoomMemberTier(roomId, "admin-user-1", "admin-user-1", tier, "admin-connection");
  assert.equal(selfResult.error, undefined);

  const otherResult = setRoomMemberTier(roomId, "admin-user-1", "regular-user-1", tier, "admin-connection");
  assert.equal(otherResult.error, "仅房主可修改其他用户的贵宾设置");
});

test("管理员不能修改允许自助设置的房主开关", () => {
  const roomId = createRoomWithOwnerAndAdmin();
  const result = setRoomAdminSelfManageMemberTier(roomId, "admin-user-1", true, "admin-connection");
  assert.equal(result.error, "仅房间创建者可操作");
});

test("房主开启后管理员可以移除自己的贵宾标识但不能移除别人的", () => {
  const roomId = createRoomWithOwnerAndAdmin();
  assert.equal(setRoomAdminSelfManageMemberTier(roomId, "owner-user-1", true, "owner-connection").error, undefined);
  assert.equal(setRoomMemberTier(roomId, "admin-user-1", "admin-user-1", tier, "admin-connection").error, undefined);

  const selfResult = removeRoomMemberTier(roomId, "admin-user-1", "admin-user-1", "admin-connection");
  assert.equal(selfResult.error, undefined);

  const otherResult = removeRoomMemberTier(roomId, "admin-user-1", "regular-user-1", "admin-connection");
  assert.equal(otherResult.error, "仅房主可修改其他用户的贵宾设置");
});
