import { beforeEach, describe, expect, it, vi } from "vitest";

const { setMock, publishMock, pubsubErrorHandler } = vi.hoisted(() => ({
  setMock: vi.fn(),
  publishMock: vi.fn(() => Promise.resolve(1)),
  pubsubErrorHandler: vi.fn(),
}));

vi.mock("../../../packages/redis/src/connection", () => ({
  getRedis: () => ({ set: setMock, publish: publishMock }),
}));

import {
  publishScoreboardUpdate,
  setPubsubErrorHandler,
} from "../../../packages/redis/src/pubsub";

beforeEach(() => {
  vi.clearAllMocks();
  setPubsubErrorHandler(pubsubErrorHandler);
});

describe("publishScoreboardUpdate — throttled contest scoreboard signal", () => {
  it("publishes once when the throttle key is newly acquired (SET NX → OK)", async () => {
    setMock.mockResolvedValueOnce("OK");

    await publishScoreboardUpdate("ctst_1");

    expect(setMock).toHaveBeenCalledWith(
      expect.stringContaining("ctst_1"),
      "1",
      "EX",
      expect.any(Number),
      "NX",
    );
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith(
      expect.stringContaining("ctst_1"),
      expect.stringContaining("scoreboard:update"),
    );
  });

  it("skips publishing while throttled (key already set → SET NX returns null)", async () => {
    setMock.mockResolvedValueOnce(null);

    await publishScoreboardUpdate("ctst_1");

    expect(publishMock).not.toHaveBeenCalled();
  });

  it("never throws when Redis is unavailable", async () => {
    setMock.mockRejectedValueOnce(new Error("redis down"));

    await expect(publishScoreboardUpdate("ctst_1")).resolves.toBeUndefined();
    expect(publishMock).not.toHaveBeenCalled();
    expect(pubsubErrorHandler).toHaveBeenCalledWith({
      operation: "scoreboard",
      channel: expect.stringContaining("ctst_1"),
      err: expect.any(Error),
    });
  });
});
