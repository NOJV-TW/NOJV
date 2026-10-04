import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  courseLock: vi.fn(),
  courseFindById: vi.fn(),
  courseUpdate: vi.fn(),
  courseDelete: vi.fn(),
  membership: vi.fn(),
  announcementFindById: vi.fn(),
  announcementFindForUpdate: vi.fn(),
  announcementCreate: vi.fn(),
  announcementUpdate: vi.fn(),
  announcementDelete: vi.fn(),
  translationUpsert: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("../../../packages/application/src/shared/uploaded-image", () => ({
  ensurePublicProblemImageInventories: vi.fn(),
}));

vi.mock("../../../packages/application/src/notification", () => ({
  createNotificationBatchInTransaction: mocks.notify,
}));

vi.mock("@nojv/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@nojv/db")>()).Prisma,
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({}),
  prismaAdapterClient: {},
  courseRepo: {
    withTx: () => ({
      lockForUpdate: mocks.courseLock,
      findById: mocks.courseFindById,
      update: mocks.courseUpdate,
      delete: mocks.courseDelete,
    }),
  },
  courseMembershipRepo: {
    withTx: () => ({
      findByComposite: mocks.membership,
      listActiveMemberUserIds: vi.fn().mockResolvedValue([]),
    }),
  },
  userRepo: { withTx: () => ({ listActiveIds: vi.fn().mockResolvedValue([]) }) },
  announcementRepo: {
    withTx: () => ({
      findById: mocks.announcementFindById,
      findByIdForUpdate: mocks.announcementFindForUpdate,
      create: mocks.announcementCreate,
      update: mocks.announcementUpdate,
      delete: mocks.announcementDelete,
    }),
  },
  announcementTranslationRepo: { withTx: () => ({ upsert: mocks.translationUpsert }) },
  assessmentRepo: {},
  assessmentProblemRepo: {},
  examProblemRepo: {},
  examRepo: {},
}));

import {
  deleteCourse,
  setCourseArchived,
  updateCourse,
} from "../../../packages/application/src/course/mutations";
import {
  createAnnouncement,
  deleteAnnouncement,
  toggleAnnouncementPin,
  toggleAnnouncementPublish,
  updateAnnouncement,
} from "../../../packages/application/src/announcement/mutations";

const readOnly = { name: "ValidationError", message: "Archived courses are read-only." };
const teacher = {
  userId: "usr_teacher",
  username: "teacher",
  platformRole: "teacher" as const,
  displayName: "Teacher",
  email: "teacher@example.com",
};
const courseInfo = { title: "Algorithms", description: "", academicYear: 114, semester: 1 };
const announcementInput = { title: "Week 1", content: "Welcome", published: true };

function courseRow(archived: boolean) {
  return { id: "crs_1", title: "Algorithms", ownerId: "usr_owner", archived };
}

function announcementRow(courseId: string | null) {
  return {
    id: "ann_1",
    courseId,
    pinned: false,
    status: "draft",
    audience: "all",
    publishedAt: null,
    translations: [{ locale: "en", title: "Week 1", content: "Welcome" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.membership.mockResolvedValue({ role: "teacher", status: "active" });
  mocks.courseFindById.mockResolvedValue(courseRow(true));
  mocks.announcementFindById.mockResolvedValue(announcementRow("crs_1"));
  mocks.announcementFindForUpdate.mockResolvedValue(announcementRow("crs_1"));
  mocks.announcementCreate.mockResolvedValue(announcementRow("crs_1"));
  mocks.announcementUpdate.mockResolvedValue(announcementRow("crs_1"));
});

describe("course settings on an archived course", () => {
  it("rejects course info updates", async () => {
    await expect(updateCourse(teacher, "crs_1", courseInfo)).rejects.toMatchObject(readOnly);
    expect(mocks.courseLock).toHaveBeenCalledWith("crs_1");
    expect(mocks.courseUpdate).not.toHaveBeenCalled();
  });

  it("still updates course info on an active course", async () => {
    mocks.courseFindById.mockResolvedValue(courseRow(false));
    await updateCourse(teacher, "crs_1", courseInfo);
    expect(mocks.courseUpdate).toHaveBeenCalledOnce();
  });

  it("allows un-archiving and deleting", async () => {
    await setCourseArchived(teacher, "crs_1", false);
    expect(mocks.courseUpdate).toHaveBeenCalledWith("crs_1", { archived: false });
    await deleteCourse(teacher, "crs_1");
    expect(mocks.courseDelete).toHaveBeenCalledWith("crs_1");
  });
});

describe("course announcements on an archived course", () => {
  it("rejects creating a course announcement", async () => {
    await expect(
      createAnnouncement({ ...announcementInput, courseId: "crs_1" }),
    ).rejects.toMatchObject(readOnly);
    expect(mocks.courseLock).toHaveBeenCalledWith("crs_1");
    expect(mocks.announcementCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["update", () => updateAnnouncement("ann_1", announcementInput)],
    ["pin", () => toggleAnnouncementPin("ann_1")],
    ["publish", () => toggleAnnouncementPublish("ann_1")],
    ["delete", () => deleteAnnouncement("ann_1")],
  ])("rejects %s before locking the announcement", async (_label, mutate) => {
    await expect(mutate()).rejects.toMatchObject(readOnly);
    expect(mocks.courseLock).toHaveBeenCalledWith("crs_1");
    expect(mocks.announcementFindForUpdate).not.toHaveBeenCalled();
    expect(mocks.announcementUpdate).not.toHaveBeenCalled();
    expect(mocks.announcementDelete).not.toHaveBeenCalled();
  });

  it("leaves platform announcements unaffected", async () => {
    mocks.announcementFindById.mockResolvedValue(announcementRow(null));
    mocks.announcementFindForUpdate.mockResolvedValue(announcementRow(null));
    await createAnnouncement(announcementInput);
    await toggleAnnouncementPin("ann_1");
    await deleteAnnouncement("ann_1");
    expect(mocks.courseLock).not.toHaveBeenCalled();
    expect(mocks.announcementCreate).toHaveBeenCalledOnce();
    expect(mocks.announcementUpdate).toHaveBeenCalledOnce();
    expect(mocks.announcementDelete).toHaveBeenCalledWith("ann_1");
  });
});
