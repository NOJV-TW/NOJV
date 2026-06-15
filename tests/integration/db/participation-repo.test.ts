import { participationRepo, UnifiedParticipationVersionConflict } from "@nojv/db";
import { describe, expect, it } from "vitest";

import { createTestContest, createTestUser } from "../../fixtures/factories";

describe("participationRepo — unified participation optimistic lock", () => {
  it("bumps version on update and rejects a stale expected version", async () => {
    const user = await createTestUser();
    const contest = await createTestContest();

    const created = await participationRepo.createVirtual({
      contestId: contest.id,
      userId: user.id,
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 3_600_000),
    });
    expect(created.version).toBe(0);

    const updated = await participationRepo.updateWithVersion(created.id, 0, { score: 10 });
    expect(updated.version).toBe(1);
    expect(updated.score).toBe(10);

    await expect(
      participationRepo.updateWithVersion(created.id, 0, { score: 20 }),
    ).rejects.toBeInstanceOf(UnifiedParticipationVersionConflict);
  });
});
