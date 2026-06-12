import { describe, expect, it } from "vitest";

import { createTestContest, createTestUser, testPrisma } from "../../fixtures/factories";

// Verifies the migration-only CHECK constraints are actually present and
// enforced in the db-push test DB (replayed by tests/setup/global-setup.ts).
// Without the replay these writes would silently succeed in tests and only
// fail in prod.
describe("replayed CHECK constraints are enforced in the test DB", () => {
  it("has the participation CHECK constraints (parity with migrations)", async () => {
    const rows = await testPrisma.$queryRawUnsafe<{ conname: string }[]>(
      `SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname LIKE 'Participation_%'`,
    );
    const names = rows.map((r) => r.conname);
    expect(names).toEqual(
      expect.arrayContaining([
        "Participation_single_context_chk",
        "Participation_virtual_window_chk",
        "Participation_ip_exam_only_chk",
      ]),
    );
  });

  it("rejects a virtual participation missing its start/end window", async () => {
    const user = await createTestUser();
    const contest = await createTestContest();

    await expect(
      testPrisma.participation.create({
        data: {
          type: "virtual",
          userId: user.id,
          contestId: contest.id,
          status: "active",
        },
      }),
    ).rejects.toThrow(/Participation_virtual_window_chk|check constraint/i);
  });

  it("rejects IP-proctoring columns on a non-exam participation", async () => {
    const user = await createTestUser();
    const contest = await createTestContest();

    await expect(
      testPrisma.participation.create({
        data: {
          type: "contest",
          userId: user.id,
          contestId: contest.id,
          status: "active",
          startedAt: new Date(),
          ipPin: "203.0.113.7",
        },
      }),
    ).rejects.toThrow(/Participation_ip_exam_only_chk|check constraint/i);
  });

  it("accepts a well-formed virtual participation", async () => {
    const user = await createTestUser();
    const contest = await createTestContest();

    const row = await testPrisma.participation.create({
      data: {
        type: "virtual",
        userId: user.id,
        contestId: contest.id,
        status: "active",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endsAt: new Date("2026-01-01T02:00:00Z"),
      },
    });
    expect(row.id).toBeTruthy();
  });
});
