import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findBlockingIndexRelations } from "../../../scripts/migration-index-safety.mjs";
import { collectReplayStatements, splitStatements } from "../../setup/replay-constraints";

const migrations = join(process.cwd(), "packages/db/prisma/migrations");
const contract = readFileSync(
  join(migrations, "20260907000000_course_roster_contract/migration.sql"),
  "utf8",
);

describe("course roster migration safety", () => {
  it("keeps the data contract atomic and defers only concurrent audit lookup indexes", () => {
    const statements = splitStatements(contract);
    expect(statements[0]).toBe("BEGIN");
    expect(statements.at(-1)).toBe("COMMIT");
    expect(statements.filter((statement) => /^(BEGIN|COMMIT)$/.test(statement))).toHaveLength(
      2,
    );
    expect(findBlockingIndexRelations(contract)).toEqual([]);
    const indexes = readFileSync(
      join(migrations, "20260907000001_course_roster_audit_indexes/migration.sql"),
      "utf8",
    );
    expect(splitStatements(indexes)).toHaveLength(2);
    expect(findBlockingIndexRelations(indexes)).toEqual([]);
  });

  it("replays the new checks and security trigger against a schema with no User.status", () => {
    const replay = collectReplayStatements();
    for (const constraint of [
      "CourseMembership_identity_chk",
      "CourseMembership_pending_username_chk",
      "ScoreOverride_subject_chk",
    ]) {
      expect(replay).toContainEqual(expect.stringContaining(`ADD CONSTRAINT "${constraint}"`));
    }
    const trigger = replay.find((statement) =>
      statement.startsWith("CREATE TRIGGER user_security_generation_state_change"),
    );
    expect(trigger).toBeDefined();
    expect(trigger).not.toContain('"status"');
    for (const field of [
      "email",
      "emailVerified",
      "platformRole",
      "isSuperAdmin",
      "disabled",
      "mustChangePassword",
      "twoFactorEnabled",
    ]) {
      expect(trigger).toContain(`OLD."${field}" IS DISTINCT FROM NEW."${field}"`);
    }
  });
});
