import { describe, expect, it, vi } from "vitest";

import {
  assertLiveTestDatabase,
  resolveDestructiveTestDatabase,
} from "../../setup/destructive-test-database";

const integrationUrl = "postgresql://postgres:postgres@127.0.0.1:5432/nojv_test";

function safeEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NOJV_DESTRUCTIVE_TEST_DATABASE: "nojv_test",
    TEST_DATABASE_URL: integrationUrl,
    ...overrides,
  };
}

describe("destructive test database static preflight", () => {
  it("accepts only the explicit marker and TEST_DATABASE_URL", () => {
    expect(resolveDestructiveTestDatabase("nojv_test", safeEnv())).toBe(integrationUrl);
    expect(
      resolveDestructiveTestDatabase(
        "nojv_e2e_test",
        safeEnv({
          NOJV_DESTRUCTIVE_TEST_DATABASE: "nojv_e2e_test",
          TEST_DATABASE_URL: "postgresql://postgres:postgres@[::1]:5432/nojv_e2e_test",
        }),
      ),
    ).toBe("postgresql://postgres:postgres@[::1]:5432/nojv_e2e_test");
  });

  it.each([
    ["missing TEST_DATABASE_URL", safeEnv({ TEST_DATABASE_URL: undefined })],
    [
      "DATABASE_URL fallback",
      safeEnv({ TEST_DATABASE_URL: undefined, DATABASE_URL: integrationUrl }),
    ],
    ["missing marker", safeEnv({ NOJV_DESTRUCTIVE_TEST_DATABASE: undefined })],
    ["wrong marker", safeEnv({ NOJV_DESTRUCTIVE_TEST_DATABASE: "nojv_e2e_test" })],
    ["non-PostgreSQL", safeEnv({ TEST_DATABASE_URL: "mysql://root@127.0.0.1/nojv_test" })],
    [
      "localhost hostname",
      safeEnv({ TEST_DATABASE_URL: "postgresql://postgres@localhost:5432/nojv_test" }),
    ],
    [
      "remote hostname",
      safeEnv({ TEST_DATABASE_URL: "postgresql://postgres@db.example.com:5432/nojv_test" }),
    ],
    [
      "wrong database",
      safeEnv({ TEST_DATABASE_URL: "postgresql://postgres@127.0.0.1:5432/nojv" }),
    ],
    [
      "other test-looking database",
      safeEnv({ TEST_DATABASE_URL: "postgresql://postgres@127.0.0.1:5432/nojv_test_copy" }),
    ],
    ["query string", safeEnv({ TEST_DATABASE_URL: `${integrationUrl}?schema=public` })],
    ["fragment", safeEnv({ TEST_DATABASE_URL: `${integrationUrl}#unsafe` })],
  ])("rejects %s", (_case, env) => {
    expect(() => resolveDestructiveTestDatabase("nojv_test", env)).toThrow();
  });
});

describe("destructive test database live proof", () => {
  it("returns the database identity, NAT-capable server IP, port, and durable marker", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        currentDatabase: "nojv_test",
        marker: "NOJV_TEST_DATABASE:nojv_test",
        serverAddress: "192.168.107.5/32",
        serverPort: 5432,
      },
    ]);

    await expect(
      assertLiveTestDatabase({ $queryRawUnsafe: query }, "nojv_test"),
    ).resolves.toEqual({
      currentDatabase: "nojv_test",
      marker: "NOJV_TEST_DATABASE:nojv_test",
      serverAddress: "192.168.107.5/32",
      serverPort: 5432,
    });
    expect(query).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "wrong current database",
      {
        currentDatabase: "nojv",
        marker: "NOJV_TEST_DATABASE:nojv_test",
        serverAddress: "127.0.0.1",
        serverPort: 5432,
      },
    ],
    [
      "missing address",
      {
        currentDatabase: "nojv_test",
        marker: "NOJV_TEST_DATABASE:nojv_test",
        serverAddress: null,
        serverPort: 5432,
      },
    ],
    [
      "invalid address",
      {
        currentDatabase: "nojv_test",
        marker: "NOJV_TEST_DATABASE:nojv_test",
        serverAddress: "not-an-ip",
        serverPort: 5432,
      },
    ],
    [
      "missing port",
      {
        currentDatabase: "nojv_test",
        marker: "NOJV_TEST_DATABASE:nojv_test",
        serverAddress: "::1",
        serverPort: null,
      },
    ],
    [
      "wrong marker",
      {
        currentDatabase: "nojv_test",
        marker: "NOJV_TEST_DATABASE:other",
        serverAddress: "127.0.0.1",
        serverPort: 5432,
      },
    ],
    [
      "missing marker",
      {
        currentDatabase: "nojv_test",
        marker: null,
        serverAddress: "127.0.0.1",
        serverPort: 5432,
      },
    ],
  ])("rejects %s", async (_case, row) => {
    await expect(
      assertLiveTestDatabase(
        { $queryRawUnsafe: vi.fn().mockResolvedValue([row]) },
        "nojv_test",
      ),
    ).rejects.toThrow();
  });
});
