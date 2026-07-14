import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock, executeRawMock, launchMock, queryRawMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  executeRawMock: vi.fn(),
  launchMock: vi.fn(),
  queryRawMock: vi.fn(),
}));

vi.mock("@playwright/test", () => ({
  chromium: { launch: launchMock },
}));
vi.mock("node:child_process", () => ({ execFileSync: execFileSyncMock }));
vi.mock("node:fs", () => ({ existsSync: () => false }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));
vi.mock("../../../packages/db/generated/prisma/client", () => ({
  PrismaClient: class {
    $disconnect = vi.fn();
    $executeRawUnsafe = executeRawMock;
    $queryRawUnsafe = queryRawMock;
    $transaction = vi.fn(async (callback: (transaction: this) => Promise<void>) =>
      callback(this),
    );
  },
}));
vi.mock("../../setup/replay-constraints", () => ({
  collectReplayStatements: () => ["SELECT destructive_replay()"],
}));

import playwrightGlobalSetup from "../../setup/playwright-global-setup";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  execFileSyncMock.mockReset();
  launchMock.mockReset();
  executeRawMock.mockReset();
  queryRawMock.mockReset();
});

describe("Playwright global setup fail-closed ordering", () => {
  it("performs zero schema, seed, or browser calls when the live proof fails", async () => {
    process.env.TEST_DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:5432/nojv_e2e_test";
    process.env.NOJV_DESTRUCTIVE_TEST_DATABASE = "nojv_e2e_test";
    queryRawMock.mockResolvedValue([
      {
        currentDatabase: "nojv_e2e_test",
        marker: null,
        serverAddress: "192.168.107.5/32",
        serverPort: 5432,
      },
    ]);

    await expect(playwrightGlobalSetup({ projects: [] } as never)).rejects.toThrow(/COMMENT/);

    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
    expect(launchMock).not.toHaveBeenCalled();
  });

  it("passes the same explicit storage environment to the seed process", async () => {
    process.env.TEST_DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:5432/nojv_e2e_test";
    process.env.NOJV_DESTRUCTIVE_TEST_DATABASE = "nojv_e2e_test";
    queryRawMock.mockResolvedValue([
      {
        currentDatabase: "nojv_e2e_test",
        marker: "NOJV_TEST_DATABASE:nojv_e2e_test",
        serverAddress: "192.168.107.5/32",
        serverPort: 5432,
      },
    ]);
    execFileSyncMock
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("seed boundary reached");
      });

    await expect(playwrightGlobalSetup({ projects: [] } as never)).rejects.toThrow(
      "seed boundary reached",
    );

    const seedOptions = execFileSyncMock.mock.calls[1]?.[2] as
      { env?: NodeJS.ProcessEnv } | undefined;
    expect(seedOptions?.env).toMatchObject({
      S3_ACCESS_KEY: "minioadmin",
      S3_BUCKET: "nojv",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_REGION: "us-east-1",
      S3_SECRET_KEY: "minioadmin",
    });
    expect(executeRawMock).toHaveBeenCalledOnce();
    expect(executeRawMock).toHaveBeenCalledWith("SELECT destructive_replay()");
    expect(launchMock).not.toHaveBeenCalled();

    const dbPushOrder = execFileSyncMock.mock.invocationCallOrder[0]!;
    const replayProofOrder = queryRawMock.mock.invocationCallOrder[1]!;
    const replayOrder = executeRawMock.mock.invocationCallOrder[0]!;
    const seedOrder = execFileSyncMock.mock.invocationCallOrder[1]!;
    expect(dbPushOrder).toBeLessThan(replayProofOrder);
    expect(replayProofOrder).toBeLessThan(replayOrder);
    expect(replayOrder).toBeLessThan(seedOrder);
  });

  it("stops before seed or browser startup when invariant replay fails", async () => {
    process.env.TEST_DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:5432/nojv_e2e_test";
    process.env.NOJV_DESTRUCTIVE_TEST_DATABASE = "nojv_e2e_test";
    queryRawMock.mockResolvedValue([
      {
        currentDatabase: "nojv_e2e_test",
        marker: "NOJV_TEST_DATABASE:nojv_e2e_test",
        serverAddress: "192.168.107.5/32",
        serverPort: 5432,
      },
    ]);
    executeRawMock.mockRejectedValue(new Error("invariant replay failed"));

    await expect(playwrightGlobalSetup({ projects: [] } as never)).rejects.toThrow(
      "invariant replay failed",
    );

    expect(queryRawMock).toHaveBeenCalledTimes(2);
    expect(executeRawMock).toHaveBeenCalledOnce();
    expect(execFileSyncMock).toHaveBeenCalledOnce();
    expect(launchMock).not.toHaveBeenCalled();
  });
});
