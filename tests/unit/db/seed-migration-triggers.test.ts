import { describe, expect, it } from "vitest";

import type { PrismaClient } from "../../../packages/db/generated/prisma/client";
import {
  assertMigrationTriggers,
  migrationTriggerNames,
} from "../../../packages/db/prisma/seeds/migration-triggers";
import { collectReplayStatements } from "../../setup/replay-constraints";

function prismaWithTriggers(names: Iterable<string>): PrismaClient {
  const rows = [...names].map((tgname) => ({ tgname }));
  return { $queryRaw: () => Promise.resolve(rows) } as unknown as PrismaClient;
}

describe("seed migration-trigger preflight", () => {
  it("expects every trigger the test databases replay from migrations", () => {
    const replayed = collectReplayStatements()
      .map((statement) => /^CREATE\s+TRIGGER\s+"?(\w+)"?/i.exec(statement)?.[1])
      .filter((name): name is string => name !== undefined);

    expect([...migrationTriggerNames()].sort()).toEqual(replayed.sort());
    expect(migrationTriggerNames()).toContain("contest_lifecycle_schedule_identity");
  });

  it("rejects a db-push database that lacks the lifecycle triggers", async () => {
    const withoutLifecycle = [...migrationTriggerNames()].filter(
      (name) => !name.endsWith("_lifecycle_schedule_identity"),
    );

    await expect(assertMigrationTriggers(prismaWithTriggers(withoutLifecycle))).rejects.toThrow(
      /contest_lifecycle_schedule_identity[\s\S]*pnpm db:deploy/,
    );
  });

  it("accepts a database built from migrations", async () => {
    await expect(
      assertMigrationTriggers(prismaWithTriggers(migrationTriggerNames())),
    ).resolves.toBeUndefined();
  });
});
