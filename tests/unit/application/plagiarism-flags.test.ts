import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assessmentFindByIdWithCourseId,
  examFindById,
  contestFindById,
  courseMembershipFindByComposite,
  flagListByContext,
  flagFindById,
  flagUpsert,
  flagDeleteById,
  courseLock,
  courseFindById,
} = vi.hoisted(() => ({
  assessmentFindByIdWithCourseId: vi.fn(),
  examFindById: vi.fn(),
  contestFindById: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
  flagListByContext: vi.fn(),
  flagFindById: vi.fn(),
  flagUpsert: vi.fn(),
  flagDeleteById: vi.fn(),
  courseLock: vi.fn(),
  courseFindById: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(TX),
  courseRepo: { withTx: () => ({ lockForUpdate: courseLock, findById: courseFindById }) },
  assessmentRepo: {
    findByIdWithCourseId: assessmentFindByIdWithCourseId,
    withTx: () => ({ findById: assessmentFindByIdWithCourseId }),
  },
  examRepo: { findById: examFindById, withTx: () => ({ findById: examFindById }) },
  contestRepo: { findById: contestFindById },
  courseMembershipRepo: { findByComposite: courseMembershipFindByComposite },
  plagiarismPairFlagRepo: {
    listByContext: flagListByContext,
    findById: flagFindById,
    upsert: flagUpsert,
    deleteById: flagDeleteById,
  },
}));

import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  plagiarismDomain,
} from "@nojv/application";

const { buildPairKey, flagPair, unflagPair, listFlagsForContext } = plagiarismDomain;

const TX = { __tx: true };

function actor(
  overrides: Partial<{
    userId: string;
    platformRole: "admin" | "teacher" | "student";
  }> = {},
) {
  return {
    userId: overrides.userId ?? "usr_actor",
    username: "actor",
    platformRole: overrides.platformRole ?? ("teacher" as const),
    displayName: "Actor",
    email: "actor@example.com",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  courseFindById.mockResolvedValue({ id: "crs_1", archived: false });
});

describe("buildPairKey", () => {
  it("sorts user ids lexicographically before joining", () => {
    expect(buildPairKey("usr_b", "usr_a", "prob_1")).toBe("usr_a|usr_b|prob_1");
    expect(buildPairKey("usr_a", "usr_b", "prob_1")).toBe("usr_a|usr_b|prob_1");
  });

  it("rejects identical user ids", () => {
    expect(() => buildPairKey("u1", "u1", "prob_1")).toThrow(ValidationError);
  });

  it("rejects empty inputs", () => {
    expect(() => buildPairKey("", "u2", "prob_1")).toThrow(ValidationError);
    expect(() => buildPairKey("u1", "", "prob_1")).toThrow(ValidationError);
    expect(() => buildPairKey("u1", "u2", "")).toThrow(ValidationError);
  });
});

