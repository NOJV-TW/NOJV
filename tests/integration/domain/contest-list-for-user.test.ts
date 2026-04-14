import { describe, expect, it } from "vitest";

import { createTestContest, createTestUser } from "../../fixtures/factories";

import { contestDomain } from "@nojv/domain";

const { listContestsForUser } = contestDomain;

// Standalone-contest listing only. Course-embedded exams moved to
// the Exam model in the 2026-04-14 split; see exam.test.ts for the
// equivalent listing tests.

describe("listContestsForUser", () => {
  it("puts user-created standalone contests into managed, not participable", async () => {
    const user = await createTestUser();
    const mine = await createTestContest({
      createdByUserId: user.id,
      visibility: "published",
      title: "Mine"
    });
    await createTestContest({
      visibility: "published",
      title: "Public"
    });

    const result = await listContestsForUser(user.id);

    const managedIds = result.managed.map((c) => c.id);
    const participableIds = result.participable.map((c) => c.id);
    expect(managedIds).toContain(mine.id);
    expect(participableIds).not.toContain(mine.id);
    expect(participableIds).toHaveLength(1);
  });

  it("includes draft contests in managed for the owner", async () => {
    const user = await createTestUser();
    const draft = await createTestContest({
      createdByUserId: user.id,
      visibility: "draft",
      title: "Draft"
    });

    const result = await listContestsForUser(user.id);
    expect(result.managed.map((c) => c.id)).toContain(draft.id);
  });

  it("returns only published contests for unauthenticated callers", async () => {
    const standalone = await createTestContest({ visibility: "published" });
    await createTestContest({ visibility: "draft" });

    const result = await listContestsForUser(null);
    expect(result.managed).toEqual([]);
    expect(result.participable.map((c) => c.id)).toContain(standalone.id);
  });
});
