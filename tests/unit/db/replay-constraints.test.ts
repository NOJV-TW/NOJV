import { describe, expect, it } from "vitest";

import { collectReplayStatements } from "../../setup/replay-constraints";

describe("collectReplayStatements", () => {
  const stmts = collectReplayStatements();
  const creates = stmts.filter((s) => /ADD CONSTRAINT|CREATE INDEX/i.test(s));
  const drops = stmts.filter((s) => /DROP CONSTRAINT|DROP INDEX/i.test(s));

  it("replays every CHECK constraint defined across the migrations", () => {
    const names = creates.map((s) => /ADD CONSTRAINT\s+"(\w+)"/i.exec(s)?.[1]).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "Submission_single_context_chk",
        "SubmissionFeedback_single_context_chk",
        "SubmissionFeedbackAuditLog_single_context_chk",
        "Participation_single_context_chk",
        "Participation_virtual_window_chk",
        "Participation_ip_exam_only_chk",
        "User_security_generation_nonnegative_chk",
        "Exam_effective_time_window_chk",
        "Contest_effective_time_window_chk",
        "Assessment_effective_time_window_chk",
      ]),
    );
  });

  it("replays validation after adding NOT VALID effective-window constraints", () => {
    const names = [
      "Exam_effective_time_window_chk",
      "Contest_effective_time_window_chk",
      "Assessment_effective_time_window_chk",
    ];

    for (const name of names) {
      const createIndex = stmts.findIndex((statement) =>
        new RegExp(`ADD CONSTRAINT "${name}"`, "i").test(statement),
      );
      const validateIndex = stmts.findIndex((statement) =>
        new RegExp(`VALIDATE CONSTRAINT "${name}"`, "i").test(statement),
      );
      expect(createIndex).toBeGreaterThanOrEqual(0);
      expect(validateIndex).toBeGreaterThan(createIndex);
    }
  });

  it("replays the FTS expression GIN but skips the schema-expressible array GIN", () => {
    const joined = creates.join("\n");
    expect(joined).toContain("ProblemStatement_fts_idx");
    expect(joined).not.toContain("Problem_tags_idx");
  });

  it("emits an idempotent DROP IF EXISTS before each CREATE", () => {
    expect(drops.length).toBe(creates.length);
    expect(drops.every((s) => /IF EXISTS/i.test(s))).toBe(true);
    const constraintAndIndexStatements = stmts.filter((statement) =>
      /(?:DROP CONSTRAINT|DROP INDEX|ADD CONSTRAINT|CREATE INDEX)/i.test(statement),
    );
    for (let i = 0; i < constraintAndIndexStatements.length; i += 2) {
      expect(constraintAndIndexStatements[i]).toMatch(/DROP (CONSTRAINT|INDEX) IF EXISTS/i);
      expect(constraintAndIndexStatements[i + 1]).toMatch(/ADD CONSTRAINT|CREATE INDEX/i);
    }
  });

  it("replays security-generation functions and idempotent triggers", () => {
    const joined = stmts.join("\n");
    expect(joined).toContain("CREATE OR REPLACE FUNCTION bump_user_security_generation");
    expect(joined).toContain("CREATE OR REPLACE FUNCTION bump_security_generation");
    expect(joined).toContain(
      "CREATE OR REPLACE FUNCTION enforce_user_security_generation_monotonic",
    );
    expect(joined).toContain("CREATE TRIGGER user_security_generation_monotonic");
    expect(joined).toContain("CREATE TRIGGER user_security_generation_state_change");
    expect(joined).toContain("CREATE TRIGGER passkey_security_generation_credential_change");
    expect(joined).toContain(
      "CREATE TRIGGER registry_credential_security_generation_credential_change",
    );
    expect(joined).toContain(
      'DROP TRIGGER IF EXISTS passkey_security_generation_credential_change ON "Passkey"',
    );
  });
});
