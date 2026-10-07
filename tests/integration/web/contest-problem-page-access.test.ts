import { describe, expect, it } from "vitest";

import { load } from "../../../apps/web/src/routes/(app)/contests/[contestId]/problems/[problemId]/+page.server";
import {
  createTestContest,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const DAY_MS = 24 * 60 * 60 * 1000;

function loadFor(user: TestUser, contestId: string, problemId: string) {
  return load({
    params: { contestId, problemId },
    locals: {
      sessionUser: user,
      adminAccessActive: false,
      apiTokenActor: null,
      examGate: null,
    },
    depends: () => undefined,
  } as unknown as Parameters<typeof load>[0]);
}

async function fixture(startsAt: Date) {
  const owner = await createTestUser({ platformRole: "teacher" });
  const student = await createTestUser();
  const contest = await createTestContest({
    createdByUserId: owner.id,
    startsAt,
    endsAt: new Date(startsAt.getTime() + DAY_MS),
  });
  const inContest = await createTestProblem({ authorId: owner.id });
  const outside = await createTestProblem({
    authorId: (await createTestUser({ platformRole: "teacher" })).id,
  });
  await testPrisma.contestProblem.create({
    data: { contestId: contest.id, problemId: inContest.id, ordinal: 1, points: 100 },
  });
  await testPrisma.participation.create({
    data: { type: "contest", contestId: contest.id, userId: student.id, status: "registered" },
  });
  return { contest, inContest, outside, owner, student };
}

describe("contest problem page access (real DB)", () => {
  it("redirects a non-manager to the contest for every problem id before start", async () => {
    const { contest, inContest, outside, student } = await fixture(
      new Date(Date.now() + DAY_MS),
    );

    for (const problemId of [inContest.id, outside.id, "missing-problem"]) {
      await expect(loadFor(student, contest.id, problemId)).rejects.toMatchObject({
        status: 303,
        location: `/contests/${contest.id}`,
      });
    }
  });

  it("404s a problem outside the contest for managers and participants", async () => {
    const { contest, inContest, outside, owner, student } = await fixture(
      new Date(Date.now() - DAY_MS / 2),
    );

    await expect(loadFor(owner, contest.id, inContest.id)).resolves.toMatchObject({
      problem: { id: inContest.id },
    });
    for (const user of [owner, student]) {
      await expect(loadFor(user, contest.id, outside.id)).rejects.toMatchObject({
        status: 404,
      });
    }
  });

  it("404s a problem outside the contest for a manager before start", async () => {
    const { contest, outside, owner } = await fixture(new Date(Date.now() + DAY_MS));

    await expect(loadFor(owner, contest.id, outside.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});