describe("flagPair permissions", () => {
  const pairKey = buildPairKey("u1", "u2", "prob_1");

  it("admin can flag any context", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_1", courseId: "crs_1" });
    flagUpsert.mockResolvedValue({ id: "flag_1" });
    await flagPair(actor({ platformRole: "admin" }), {
      contextType: "assessment",
      contextId: "ca_1",
      pairKey,
    });
    expect(flagUpsert).toHaveBeenCalledTimes(1);
  });

  it("course teacher can flag assessment for their course", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      role: "teacher",
      status: "active",
    });
    flagUpsert.mockResolvedValue({ id: "flag_1" });

    await flagPair(actor(), { contextType: "assessment", contextId: "ca_1", pairKey });

    expect(courseMembershipFindByComposite).toHaveBeenCalledWith("crs_1", "usr_actor");
    expect(flagUpsert).toHaveBeenCalledWith(TX, {
      contextType: "assessment",
      contextId: "ca_1",
      pairKey,
      flaggedBy: "usr_actor",
      note: null,
    });
  });

  it("course TA can flag exam for their course", async () => {
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      role: "ta",
      status: "active",
    });
    flagUpsert.mockResolvedValue({ id: "flag_1" });

    await flagPair(actor(), { contextType: "exam", contextId: "exm_1", pairKey });
    expect(flagUpsert).toHaveBeenCalledTimes(1);
  });

  it("non-staff student is rejected for assessment", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      role: "student",
      status: "active",
    });

    await expect(
      flagPair(actor({ platformRole: "student" }), {
        contextType: "assessment",
        contextId: "ca_1",
        pairKey,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(flagUpsert).not.toHaveBeenCalled();
  });

  it("inactive membership is rejected", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      role: "teacher",
      status: "removed",
    });

    await expect(
      flagPair(actor(), { contextType: "assessment", contextId: "ca_1", pairKey }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("contest organizer can flag contest pairs", async () => {
    contestFindById.mockResolvedValue({ id: "con_1", createdByUserId: "usr_actor" });
    flagUpsert.mockResolvedValue({ id: "flag_1" });

    await flagPair(actor(), { contextType: "contest", contextId: "con_1", pairKey });
    expect(flagUpsert).toHaveBeenCalledTimes(1);
  });

  it("non-organizer user is rejected for contest", async () => {
    contestFindById.mockResolvedValue({ id: "con_1", createdByUserId: "usr_other" });
    await expect(
      flagPair(actor(), { contextType: "contest", contextId: "con_1", pairKey }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("missing exam yields forbidden (not 404 — never reveal existence)", async () => {
    examFindById.mockResolvedValue(null);
    await expect(
      flagPair(actor(), { contextType: "exam", contextId: "missing", pairKey }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("upsert is keyed on (contextType, contextId, pairKey) so re-flagging dedupes", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      role: "teacher",
      status: "active",
    });
    flagUpsert.mockResolvedValue({ id: "flag_1" });

    await flagPair(actor(), { contextType: "assessment", contextId: "ca_1", pairKey });
    await flagPair(actor(), { contextType: "assessment", contextId: "ca_1", pairKey });

    expect(flagUpsert).toHaveBeenCalledTimes(2);
    for (const call of flagUpsert.mock.calls) {
      expect(call[1]).toMatchObject({
        contextType: "assessment",
        contextId: "ca_1",
        pairKey,
      });
    }
  });
});

describe("unflagPair", () => {
  it("requires the flag to exist", async () => {
    flagFindById.mockResolvedValue(null);
    await expect(
      unflagPair(actor({ platformRole: "admin" }), "flag_missing"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(flagDeleteById).not.toHaveBeenCalled();
  });

  it("admin can always unflag", async () => {
    flagFindById.mockResolvedValue({
      id: "flag_1",
      contextType: "assessment",
      contextId: "ca_1",
      pairKey: "u1|u2|p1",
    });
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_1", courseId: "crs_1" });
    await unflagPair(actor({ platformRole: "admin" }), "flag_1");
    expect(flagDeleteById).toHaveBeenCalledWith(TX, "flag_1");
  });

  it("rejects non-staff actor", async () => {
    flagFindById.mockResolvedValue({
      id: "flag_1",
      contextType: "assessment",
      contextId: "ca_1",
      pairKey: "u1|u2|p1",
    });
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      role: "student",
      status: "active",
    });
    await expect(
      unflagPair(actor({ platformRole: "student" }), "flag_1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(flagDeleteById).not.toHaveBeenCalled();
  });

  it("course teacher can unflag their assessment's flag", async () => {
    flagFindById.mockResolvedValue({
      id: "flag_1",
      contextType: "assessment",
      contextId: "ca_1",
      pairKey: "u1|u2|p1",
    });
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      role: "teacher",
      status: "active",
    });
    await unflagPair(actor(), "flag_1");
    expect(flagDeleteById).toHaveBeenCalledWith(TX, "flag_1");
  });
});

describe("archived course flags", () => {
  const readOnly = { name: "ValidationError", message: "Archived courses are read-only." };
  const pairKey = buildPairKey("u1", "u2", "prob_1");

  beforeEach(() => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_1", courseId: "crs_1" });
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });
    courseFindById.mockResolvedValue({ id: "crs_1", archived: true });
  });

  it.each(["assessment", "exam"] as const)(
    "rejects flagging a %s pair",
    async (contextType) => {
      await expect(
        flagPair(actor(), { contextType, contextId: "ca_1", pairKey }),
      ).rejects.toMatchObject(readOnly);
      expect(courseLock).toHaveBeenCalledWith("crs_1");
      expect(flagUpsert).not.toHaveBeenCalled();
    },
  );

  it("rejects unflagging, even for an admin", async () => {
    flagFindById.mockResolvedValue({
      id: "flag_1",
      contextType: "exam",
      contextId: "exm_1",
      pairKey,
    });
    await expect(unflagPair(actor({ platformRole: "admin" }), "flag_1")).rejects.toMatchObject(
      readOnly,
    );
    expect(flagDeleteById).not.toHaveBeenCalled();
  });
});

describe("listFlagsForContext", () => {
  it("delegates to repository with the same args", async () => {
    const rows = [
      {
        id: "flag_1",
        contextType: "assessment",
        contextId: "ca_1",
        pairKey: "u1|u2|p1",
        flaggedBy: "usr_actor",
        flaggedAt: new Date(),
        note: null,
      },
    ];
    flagListByContext.mockResolvedValue(rows);
    const out = await listFlagsForContext("assessment", "ca_1");
    expect(flagListByContext).toHaveBeenCalledWith("assessment", "ca_1");
    expect(out).toEqual(rows);
  });
});
