import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock, execSyncMock, executeRawMock, queryRawMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  execSyncMock: vi.fn(),
  executeRawMock: vi.fn(),
  queryRawMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
  execSync: execSyncMock,
}));
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

import globalSetup from "../../setup/global-setup";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  execFileSyncMock.mockReset();
  execSyncMock.mockReset();
  executeRawMock.mockReset();
  queryRawMock.mockReset();
});

describe("integration global setup fail-closed ordering", () => {
  it("performs zero destructive calls when TEST_DATABASE_URL is absent", async () => {
    delete process.env.TEST_DATABASE_URL;
    process.env.NOJV_DESTRUCTIVE_TEST_DATABASE = "nojv_test";
    process.env.DATABASE_URL =
      "postgresql://production:secret@production.example.com:5432/nojv";

    let rejection: unknown;
    try {
      await globalSetup();
    } catch (error) {
      rejection = error;
    }

    expect.soft(rejection).toBeInstanceOf(Error);
    expect.soft(String(rejection)).toContain("TEST_DATABASE_URL");
    expect.soft(execFileSyncMock).not.toHaveBeenCalled();
    expect.soft(execSyncMock).not.toHaveBeenCalled();
    expect.soft(executeRawMock).not.toHaveBeenCalled();
  });

  it("performs zero destructive calls when the durable live marker is wrong", async () => {
    process.env.TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/nojv_test";
    process.env.NOJV_DESTRUCTIVE_TEST_DATABASE = "nojv_test";
    queryRawMock.mockResolvedValue([
      {
        currentDatabase: "nojv_test",
        marker: null,
        serverAddress: "192.168.107.5/32",
        serverPort: 5432,
      },
    ]);

    await expect(globalSetup()).rejects.toThrow(/COMMENT/);
    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(execSyncMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it("resets the proven schema before applying the committed migrations", async () => {
    process.env.TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/nojv_test";
    process.env.NOJV_DESTRUCTIVE_TEST_DATABASE = "nojv_test";
    queryRawMock.mockResolvedValue([
      {
        currentDatabase: "nojv_test",
        marker: "NOJV_TEST_DATABASE:nojv_test",
        serverAddress: "192.168.107.5/32",
        serverPort: 5432,
      },
    ]);

    await globalSetup();

    expect(executeRawMock.mock.calls).toEqual([
      ['DROP SCHEMA IF EXISTS "public" CASCADE'],
      ['CREATE SCHEMA "public"'],
    ]);
    expect(execFileSyncMock).toHaveBeenCalledOnce();
    const [command, args, options] = execFileSyncMock.mock.calls[0] as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect([command, ...args]).toEqual([
      "pnpm",
      "--filter",
      "@nojv/db",
      "exec",
      "prisma",
      "migrate",
      "deploy",
    ]);
    expect(options.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
    expect(queryRawMock.mock.invocationCallOrder[0]!).toBeLessThan(
      executeRawMock.mock.invocationCallOrder[0]!,
    );
    expect(executeRawMock.mock.invocationCallOrder[1]!).toBeLessThan(
      execFileSyncMock.mock.invocationCallOrder[0]!,
    );
  });
});
