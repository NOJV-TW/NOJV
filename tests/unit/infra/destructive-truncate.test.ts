import { afterEach, describe, expect, it, vi } from "vitest";

const { calls, statements, transactionMock } = vi.hoisted(() => {
  const calls: string[] = [];
  const statements: string[] = [];
  const transactionMock = vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
    callback({
      $executeRawUnsafe: vi.fn(async (statement: string) => {
        calls.push("truncate");
        statements.push(statement);
      }),
      $queryRawUnsafe: vi.fn(async () => {
        calls.push("proof");
        return [
          {
            currentDatabase: "nojv_test",
            marker: "NOJV_TEST_DATABASE:nojv_test",
            serverAddress: "192.168.107.5/32",
            serverPort: 5432,
          },
        ];
      }),
    }),
  );
  return { calls, statements, transactionMock };
});

vi.mock("../../fixtures/factories", () => ({
  testPrisma: {
    $disconnect: vi.fn(),
    $transaction: transactionMock,
  },
}));

import { truncateAllTables, truncateTestTables } from "../../fixtures/seed-test-db";

const originalEnv = { ...process.env };

afterEach(() => {
  calls.length = 0;
  statements.length = 0;
  transactionMock.mockClear();
  process.env = { ...originalEnv };
});

describe("test table truncation", () => {
  it("revalidates the durable live proof in the same transaction before TRUNCATE", async () => {
    process.env.TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/nojv_test";
    process.env.NOJV_DESTRUCTIVE_TEST_DATABASE = "nojv_test";

    await truncateAllTables();

    expect(transactionMock).toHaveBeenCalledOnce();
    expect(calls).toEqual(["proof", "truncate"]);
  });

  it("applies the same in-transaction proof to focused table truncation", async () => {
    process.env.TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/nojv_test";
    process.env.NOJV_DESTRUCTIVE_TEST_DATABASE = "nojv_test";

    await truncateTestTables(["Notification"]);

    expect(calls).toEqual(["proof", "truncate"]);
    expect(statements).toEqual(['TRUNCATE TABLE "Notification" CASCADE']);
  });
});
