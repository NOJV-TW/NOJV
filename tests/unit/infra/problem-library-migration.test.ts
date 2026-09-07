import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findBlockingIndexRelations } from "../../../scripts/migration-index-safety.mjs";
import { splitStatements } from "../../setup/replay-constraints";

describe("problem library release migration safeguards", () => {
  it.each([
    "20260908000000_exam_late_submission_policy",
    "20260908000002_course_problem_permissions",
  ])(
    "keeps %s atomic and checks legacy data before changing persisted schema or rows",
    (name) => {
      const sql = readFileSync(
        join(process.cwd(), "packages/db/prisma/migrations", name, "migration.sql"),
        "utf8",
      );
      const statements = splitStatements(sql);
      expect(statements[0]).toBe("BEGIN");
      expect(statements.at(-1)).toBe("COMMIT");
      expect(statements.filter((statement) => /^(BEGIN|COMMIT)$/.test(statement))).toHaveLength(
        2,
      );
      expect(statements[1]).toBe("SET LOCAL lock_timeout = '10s'");
      expect(statements[2]).toBe("SET LOCAL statement_timeout = '5min'");
      expect(statements[3]).toMatch(/^LOCK TABLE .* IN SHARE ROW EXCLUSIVE MODE$/);
      expect(statements[4]).toMatch(/^DO \$\$[\s\S]*RAISE EXCEPTION[\s\S]*HINT =/);
      expect(findBlockingIndexRelations(sql)).toEqual([]);
    },
  );
});
