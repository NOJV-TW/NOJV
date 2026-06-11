import {
  backfillParticipation,
  contestParticipationRepo,
  runTransaction,
  virtualContestRepo,
} from "@nojv/db";
import { describe, expect, it } from "vitest";

import { createTestContest, createTestUser, testPrisma } from "../../fixtures/factories";

describe("Participation Stage 2 — create dual-write + backfill", () => {
  it("contestParticipationRepo upsert mirrors a contest Participation row", async () => {
    const user = await createTestUser();
    const contest = await createTestContest();

    await runTransaction((tx) =>
      contestParticipationRepo
        .withTx(tx)
        .upsert(contest.id, user.id, { contestId: contest.id, userId: user.id }, {}),
    );

    const mirror = await testPrisma.participation.findFirst({
      where: { type: "contest", userId: user.id, contestId: contest.id },
    });
    expect(mirror?.type).toBe("contest");
    expect(mirror?.examId).toBeNull();
  });

  it("virtualContestRepo.create mirrors a virtual Participation row", async () => {
    const user = await createTestUser();
    const contest = await createTestContest();

    await virtualContestRepo.create({
      contestId: contest.id,
      userId: user.id,
      endsAt: new Date(Date.now() + 3_600_000),
    });

    const mirror = await testPrisma.participation.findFirst({
      where: { type: "virtual", userId: user.id, contestId: contest.id },
    });
    expect(mirror?.type).toBe("virtual");
  });

  it("backfillParticipation mirrors pre-existing legacy rows (created bypassing the repo)", async () => {
    const user = await createTestUser();
    const contest = await createTestContest();
    await testPrisma.contestParticipation.create({
      data: { contestId: contest.id, userId: user.id, status: "registered", score: 5 },
    });

    const result = await backfillParticipation();
    expect(result.contest).toBeGreaterThanOrEqual(1);

    const mirror = await testPrisma.participation.findFirst({
      where: { type: "contest", userId: user.id, contestId: contest.id },
    });
    expect(mirror?.score).toBe(5);
  });
});
