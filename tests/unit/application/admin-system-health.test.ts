import { beforeEach, describe, expect, it, vi } from "vitest";

const { userCount, submissionCount, redisPing, probeTemporal } = vi.hoisted(() => ({
  userCount: vi.fn(),
  submissionCount: vi.fn(),
  redisPing: vi.fn(),
  probeTemporal: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  userRepo: { count: userCount },
  submissionRepo: { count: submissionCount },
}));

vi.mock("@nojv/redis", () => ({
  getRedis: () => ({
    ping: redisPing,
    get: async () => null,
    set: async () => "OK",
    del: async () => 0,
  }),
  createRateLimiterConnection: () => ({}),
  keys: {},
}));

import { adminDomain, configureDomainOrchestration } from "@nojv/application";

const { getSystemHealth } = adminDomain;

function hasCreatedAt(where: unknown): boolean {
  return typeof where === "object" && where !== null && "createdAt" in where;
}

describe("getSystemHealth", () => {
  beforeEach(() => {
    userCount.mockResolvedValue(42);
    redisPing.mockResolvedValue("PONG");
    probeTemporal.mockResolvedValue(undefined);
    submissionCount.mockImplementation(async (where: unknown) => (hasCreatedAt(where) ? 1 : 3));
    configureDomainOrchestration({
      probeTemporal,
    } as unknown as Parameters<typeof configureDomainOrchestration>[0]);
  });

  it("reports ok for every dependency and surfaces the live judging counts", async () => {
    const health = await getSystemHealth();

    expect(health).toEqual({
      database: "ok",
      redis: "ok",
      temporal: "ok",
      pendingJudging: 3,
      staleJudging: 1,
    });
  });

  it("marks redis down when ping rejects without throwing", async () => {
    redisPing.mockRejectedValue(new Error("ECONNREFUSED"));

    const health = await getSystemHealth();

    expect(health.redis).toBe("down");
    expect(health.database).toBe("ok");
    expect(health.temporal).toBe("ok");
    expect(health.pendingJudging).toBe(3);
    expect(health.staleJudging).toBe(1);
  });
});

it("keeps a failed queue query distinct from zero and logs the cause", async () => {
  const reason = new Error("queue count timeout");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  submissionCount.mockRejectedValueOnce(reason).mockResolvedValueOnce(0);
  try {
    const health = await getSystemHealth();
    expect(health.pendingJudging).toBeNull();
    expect(health.staleJudging).toBe(0);
    expect(log).toHaveBeenCalledWith("Failed to count pending submissions", reason);
  } finally {
    log.mockRestore();
  }
});
