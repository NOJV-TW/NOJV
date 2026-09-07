import { afterEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../../packages/db/generated/prisma/client";
import { seedCourses } from "../../../packages/db/prisma/seeds/courses";
import { seedUsers } from "../../../packages/db/prisma/seeds/users";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("course roster demo seed", () => {
  it("creates only credentialed Users and preserves the existing login handles", async () => {
    vi.stubEnv("SEED_ADMIN_USERNAME", "admin");
    vi.stubEnv("SEED_ADMIN_EMAIL", "admin@nojv.local");
    vi.stubEnv("SEED_ADMIN_PASSWORD", "test-password-123");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const upsertUser = vi.fn(({ create }: { create: { username: string } }) => ({
      ...create,
      id: `user_${create.username}`,
    }));
    const upsertAccount = vi.fn();
    await seedUsers({
      user: { upsert: upsertUser },
      account: { upsert: upsertAccount },
    } as unknown as PrismaClient);
    expect(upsertUser.mock.calls.map(([args]) => args.create.username)).toEqual([
      "admin",
      "teacher",
      "ta-student",
      "student",
      "new-student",
    ]);
    expect(upsertAccount).toHaveBeenCalledTimes(5);
    for (const [args] of upsertUser.mock.calls) {
      expect(args.create).not.toHaveProperty("status");
    }
  });

  it("seeds a stable pending membership and keeps existing course/activity links", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const memberships = vi.fn();
    const upsert = vi.fn(({ create }: { create: { id: string } }) => create);
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      course: { upsert },
      courseMembership: { upsert: memberships },
      assessment: { upsert, findMany: vi.fn().mockResolvedValue([]) },
      exam: { upsert, findMany: vi.fn().mockResolvedValue([]) },
      problem: {
        findUniqueOrThrow: vi.fn(({ where }: { where: { id: string } }) => where),
      },
      assessmentProblem: { upsert },
      examProblem: { upsert },
    };
    await seedCourses(prisma as unknown as PrismaClient, {
      teacher: { id: "teacher" },
      taStudent: { id: "ta" },
      student: { id: "student" },
    });
    expect(memberships).toHaveBeenCalledWith({
      create: {
        id: "membership_demo_pending",
        courseId: "course_os-lab-spring-2026",
        pendingUsername: "b11902999",
        role: "student",
        addedByUserId: "teacher",
      },
      update: {},
      where: { id: "membership_demo_pending" },
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "hw1-process-trace" },
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "exam_midterm-systems-lab" },
      }),
    );
  });
});
