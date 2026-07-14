import { afterEach, describe, expect, it, vi } from "vitest";

const { disconnectMock, execFileSyncMock, launchMock, queryRawMock, truncateMock } = vi.hoisted(
  () => ({
    disconnectMock: vi.fn(),
    execFileSyncMock: vi.fn(),
    launchMock: vi.fn(),
    queryRawMock: vi.fn(),
    truncateMock: vi.fn(),
  }),
);

vi.mock("@playwright/test", () => ({
  chromium: { launch: launchMock },
}));
vi.mock("node:child_process", () => ({ execFileSync: execFileSyncMock }));
vi.mock("node:fs", () => ({ existsSync: () => false }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));
vi.mock("../../../packages/db/generated/prisma/client", () => ({
  PrismaClient: class {
    $disconnect = vi.fn();
    $queryRawUnsafe = queryRawMock;
  },
}));
vi.mock("../../fixtures/seed-test-db", () => ({
  disconnectTestDb: disconnectMock,
  truncateAllTables: truncateMock,
}));

import playwrightGlobalSetup from "../../setup/playwright-global-setup";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  execFileSyncMock.mockReset();
  disconnectMock.mockReset();
  launchMock.mockReset();
  queryRawMock.mockReset();
  truncateMock.mockReset();
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
    expect(truncateMock).toHaveBeenCalledOnce();
    expect(launchMock).not.toHaveBeenCalled();
  });
});
