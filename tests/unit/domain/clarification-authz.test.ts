import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  contestFindById,
  examFindById,
  assessmentFindByIdWithCourseId,
  courseMembershipFindByComposite,
  contestListParticipantUserIds,
  examListParticipantUserIds,
} = vi.hoisted(() => ({
  contestFindById: vi.fn(),
  examFindById: vi.fn(),
  assessmentFindByIdWithCourseId: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
  contestListParticipantUserIds: vi.fn(),
  examListParticipantUserIds: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  contestRepo: { findById: contestFindById },
  examRepo: { findById: examFindById },
  assessmentRepo: { findByIdWithCourseId: assessmentFindByIdWithCourseId },
  courseMembershipRepo: { findByComposite: courseMembershipFindByComposite },
  participationRepo: {
    listContestParticipantUserIds: contestListParticipantUserIds,
    listExamParticipantUserIds: examListParticipantUserIds,
  },
}));

import {
  canAskClarification,
  canAnswerInContext,
  canSeeAuthor,
} from "../../../packages/application/src/clarification/permissions";

function actor(
  overrides: Partial<{
    userId: string;
    platformRole: "admin" | "teacher" | "student";
  }> = {},
) {
  return {
    userId: overrides.userId ?? "usr_actor",
    username: "actor",
    platformRole: overrides.platformRole ?? ("student" as const),
    displayName: "Actor",
    email: "actor@example.com",
  };
}

const contestCtx = (id = "ctst_1") => ({ type: "contest" as const, contestId: id });
const examCtx = (id = "exm_1") => ({ type: "exam" as const, examId: id });
const assignmentCtx = (id = "ca_1") => ({ type: "assignment" as const, assignmentId: id });

const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  contestFindById.mockResolvedValue({
    id: "ctst_1",
    createdByUserId: "usr_organizer",
    startsAt: past,
    endsAt: future,
  });
  examFindById.mockResolvedValue({
    id: "exm_1",
    courseId: "crs_1",
    startsAt: past,
    endsAt: future,
  });
  assessmentFindByIdWithCourseId.mockResolvedValue({
    id: "ca_1",
    courseId: "crs_1",
    opensAt: past,
    closesAt: future,
  });
});

describe("canAskClarification — admin", () => {
  it("denies admins on every context (staff cannot drop hints via questions)", async () => {
    const admin = actor({ platformRole: "admin" });
    expect(await canAskClarification(admin, contestCtx())).toBe(false);
    expect(await canAskClarification(admin, examCtx())).toBe(false);
    expect(await canAskClarification(admin, assignmentCtx())).toBe(false);
  });
});

describe("canAskClarification — contest", () => {
  it("allows a participant", async () => {
    contestListParticipantUserIds.mockResolvedValue(["usr_student", "usr_other"]);
    expect(await canAskClarification(actor({ userId: "usr_student" }), contestCtx())).toBe(
      true,
    );
  });

  it("denies a non-participant", async () => {
    contestListParticipantUserIds.mockResolvedValue(["usr_other"]);
    expect(await canAskClarification(actor({ userId: "usr_student" }), contestCtx())).toBe(
      false,
    );
  });
});

describe("canAskClarification — exam", () => {
  it("allows a participant", async () => {
    examListParticipantUserIds.mockResolvedValue(["usr_student"]);
    expect(await canAskClarification(actor({ userId: "usr_student" }), examCtx())).toBe(true);
  });

  it("denies a non-participant", async () => {
    examListParticipantUserIds.mockResolvedValue(["usr_other"]);
    expect(await canAskClarification(actor({ userId: "usr_student" }), examCtx())).toBe(false);
  });
});

describe("canAskClarification — assignment", () => {
  it("allows an active student in the course", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_1",
      courseId: "crs_1",
      opensAt: past,
      closesAt: future,
    });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_student",
      role: "student",
      status: "active",
    });
    expect(await canAskClarification(actor({ userId: "usr_student" }), assignmentCtx())).toBe(
      true,
    );
  });

  it("denies a teacher (not a student)", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_1",
      courseId: "crs_1",
      opensAt: past,
      closesAt: future,
    });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_teacher",
      role: "teacher",
      status: "active",
    });
    expect(
      await canAskClarification(
        actor({ userId: "usr_teacher", platformRole: "teacher" }),
        assignmentCtx(),
      ),
    ).toBe(false);
  });

  it("denies a removed student", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_1",
      courseId: "crs_1",
      opensAt: past,
      closesAt: future,
    });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_student",
      role: "student",
      status: "removed",
    });
    expect(await canAskClarification(actor({ userId: "usr_student" }), assignmentCtx())).toBe(
      false,
    );
  });

  it("denies a user with no membership", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_1",
      courseId: "crs_1",
      opensAt: past,
      closesAt: future,
    });
    courseMembershipFindByComposite.mockResolvedValue(null);
    expect(await canAskClarification(actor({ userId: "usr_stranger" }), assignmentCtx())).toBe(
      false,
    );
  });

  it("denies when the assessment is missing", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue(null);
    expect(
      await canAskClarification(actor({ userId: "usr_student" }), assignmentCtx("ca_missing")),
    ).toBe(false);
  });

  it("denies after the assignment closes", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_1",
      courseId: "crs_1",
      opensAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      closesAt: new Date(Date.now() - 60_000),
    });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_student",
      role: "student",
      status: "active",
    });
    expect(await canAskClarification(actor({ userId: "usr_student" }), assignmentCtx())).toBe(
      false,
    );
  });
});

