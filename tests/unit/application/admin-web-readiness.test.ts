import { beforeEach, describe, expect, it, vi } from "vitest";

const { probeTemporal, redisPing, runTransaction } = vi.hoisted(() => ({
  probeTemporal: vi.fn(),
  redisPing: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  assessmentRepo: {},
  contestRepo: {},
  courseRepo: {},
  problemRepo: {},
  runTransaction,
  submissionRepo: {},
  userRepo: {},
}));
vi.mock("@nojv/redis", () => ({
  getRedis: () => ({ ping: redisPing }),
  keys: {},
}));
vi.mock("../../../packages/application/src/shared/orchestration", () => ({
  getDomainOrchestration: () => ({ probeTemporal }),
}));

const { checkWebReadiness } = await import("../../../packages/application/src/admin/index");

beforeEach(() => {
  probeTemporal.mockReset();
  redisPing.mockReset().mockResolvedValue("PONG");
  runTransaction.mockReset().mockResolvedValue(undefined);
});

describe("checkWebReadiness", () => {
  it("probes PostgreSQL and Redis concurrently without putting Temporal on the path", async () => {
    let finishPostgres!: () => void;
    runTransaction.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishPostgres = resolve;
      }),
    );

    const pending = checkWebReadiness();

    expect(runTransaction).toHaveBeenCalledOnce();
    expect(redisPing).toHaveBeenCalledOnce();
    expect(probeTemporal).not.toHaveBeenCalled();
    finishPostgres();
    await expect(pending).resolves.toBe(true);
  });

  it.each([
    ["PostgreSQL", () => runTransaction.mockRejectedValueOnce(new Error("db down"))],
    ["Redis", () => redisPing.mockRejectedValueOnce(new Error("redis down"))],
  ])("fails readiness closed when %s is unavailable", async (_name, failProbe) => {
    failProbe();

    await expect(checkWebReadiness()).resolves.toBe(false);
    expect(probeTemporal).not.toHaveBeenCalled();
  });

  it("bounds dependency probes with the supplied timeout", async () => {
    vi.useFakeTimers();
    runTransaction.mockReturnValueOnce(new Promise(() => undefined));

    const pending = checkWebReadiness(100);
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toBe(false);
    vi.useRealTimers();
  });
});
