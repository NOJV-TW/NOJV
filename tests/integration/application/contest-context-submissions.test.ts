import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { submissionDomain, type ActorContext } from "@nojv/application";
import { durableWorkRepo } from "@nojv/db";

import {
  createTestContest,
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";

function actorOf(user: {
  id: string;
  email: string;
  username: string | null;
  name: string;
  platformRole: string;
}): ActorContext {
  if (!user.username) throw new Error("Test user must have a username");
  return {
    userId: user.id,
    email: user.email,
    username: user.username,
    displayName: user.name,
    platformRole: user.platformRole as ActorContext["platformRole"],
  };
}

async function createFixture() {
  const organizer = await createTestUser();
  const alice = await createTestUser();
  const bob = await createTestUser();
  const contest = await createTestContest({ createdByUserId: organizer.id });
  const otherContest = await createTestContest({ createdByUserId: organizer.id });
  const problem = await createTestProblem({ authorId: organizer.id });

  const older = await createTestSubmission({
    userId: alice.id,
    problemId: problem.id,
    contestId: contest.id,
    createdAt: new Date("2026-03-01T10:00:00Z"),
  });
  const newer = await createTestSubmission({
    userId: bob.id,
    problemId: problem.id,
    contestId: contest.id,
    createdAt: new Date("2026-03-01T11:00:00Z"),
  });
  await createTestSubmission({
    userId: alice.id,
    problemId: problem.id,
    contestId: otherContest.id,
  });
  await createTestSubmission({ userId: alice.id, problemId: problem.id });

  return { organizer, contest, older, newer };
}

describe("contest context submissions", () => {
  it("lists only the contest's submissions, newest first, for the live feed", async () => {
    const { organizer, contest, older, newer } = await createFixture();

    const rows = await submissionDomain.listRecentContextSubmissions({
      actor: actorOf(organizer),
      context: { type: "contest", id: contest.id },
    });

    expect(rows.map((row) => row.id)).toEqual([newer.id, older.id]);
  });

  it("scopes the paged history to the contest", async () => {
    const { organizer, contest, older, newer } = await createFixture();

    const page = await submissionDomain.listContextSubmissionsPaged({
      actor: actorOf(organizer),
      context: { type: "contest", id: contest.id },
      limit: 50,
      page: 1,
    });

    expect(page.items.map((item) => item.id)).toEqual([newer.id, older.id]);
  });

  it("matches queued rejudges to the contest's submissions only", async () => {
    const { contest, newer } = await createFixture();
    const elsewhere = await createTestSubmission();
    for (const submissionId of [newer.id, elsewhere.id]) {
      await durableWorkRepo.enqueue({
        kind: "submission.rejudge.dispatch",
        dedupeKey: `rejudge-${randomUUID()}`,
        payload: { input: { mode: "single", submissionId }, workflowId: submissionId },
      });
    }

    const queued = await durableWorkRepo.listQueuedRejudges({
      context: { type: "contest", id: contest.id },
    });

    expect(queued.map((row) => row.submissionId)).toEqual([newer.id]);
  });
});
