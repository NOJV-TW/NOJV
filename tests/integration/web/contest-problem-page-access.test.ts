import { describe, expect, it } from "vitest";

import { load } from "../../../apps/web/src/routes/(app)/contests/[contestId]/problems/[problemId]/+page.server";
import {
  createTestContest,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

function loadAs(user: TestUser, contestId: string, problemId: string) {
  const url = new URL(`/contests/${contestId}/problems/${problemId}`, "http://localhost");
  return load({
    url,
    request: new Request(url),
    params: { contestId, problemId },
    depends: () => {},
    getClientAddress: () => "127.0.0.1",
    locals: {
      sessionUser: user,
      adminAccessActive: false,
      apiTokenActor: null,
      examGate: null,
    },
  } as unknown as Parameters<typeof load>[0]);
}

async function organizerFixture() {
  const organizer = await createTestUser({ platformRole: "teacher" });
  const contest = await createTestContest({ createdByUserId: organizer.id });
  const contestProblem = await createTestProblem({ authorId: organizer.id });
  await testPrisma.contestProblem.create({
    data: { contestId: contest.id, problemId: contestProblem.id, ordinal: 1, points: 100 },
  });
  return { organizer, contest, contestProblem };
}

describe("contest problem page access (real DB)", () => {
  it("returns 404 to the organizer for another teacher's private problem outside the contest", async () => {
    const { organizer, contest } = await organizerFixture();
    const foreign = await createTestProblem({ visibility: "private" });

    await expect(loadAs(organizer, contest.id, foreign.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("still serves the organizer a problem that is in the contest", async () => {
    const { organizer, contest, contestProblem } = await organizerFixture();

    await expect(loadAs(organizer, contest.id, contestProblem.id)).resolves.toMatchObject({
      problem: { id: contestProblem.id },
    });
  });
});
