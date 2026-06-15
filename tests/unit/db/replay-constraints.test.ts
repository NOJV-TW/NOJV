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
      ]),
    );
  });

  it("replays the FTS expression GIN but skips the schema-expressible array GIN", () => {
    const joined = creates.join("\n");
    expect(joined).toContain("ProblemStatementI18n_fts_idx");
    expect(joined).not.toContain("Problem_tags_idx");
  });

  it("emits an idempotent DROP IF EXISTS before each CREATE", () => {
    expect(drops.length).toBe(creates.length);
    expect(drops.every((s) => /IF EXISTS/i.test(s))).toBe(true);
    for (let i = 0; i < stmts.length; i += 2) {
      expect(stmts[i]).toMatch(/DROP (CONSTRAINT|INDEX) IF EXISTS/i);
      expect(stmts[i + 1]).toMatch(/ADD CONSTRAINT|CREATE INDEX/i);
    }
  });
});
