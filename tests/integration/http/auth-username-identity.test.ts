import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createTestCourse,
  createTestExam,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";
import { examDomain } from "@nojv/application";
import { getAuth } from "$lib/auth.server";

vi.mock("$env/dynamic/private", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../setup/stubs/env-dynamic-private")>();
  return {
    env: {
      ...original.env,
      BETTER_AUTH_URL: "http://localhost:5173",
      GOOGLE_CLIENT_ID: "integration-google-client",
      GOOGLE_CLIENT_SECRET: "integration-google-secret",
    },
  };
});

const origin = "http://localhost:5173";
let googleUser: { id: string; name: string; email: string; emailVerified: boolean };

beforeAll(async () => {
  const context = await getAuth().$context;
  const google = context.socialProviders.find((provider) => provider.id === "google");
  if (!google) throw new Error("The integration Google provider is missing.");
  vi.spyOn(google, "validateAuthorizationCode").mockResolvedValue({
    accessToken: "integration-google-token",
  });
  vi.spyOn(google, "getUserInfo").mockImplementation(async () => ({
    user: googleUser,
    data: {},
  }));
}, 30_000);

afterAll(() => vi.restoreAllMocks());

function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .filter((cookie) => !/;\s*max-age=0(?:;|$)/i.test(cookie))
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

async function completeGoogleCallback(authorizationURL: string, cookie: string) {
  const state = new URL(authorizationURL).searchParams.get("state");
  expect(state).toBeTruthy();
  return getAuth().handler(
    new Request(`${origin}/api/auth/callback/google?code=integration-code&state=${state}`, {
      headers: { cookie },
    }),
  );
}

async function signInGoogle(user: { id: string; name: string; email: string }) {
  const account = await testPrisma.account.create({
    data: {
      id: `google-${user.id}`,
      userId: user.id,
      providerId: "google",
      accountId: `google-subject-${user.id}`,
    },
  });
  googleUser = {
    id: account.accountId,
    name: user.name,
    email: user.email,
    emailVerified: true,
  };
  const start = await getAuth().handler(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL: `${origin}/dashboard` }),
    }),
  );
  expect(start.status).toBe(200);
  const authorization = (await start.json()) as { url: string };
  const response = await completeGoogleCallback(authorization.url, cookieHeader(start.headers));
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`${origin}/dashboard`);
  const cookie = cookieHeader(response.headers);
  const session = await getAuth().api.getSession({ headers: new Headers({ cookie }) });
  expect(session?.user.id).toBe(user.id);
  expect(session?.session.userId).toBe(user.id);
  await expect(
    testPrisma.account.findUniqueOrThrow({ where: { id: account.id } }),
  ).resolves.toMatchObject({ userId: user.id, accountId: account.accountId });
  return { cookie, account };
}

describe("OAuth preserves the username identity", () => {
  it("can replace an exam login with verified OAuth without linking the temporary account", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const student = await createTestUser({ emailVerified: true });
    const oauthUser = await createTestUser({ emailVerified: true });
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
    await examDomain.credentials.setPassword(
      {
        userId: teacher.id,
        username: teacher.username!,
        email: teacher.email,
        displayName: teacher.name,
        platformRole: "teacher",
      },
      exam.id,
      student.id,
      "SyntheticExamPassword24",
    );
    const temporary = await getAuth().handler(
      new Request(`${origin}/api/auth/sign-in/exam-password`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          username: student.username,
          password: "SyntheticExamPassword24",
        }),
      }),
    );
    expect(temporary.status).toBe(200);
    const temporaryCookie = cookieHeader(temporary.headers);
    const account = await testPrisma.account.create({
      data: {
        id: `google-${oauthUser.id}`,
        userId: oauthUser.id,
        providerId: "google",
        accountId: `google-subject-${oauthUser.id}`,
      },
    });
    googleUser = {
      id: account.accountId,
      name: oauthUser.name,
      email: oauthUser.email,
      emailVerified: true,
    };
    const start = await getAuth().handler(
      new Request(`${origin}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { origin, cookie: temporaryCookie, "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: `${origin}/dashboard`,
          additionalData: { link: { userId: student.id, email: student.email } },
        }),
      }),
    );
    expect(start.status).toBe(200);
    const authorization = (await start.json()) as { url: string };
    const callback = await completeGoogleCallback(
      authorization.url,
      `${temporaryCookie}; ${cookieHeader(start.headers)}`,
    );
    expect(callback.status).toBe(302);
    const session = await getAuth().api.getSession({
      headers: new Headers({ cookie: cookieHeader(callback.headers) }),
    });
    expect(session?.user.id).toBe(oauthUser.id);
    expect(session?.session.examPassword).toBe(false);
    expect(await testPrisma.account.count({ where: { userId: student.id } })).toBe(0);
  });

  it.each([null, "ordinary_handle"])(
    "creates a returning Google session with username=%s despite another account owning the email's student ID",
    async (username) => {
      const owner = await createTestUser({ username: "41247009s" });
      const user = await createTestUser({
        username,
        displayUsername: username,
        email: "41247009s@gapps.ntnu.edu.tw",
        emailVerified: true,
      });

      await signInGoogle(user);

      await expect(
        testPrisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      ).resolves.toMatchObject({ username, displayUsername: username, email: user.email });
      await expect(
        testPrisma.user.findUniqueOrThrow({ where: { id: owner.id } }),
      ).resolves.toEqual(owner);
      await expect(testPrisma.user.count()).resolves.toBe(2);
      await expect(testPrisma.account.count({ where: { userId: user.id } })).resolves.toBe(1);
      await expect(testPrisma.session.count({ where: { userId: user.id } })).resolves.toBe(1);
    },
  );

  it("links another Google email to the same User without replacing its verified username", async () => {
    const user = await createTestUser({
      username: "41047001a",
      displayUsername: "41047001a",
      emailVerified: true,
    });
    const { cookie, account } = await signInGoogle(user);
    googleUser = {
      id: "linked-google-subject",
      name: "Another Google profile",
      email: "41247009s@gapps.ntnu.edu.tw",
      emailVerified: true,
    };

    const link = await getAuth().api.linkSocialAccount({
      headers: new Headers({ cookie, origin }),
      body: { provider: "google", callbackURL: `${origin}/settings` },
      returnHeaders: true,
    });
    expect(link.response.url).toBeTruthy();
    const callback = await completeGoogleCallback(
      link.response.url!,
      `${cookie}; ${cookieHeader(link.headers)}`,
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${origin}/settings`);
    await expect(
      testPrisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.toMatchObject({
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      username: user.username,
      displayUsername: user.displayUsername,
    });
    await expect(
      testPrisma.account.findUniqueOrThrow({
        where: {
          providerId_accountId: { providerId: "google", accountId: googleUser.id },
        },
      }),
    ).resolves.toMatchObject({ userId: user.id });
    await expect(
      testPrisma.account.findUniqueOrThrow({ where: { id: account.id } }),
    ).resolves.toMatchObject({ userId: user.id });
    await expect(testPrisma.user.count()).resolves.toBe(1);
    await expect(testPrisma.account.count({ where: { userId: user.id } })).resolves.toBe(2);
  });
});
