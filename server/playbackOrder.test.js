import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildUserRoundRobinOrder } from "./playbackOrder.js";

describe("buildUserRoundRobinOrder", () => {
  it("按用户轮转消费，直到所有用户队列耗尽", () => {
    const songs = [
      { queueId: "a1", requestedById: "A", requestedAt: 1 },
      { queueId: "a2", requestedById: "A", requestedAt: 2 },
      { queueId: "a3", requestedById: "A", requestedAt: 3 },
      { queueId: "b1", requestedById: "B", requestedAt: 4 },
      { queueId: "b2", requestedById: "B", requestedAt: 5 },
      { queueId: "c1", requestedById: "C", requestedAt: 6 },
    ];

    assert.deepEqual(
      buildUserRoundRobinOrder(songs, { userOrder: ["A", "B", "C"] }).map((song) => song.queueId),
      ["a1", "b1", "c1", "a2", "b2", "a3"],
    );
  });

  it("同一用户歌曲可按随机选择器取出，但用户配额仍逐轮递减", () => {
    const songs = [
      { queueId: "a1", requestedById: "A", requestedAt: 1 },
      { queueId: "a2", requestedById: "A", requestedAt: 2 },
      { queueId: "b1", requestedById: "B", requestedAt: 3 },
    ];
    const selected = buildUserRoundRobinOrder(songs, {
      userOrder: ["A", "B"],
      pickSong: (userSongs) => userSongs[userSongs.length - 1],
    });

    assert.deepEqual(selected.map((song) => song.queueId), ["a2", "b1", "a1"]);
  });

  it("未提供用户顺序时按首次点歌顺序建立轮转顺序", () => {
    const songs = [
      { queueId: "c1", requestedById: "C", requestedAt: 1 },
      { queueId: "a1", requestedById: "A", requestedAt: 2 },
      { queueId: "c2", requestedById: "C", requestedAt: 3 },
      { queueId: "b1", requestedById: "B", requestedAt: 4 },
    ];

    assert.deepEqual(
      buildUserRoundRobinOrder(songs).map((song) => song.queueId),
      ["c1", "a1", "b1", "c2"],
    );
  });
});
