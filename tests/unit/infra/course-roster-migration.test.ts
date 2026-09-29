import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findBlockingIndexRelations } from "../../../scripts/migration-index-safety.mjs";
import { splitStatements } from "../../setup/sql-statements";

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
});
