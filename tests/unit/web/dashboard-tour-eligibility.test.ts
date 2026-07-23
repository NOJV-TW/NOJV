import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDashboardView,
  getPlatformOverview,
  getSubmissionActivity,
  getUserById,
  requireAuth,
} = vi.hoisted(() => ({
  getDashboardView: vi.fn(),
  getPlatformOverview: vi.fn(),
  getSubmissionActivity: vi.fn(),
  getUserById: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("$lib/server/auth", () => ({ requireAuth }));
vi.mock("@nojv/application", () => ({
  platformDomain: { getPlatformOverview },
  userDomain: { getDashboardView, getSubmissionActivity, getUserById },
}));

const { load } = await import("$lib/../routes/(app)/dashboard/+page.server");

const actor = {
  displayName: "Student",
  platformRole: "student" as const,
  userId: "usr_student",
  username: "student",
};

function eventFor(role: "admin" | "student" | "teacher", search = "") {
  return {
    locals: { sessionUser: { platformRole: role } },
    url: new URL(`http://localhost/dashboard${search}`),
  } as Parameters<typeof load>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockReturnValue(actor);
  getDashboardView.mockResolvedValue({
    analytics: {},
    recentSubmissions: [],
    stats: { totalAc: 0, totalAttempts: 0 },
  });
  getPlatformOverview.mockResolvedValue({});
  getSubmissionActivity.mockResolvedValue([]);
  getUserById.mockResolvedValue({ studentTourSeenAt: null, teacherTourSeenAt: null });
});

describe("dashboard automatic tour eligibility", () => {
  it("offers the tour only to an unseen role on the personal dashboard", async () => {
    await expect(load(eventFor("student"))).resolves.toMatchObject({
      automaticTourRole: "student",
    });

    await expect(load(eventFor("teacher"))).resolves.toMatchObject({
      automaticTourRole: "teacher",
    });

    await expect(load(eventFor("admin"))).resolves.toMatchObject({ automaticTourRole: null });
    await expect(load(eventFor("student", "?view=server"))).resolves.toMatchObject({
      automaticTourRole: null,
    });
  });

  it("does not offer the student tour after a real submission", async () => {
    getDashboardView.mockResolvedValue({
      analytics: {},
      recentSubmissions: [],
      stats: { totalAc: 0, totalAttempts: 1 },
    });

    await expect(load(eventFor("student"))).resolves.toMatchObject({ automaticTourRole: null });
  });

  it("does not offer a role tour already seen on another device", async () => {
    getUserById.mockResolvedValue({
      studentTourSeenAt: new Date(),
      teacherTourSeenAt: new Date(),
    });

    await expect(load(eventFor("student"))).resolves.toMatchObject({ automaticTourRole: null });
    await expect(load(eventFor("teacher"))).resolves.toMatchObject({ automaticTourRole: null });
  });
});
