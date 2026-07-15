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
  },
}));
vi.mock("../../setup/replay-constraints", () => ({
  collectReplayStatements: () => ["SELECT destructive_replay()"],
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
});
