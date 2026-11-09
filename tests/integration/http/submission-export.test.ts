import { expect, it, vi } from "vitest";
import JSZip from "jszip";
import { Prisma } from "../../../packages/db/generated/prisma/client";
import * as route from "../../../apps/web/src/routes/api/submissions/export/+server";
import {
  createTestContest,
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";
import { callRoute } from "./_harness";

vi.mock("#lib/auth.server.js", () => ({
  getAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const userId = headers.get("x-test-user-id");
        if (!userId) return null;
        const { testPrisma: prisma } = await import("../../fixtures/factories");
        const user = await prisma.user.findUnique({ where: { id: userId } });
        return user
          ? {
              session: { id: `session-${userId}`, userId, createdAt: new Date() },
              user,
            }
          : null;
      },
    },
  }),
}));

it.each(["assignment", "exam", "contest"] as const)(
  "exports only %s submissions for managers and denies other users",
  async (kind) => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const student = await createTestUser();
    const outsider = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: teacher.id, role: "teacher", status: "active" },
    });
    const activity =
      kind === "contest"
        ? await createTestContest({ createdByUserId: teacher.id })
        : kind === "exam"
          ? await createTestExam({ courseId: course.id })
          : await testPrisma.assessment.create({
              data: {
                courseId: course.id,
                createdByUserId: teacher.id,
                title: "Export",
                summary: "Export",
                status: "published",
                opensAt: new Date(),
                closesAt: new Date(Date.now() + 3600000),
              },
            });
    const problem = await createTestProblem({ authorId: outsider.id });
    const fields =
      kind === "contest"
        ? { contestId: activity.id }
        : kind === "exam"
          ? { examId: activity.id }
          : { assessmentId: activity.id, courseId: course.id };
    const submissions = [];
    for (let i = 0; i < 51; i++)
      submissions.push(
        await createTestSubmission({
          ...fields,
          userId: student.id,
          problemId: problem.id,
          sourceCode: `print(${i})`,
        }),
      );
    const unrelated = await createTestSubmission({ userId: student.id, problemId: problem.id });
    const read = (format: string, user: typeof teacher | null = teacher) =>
      callRoute({
        path: `/api/submissions/export?context=${kind}&id=${activity.id}&format=${format}`,
        module: route,
        user,
      });
    const csv = await read("csv");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("cache-control")).toBe("private, no-store");
    const text = await csv.text();
    expect(text.split("\r\n")).toHaveLength(53);
    for (const sub of submissions) expect(text).toContain(sub.id);
    expect(text).not.toContain(unrelated.id);
    const unavailable = submissions[50]!;
    await testPrisma.submission.update({
      where: { id: unavailable.id },
      data: { sourceStorage: Prisma.DbNull, status: "system_error" },
    });
    const response = await read("zip");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(".zip");
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const files = Object.values(zip.files).filter((file) => !file.dir);
    expect(files).toHaveLength(51);
    expect(
      await zip
        .file(`${student.id}/${problem.id}/${unavailable.id}/SOURCE_UNAVAILABLE.txt`)!
        .async("string"),
    ).toContain("has no stored source files");
    expect(
      await zip
        .file(`${student.id}/${problem.id}/${submissions[0]!.id}/main.py`)!
        .async("string"),
    ).toBe("print(0)");
    for (const format of ["csv", "zip"]) {
      expect((await read(format, student)).status).toBe(403);
      expect((await read(format, outsider)).status).toBe(403);
      expect((await read(format, null)).status).toBe(401);
    }
    expect((await read("pdf")).status).toBe(400);
  },
  30000,
);
