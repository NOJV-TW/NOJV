import { describe, expect, it, vi } from "vitest";

vi.mock("@nojv/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nojv/application")>();
  return {
    ...actual,
    courseDomain: {
      ...actual.courseDomain,
      listForUserWithCards: vi.fn().mockResolvedValue({ enrolled: [], managing: [] }),
      listAssignmentsAcrossCoursesForUser: vi
        .fn()
        .mockResolvedValue({ rows: [], counts: {}, hasNoCourses: true }),
    },
    examDomain: {
      ...actual.examDomain,
      listExamsAcrossCoursesForUser: vi.fn().mockResolvedValue({ rows: [], counts: {} }),
    },
    contestDomain: {
      ...actual.contestDomain,
      listContestsForUser: vi.fn().mockResolvedValue({ managed: [], participable: [] }),
    },
  };
});

const routes = [
  ["courses", (await import("$lib/../routes/(app)/courses/+page.server")).load],
  ["assignments", (await import("$lib/../routes/(app)/assignments/+page.server")).load],
  ["exams", (await import("$lib/../routes/(app)/exams/+page.server")).load],
  ["contests", (await import("$lib/../routes/(app)/contests/+page.server")).load],
] as const;

function eventFor(path: string, active: boolean) {
  return {
    url: new URL(`http://localhost/${path}?tab=enrolled`),
    locals: {
      adminAccessActive: active,
      sessionUser: {
        id: "regular-admin",
        name: "Admin",
        username: "admin",
        email: "admin@example.test",
        emailVerified: true,
        platformRole: "admin",
        isSuperAdmin: false,
      },
    },
  };
}

describe("regular admin content entry points", () => {
  for (const [path, load] of routes) {
    it(`${path} opens the global list with admin mode active`, async () => {
      await expect(load(eventFor(path, true) as never)).rejects.toMatchObject({
        status: 303,
        location: `/admin/${path}`,
      });
    });

    it(`${path} keeps the personal list when admin mode is off`, async () => {
      await expect(load(eventFor(path, false) as never)).resolves.toBeDefined();
    });
  }
});
