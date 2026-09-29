import { describe, expect, it } from "vitest";

import type { PrismaClient } from "../../../packages/db/generated/prisma/client";
import {
  assertMigrationTriggers,
  migrationTriggerNames,
} from "../../../packages/db/prisma/seeds/migration-triggers";

function prismaWithTriggers(names: Iterable<string>): PrismaClient {
  const rows = [...names].map((tgname) => ({ tgname }));
  return { $queryRaw: () => Promise.resolve(rows) } as unknown as PrismaClient;
}

describe("seed migration-trigger preflight", () => {
  it("tracks the triggers the migrations leave in place", () => {
    expect(migrationTriggerNames()).toContain("contest_lifecycle_schedule_identity");
    expect(migrationTriggerNames()).toContain("user_security_generation_state_change");
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
