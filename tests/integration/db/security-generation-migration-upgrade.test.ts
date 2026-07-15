import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { testPrisma } from "../../fixtures/factories";
import { splitStatements } from "../../setup/replay-constraints";

const MIGRATIONS_DIR = join(process.cwd(), "packages/db/prisma/migrations");
const CURRENT_MAIN_BASELINE = [
  "20260416120000_init",
  "20260702000000_contest_null_invite_codes",
  "20260702140000_clarification_visibility",
  "20260703000000_super_admin_flag",
  "20260705000000_problem_displayid_on_publish",
  "20260707000000_admin_audit_log",
  "20260708000000_drop_userstatus_disabled",
  "20260709000000_single_problem_statement",
  "20260710000000_notification_preference",
  "20260711000000_two_factor_master_switch",
  "20260712000000_user_profile_public",
  "20260713000000_problem_posts",
  "20260714000000_user_can_create_advanced_problems",
  "20260715000000_registry_credential",
  "20260716000000_registry_audit_actions",
] as const;
const SECURITY_GENERATION_UPGRADE = [
  "20260714235959_user_security_generation",
  "20260716000001_registry_security_generation_trigger",
] as const;

async function applyMigration(schema: string, migration: string): Promise<void> {
  const sql = readFileSync(join(MIGRATIONS_DIR, migration, "migration.sql"), "utf8").replaceAll(
    '"public".',
    `"${schema}".`,
  );
  await testPrisma.$transaction(
    async (transaction) => {
      await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
      for (const statement of splitStatements(sql)) {
        await transaction.$executeRawUnsafe(statement);
      }
    },
    { timeout: 30_000 },
  );
}

describe("security generation migration upgrade", () => {
  it("upgrades the current-main schema and activates registry credential invalidation", async () => {
    const schema = `security_upgrade_${randomUUID().replaceAll("-", "")}`;
    await testPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

    try {
      for (const migration of CURRENT_MAIN_BASELINE) {
        await applyMigration(schema, migration);
      }
      for (const migration of SECURITY_GENERATION_UPGRADE) {
        await applyMigration(schema, migration);
      }

      const user = await testPrisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
        await transaction.$executeRawUnsafe(`
            INSERT INTO "User" ("id", "email", "name", "updatedAt")
            VALUES ('upgrade-user', 'upgrade@test.local', 'Upgrade User', NOW())
          `);
        await transaction.$executeRawUnsafe(`
            INSERT INTO "RegistryCredential"
              ("id", "userId", "username", "passwordHash", "updatedAt")
            VALUES ('upgrade-registry', 'upgrade-user', 'upgrade-user', 'hash', NOW())
          `);
        const [row] = await transaction.$queryRawUnsafe<Array<{ securityGeneration: number }>>(`
            SELECT "securityGeneration" FROM "User" WHERE "id" = 'upgrade-user'
          `);
        return row;
      });

      expect(user?.securityGeneration).toBe(1);
    } finally {
      await testPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  }, 60_000);
});