describe("canAnswerInContext — admin", () => {
  it("always permits admins", async () => {
    const admin = actor({ platformRole: "admin" });
    expect(await canAnswerInContext(admin, contestCtx())).toBe(true);
    expect(await canAnswerInContext(admin, examCtx())).toBe(true);
    expect(await canAnswerInContext(admin, assignmentCtx())).toBe(true);
  });
});

describe("canAnswerInContext — contest", () => {
  it("allows the organizer", async () => {
    contestFindById.mockResolvedValue({
      id: "ctst_1",
      createdByUserId: "usr_organizer",
      startsAt: past,
      endsAt: future,
    });
    expect(await canAnswerInContext(actor({ userId: "usr_organizer" }), contestCtx())).toBe(
      true,
    );
  });

  it("denies a non-organizer", async () => {
    contestFindById.mockResolvedValue({
      id: "ctst_1",
      createdByUserId: "usr_organizer",
      startsAt: past,
      endsAt: future,
    });
    expect(await canAnswerInContext(actor({ userId: "usr_stranger" }), contestCtx())).toBe(
      false,
    );
  });

  it("denies when contest is missing", async () => {
    contestFindById.mockResolvedValue(null);
    expect(await canAnswerInContext(actor({ userId: "usr_x" }), contestCtx("ctst_gone"))).toBe(
      false,
    );
  });
});

describe("canAnswerInContext — exam", () => {
  it("allows a teacher of the exam's course", async () => {
    examFindById.mockResolvedValue({
      id: "exm_1",
      courseId: "crs_1",
      startsAt: past,
      endsAt: future,
    });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_teacher",
      role: "teacher",
      status: "active",
    });
    expect(
      await canAnswerInContext(
        actor({ userId: "usr_teacher", platformRole: "teacher" }),
        examCtx(),
      ),
    ).toBe(true);
  });

  it("allows a TA", async () => {
    examFindById.mockResolvedValue({
      id: "exm_1",
      courseId: "crs_1",
      startsAt: past,
      endsAt: future,
    });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_ta",
      role: "ta",
      status: "active",
    });
    expect(await canAnswerInContext(actor({ userId: "usr_ta" }), examCtx())).toBe(true);
  });

  it("denies a student", async () => {
    examFindById.mockResolvedValue({
      id: "exm_1",
      courseId: "crs_1",
      startsAt: past,
      endsAt: future,
    });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_student",
      role: "student",
      status: "active",
    });
    expect(await canAnswerInContext(actor({ userId: "usr_student" }), examCtx())).toBe(false);
  });
});

describe("canAnswerInContext — assignment", () => {
  it("allows a teacher of the assessment's course", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_1",
      courseId: "crs_1",
      opensAt: past,
      closesAt: future,
    });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_teacher",
      role: "teacher",
      status: "active",
    });
    expect(
      await canAnswerInContext(
        actor({ userId: "usr_teacher", platformRole: "teacher" }),
        assignmentCtx(),
      ),
    ).toBe(true);
  });

  it("denies a student", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_1",
      courseId: "crs_1",
      opensAt: past,
      closesAt: future,
    });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_student",
      role: "student",
      status: "active",
    });
    expect(await canAnswerInContext(actor({ userId: "usr_student" }), assignmentCtx())).toBe(
      false,
    );
  });
});

describe("canSeeAuthor", () => {
  it("returns true for staff regardless of context window", async () => {
    contestFindById.mockResolvedValue({
      id: "ctst_1",
      createdByUserId: "usr_organizer",
      startsAt: past,
      endsAt: new Date(Date.now() - 60_000),
    });
    expect(await canSeeAuthor(actor({ userId: "usr_organizer" }), contestCtx())).toBe(true);
  });

  it("returns false for non-staff", async () => {
    contestFindById.mockResolvedValue({ id: "ctst_1", createdByUserId: "usr_organizer" });
    expect(await canSeeAuthor(actor({ userId: "usr_student" }), contestCtx())).toBe(false);
  });
});
