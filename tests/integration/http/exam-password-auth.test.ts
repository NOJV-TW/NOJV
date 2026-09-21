import { beforeAll, describe, expect, it } from "vitest";
import { examDomain } from "@nojv/application";
import { getAuth } from "$lib/auth.server";
import {
  createTestCourse,
  createTestExam,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";
import { callRoute } from "./_harness";

const authRoute = await import("../../../apps/web/src/routes/api/auth/[...path]/+server");
const password = "SyntheticExamPassword24";

beforeAll(async () => {
  await import("$lib/../hooks.server");
  await getAuth().$context;
}, 30_000);

function cookieHeader(response: Response) {
  return response.headers
    .getSetCookie()
    .filter((cookie) => !/;\s*max-age=0(?:;|$)/i.test(cookie))
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

async function classroom() {
  const teacher = await createTestUser({ platformRole: "teacher" });
  const student = await createTestUser({ emailVerified: true });
  const course = await createTestCourse({ ownerId: teacher.id });
  await testPrisma.courseMembership.createMany({
    data: [
      { courseId: course.id, userId: teacher.id, role: "teacher" },
      { courseId: course.id, userId: student.id, role: "student" },
    ],
  });
  const exam = await createTestExam({
    courseId: course.id,
    startsAt: new Date(Date.now() + 60_000),
    endsAt: new Date(Date.now() + 3_600_000),
  });
  const actor = {
    userId: teacher.id,
    username: teacher.username!,
    displayName: teacher.name,
    email: teacher.email,
    platformRole: "teacher" as const,
  };
  await examDomain.credentials.setPassword(actor, exam.id, student.id, password);
  return { actor, student, exam, course };
}

async function signIn(username: string, inputPassword = password) {
  return callRoute({
    path: "/api/auth/sign-in/exam-password",
    method: "POST",
    module: authRoute,
    body: { username, password: inputPassword },
  });
}

describe("exam password authentication", () => {
  it("issues an expiring marked session without changing ordinary accounts", async () => {
    const { student, exam } = await classroom();
    const response = await signIn(student.username!);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ examId: exam.id });
    const cookie = cookieHeader(response);
    const session = await getAuth().api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.id).toBe(student.id);
    expect(session?.session.examPassword).toBe(true);
    expect(session?.session.expiresAt.getTime()).toBe(exam.endsAt.getTime());
    expect(await testPrisma.account.count({ where: { userId: student.id } })).toBe(0);
    expect(
      await testPrisma.examCredentialSession.count({
        where: { sessionId: session!.session.id },
      }),
    ).toBe(1);
  });

  it("rejects incorrect and expired passwords with no session", async () => {
    const { student, exam } = await classroom();
    expect((await signIn(student.username!, "incorrect-password")).status).toBe(401);
    await testPrisma.exam.update({
      where: { id: exam.id },
      data: {
        startsAt: new Date(Date.now() - 120_000),
        endsAt: new Date(Date.now() - 60_000),
      },
    });
    expect((await signIn(student.username!)).status).toBe(401);
    expect(await testPrisma.session.count({ where: { userId: student.id } })).toBe(0);
  });

  it("denies permanent account control through direct Better Auth endpoints", async () => {
    const { student } = await classroom();
    const response = await signIn(student.username!);
    const cookie = cookieHeader(response);
    for (const [path, method, body] of [
      ["/api/auth/link-social", "POST", { provider: "google", callbackURL: "/settings" }],
      ["/api/auth/change-email", "POST", { newEmail: "synthetic-changed@example.test" }],
      ["/api/auth/passkey/generate-register-options", "GET", undefined],
      [
        "/api/auth/change-password",
        "POST",
        { currentPassword: password, newPassword: "SyntheticPermanentPassword24" },
      ],
      ["/api/auth/delete-user", "POST", {}],
    ] as const) {
      const denied = await callRoute({
        path,
        method,
        module: authRoute,
        headers: { cookie },
        body,
      });
      expect(denied.status, path).toBe(403);
    }
    expect(await testPrisma.account.count({ where: { userId: student.id } })).toBe(0);
    expect((await testPrisma.user.findUniqueOrThrow({ where: { id: student.id } })).email).toBe(
      student.email,
    );
    await expect(
      getAuth().api.listUserAccounts({ headers: new Headers({ cookie }) }),
    ).resolves.toEqual([]);
    await expect(
      getAuth().api.listPasskeys({ headers: new Headers({ cookie }) }),
    ).resolves.toEqual([]);
  });

  it("revokes the password session when a teacher rotates its password", async () => {
    const { actor, student, exam } = await classroom();
    const response = await signIn(student.username!);
    const cookie = cookieHeader(response);
    await examDomain.credentials.setPassword(
      actor,
      exam.id,
      student.id,
      "SyntheticRotatedPassword24",
    );
    expect(await getAuth().api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect((await signIn(student.username!)).status).toBe(401);
    expect((await signIn(student.username!, "SyntheticRotatedPassword24")).status).toBe(200);
  });

  it("does not turn a credential with deleted provenance into an ordinary login", async () => {
    const { student } = await classroom();
    const response = await signIn(student.username!);
    const cookie = cookieHeader(response);
    const session = await getAuth().api.getSession({ headers: new Headers({ cookie }) });
    await testPrisma.examCredentialSession.delete({
      where: { sessionId: session!.session.id },
    });
    expect(await getAuth().api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect(
      await testPrisma.session.findUnique({ where: { id: session!.session.id } }),
    ).toBeNull();
  });

  it("revokes temporary access after a student becomes a TA in another course", async () => {
    const { student } = await classroom();
    const response = await signIn(student.username!);
    const cookie = cookieHeader(response);
    const otherCourse = await createTestCourse();
    await testPrisma.courseMembership.create({
      data: { courseId: otherCourse.id, userId: student.id, role: "ta" },
    });
    expect(await getAuth().api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect((await signIn(student.username!)).status).toBe(401);
  });

  it("expires an existing session immediately when the exam ends, before cleanup runs", async () => {
    const { student, exam } = await classroom();
    const response = await signIn(student.username!);
    const cookie = cookieHeader(response);
    await testPrisma.exam.update({
      where: { id: exam.id },
      data: {
        startsAt: new Date(Date.now() - 120_000),
        endsAt: new Date(Date.now() - 60_000),
      },
    });
    expect(await getAuth().api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect(await testPrisma.session.count({ where: { userId: student.id } })).toBe(0);
  });
});
