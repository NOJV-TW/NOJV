import { beforeEach, describe, expect, it, vi } from "vitest";

const { hasEndedAssessmentForUser, hasEndedContestForUser, hasEndedExamForUser } = vi.hoisted(
  () => ({
    hasEndedAssessmentForUser: vi.fn(),
    hasEndedContestForUser: vi.fn(),
    hasEndedExamForUser: vi.fn(),
  }),
);

vi.mock("@nojv/db", () => ({
  assessmentProblemRepo: { hasEndedAssessmentForUser },
  contestProblemRepo: { hasEndedContestForUser },
  examProblemRepo: { hasEndedExamForUser },
  problemRepo: {},
  problemWorkspaceFileRepo: {},
}));

import { NotFoundError, problemDomain } from "@nojv/application";

const { assertProblemViewAccess } = problemDomain;

const publicProblem = { id: "prob_pub", authorId: "usr_author", visibility: "public" };
const privateProblem = { id: "prob_priv", authorId: "usr_author", visibility: "private" };

const studentActor = {
  userId: "usr_student",
  username: "student",
  platformRole: "user" as const,
};
const authorActor = {
  userId: "usr_author",
  username: "author",
  platformRole: "user" as const,
};
const adminActor = { userId: "usr_admin", username: "admin", platformRole: "admin" as const };

beforeEach(() => {
  hasEndedAssessmentForUser.mockReset();
  hasEndedContestForUser.mockReset();
  hasEndedExamForUser.mockReset();
  hasEndedAssessmentForUser.mockResolvedValue(false);
  hasEndedContestForUser.mockResolvedValue(false);
  hasEndedExamForUser.mockResolvedValue(false);
});

describe("assertProblemViewAccess — synchronous gates", () => {
  it("allows any logged-in viewer on a public problem without hitting the DB", async () => {
    await expect(assertProblemViewAccess(publicProblem, studentActor)).resolves.toBeUndefined();
    expect(hasEndedAssessmentForUser).not.toHaveBeenCalled();
    expect(hasEndedContestForUser).not.toHaveBeenCalled();
    expect(hasEndedExamForUser).not.toHaveBeenCalled();
  });

  it("allows the problem author on a private problem", async () => {
    await expect(assertProblemViewAccess(privateProblem, authorActor)).resolves.toBeUndefined();
    expect(hasEndedAssessmentForUser).not.toHaveBeenCalled();
  });

  it("allows platform admins on a private problem", async () => {
    await expect(assertProblemViewAccess(privateProblem, adminActor)).resolves.toBeUndefined();
    expect(hasEndedAssessmentForUser).not.toHaveBeenCalled();
  });

  it("allows callers who vouched for the active context", async () => {
    await expect(
      assertProblemViewAccess(privateProblem, studentActor, { contextIncludesProblem: true }),
    ).resolves.toBeUndefined();
    expect(hasEndedAssessmentForUser).not.toHaveBeenCalled();
  });
});

describe("assertProblemViewAccess — historical participant (practice-after-close)", () => {
  const now = new Date("2026-04-16T12:00:00Z");

  it("allows a participant of an ended assessment that contained the problem", async () => {
    hasEndedAssessmentForUser.mockResolvedValue(true);
    await expect(
      assertProblemViewAccess(privateProblem, studentActor, { now }),
    ).resolves.toBeUndefined();
    expect(hasEndedAssessmentForUser).toHaveBeenCalledWith(
      privateProblem.id,
      studentActor.userId,
      now,
    );
  });

  it("allows a participant of an ended contest that contained the problem", async () => {
    hasEndedContestForUser.mockResolvedValue(true);
    await expect(
      assertProblemViewAccess(privateProblem, studentActor, { now }),
    ).resolves.toBeUndefined();
    expect(hasEndedContestForUser).toHaveBeenCalledWith(
      privateProblem.id,
      studentActor.userId,
      now,
    );
  });

  it("allows a participant of an ended exam that contained the problem", async () => {
    hasEndedExamForUser.mockResolvedValue(true);
    await expect(
      assertProblemViewAccess(privateProblem, studentActor, { now }),
    ).resolves.toBeUndefined();
    expect(hasEndedExamForUser).toHaveBeenCalledWith(
      privateProblem.id,
      studentActor.userId,
      now,
    );
  });

  it("blocks a non-participant on a private problem (all three repos return false)", async () => {
    await expect(
      assertProblemViewAccess(privateProblem, studentActor, { now }),
    ).rejects.toThrow(NotFoundError);
  });

  it("blocks BEFORE endsAt/closesAt: the repos drive time semantics, so when none return true the viewer is denied", async () => {
    hasEndedAssessmentForUser.mockResolvedValue(false);
    hasEndedContestForUser.mockResolvedValue(false);
    hasEndedExamForUser.mockResolvedValue(false);
    await expect(
      assertProblemViewAccess(privateProblem, studentActor, { now }),
    ).rejects.toThrow(NotFoundError);
  });

  it("blocks when the context is unpublished/draft (repos filter on published status and will return false)", async () => {
    hasEndedAssessmentForUser.mockResolvedValue(false);
    hasEndedContestForUser.mockResolvedValue(false);
    hasEndedExamForUser.mockResolvedValue(false);
    await expect(
      assertProblemViewAccess(privateProblem, studentActor, { now }),
    ).rejects.toThrow(NotFoundError);
  });

  it("does not fire the historical-participant gate when the actor is null (logged-out / no user id)", async () => {
    await expect(assertProblemViewAccess(privateProblem, null)).rejects.toThrow(NotFoundError);
    expect(hasEndedAssessmentForUser).not.toHaveBeenCalled();
    expect(hasEndedContestForUser).not.toHaveBeenCalled();
    expect(hasEndedExamForUser).not.toHaveBeenCalled();
  });

  it("short-circuits on public problems even if a historical check would succeed", async () => {
    hasEndedAssessmentForUser.mockResolvedValue(true);
    await expect(assertProblemViewAccess(publicProblem, studentActor)).resolves.toBeUndefined();
    expect(hasEndedAssessmentForUser).not.toHaveBeenCalled();
  });
});
