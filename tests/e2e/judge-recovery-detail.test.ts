import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { configureDomainOrchestration, submissionDomain as judge } from "@nojv/application";
import { prismaAdapterClient as db, runTransaction } from "@nojv/db";
import { expect, test } from "@playwright/test";

import { createTestProblem, createTestSubmission, createTestUser } from "../fixtures/factories";
import { assertLiveTestDatabase } from "../setup/destructive-test-database";

const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const bcrypt = requireWeb("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const waiting = "Queued for judging. Your submission has been saved.";
const recovering =
  "The system is recovering this evaluation using its original version. No resubmission is needed.";
const running = "Judging is in progress. Any previous result stays valid until completion.";
const missing =
  "The original judge version is unavailable. An instructor must explicitly rejudge to use the latest version.";
let user: Awaited<ReturnType<typeof createTestUser>>;
let problem: Awaited<ReturnType<typeof createTestProblem>>;
const password = "password123";

async function fixture(state: "waiting_capacity" | "recovering" | "legacy" | "rejudge") {
  const submission = await createTestSubmission({
    userId: user.id,
    problemId: problem.id,
    status: state === "legacy" ? "system_error" : state === "rejudge" ? "accepted" : "queued",
    ...(state === "rejudge" ? { score: 100 } : {}),
    sourceCode: "print(3)",
  });
  if (state === "legacy") return { submission, execution: null };
  const pinned = await judge.prepareJudgeSnapshot(submission.id, {
    problemId: problem.id,
    language: submission.language,
    sampleOnly: false,
  });
  const execution = await runTransaction((tx) =>
    judge.createJudgeExecution(tx, {
      submissionId: submission.id,
      ...pinned,
      ...(state === "rejudge" ? { triggeredByUserId: user.id, operationId: randomUUID() } : {}),
    }),
  );
  await judge.setJudgeExecutionState(
    execution.id,
    execution.workflowId,
    state === "rejudge" ? "waiting_capacity" : state,
    state === "recovering" ? "machine_failure" : "capacity",
  );
  return { submission, execution };
}

test.beforeAll(async () => {
  await assertLiveTestDatabase(db, "nojv_e2e_test");
  user = await createTestUser({
    platformRole: "teacher",
    emailVerified: true,
    studentTourSeenAt: new Date(),
    teacherTourSeenAt: new Date(),
  });
  await db.account.create({
    data: {
      id: randomUUID(),
      accountId: user.id,
      userId: user.id,
      providerId: "credential",
      password: await bcrypt.hash(password, 10),
    },
  });
  problem = await createTestProblem({
    authorId: user.id,
    title: "Judge recovery browser verification",
  });
  await db.testcaseSet.updateMany({ where: { problemId: problem.id }, data: { weight: 100 } });
  configureDomainOrchestration({ dispatchJudgeExecution: async () => undefined } as never);
});

test.beforeEach(async ({ page }, testInfo) => {
  const origin = String(testInfo.project.use.baseURL);
  const response = await page.request.post(`${origin}/api/auth/sign-in/email`, {
    data: { email: user.email, password },
    headers: { origin },
  });
  expect(response.status()).toBe(200);
});

test("capacity waiting clearly states the submission is saved", async ({ page }, testInfo) => {
  const { submission } = await fixture("waiting_capacity");
  await page.goto(`/submissions/${submission.id}`);
  await page.waitForTimeout(3000);
  await expect(page.getByRole("status").filter({ hasText: waiting })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("waiting-capacity.png"), fullPage: true });
});

test("SE keeps polling and moves to waiting without reload", async ({ page }, testInfo) => {
  const { submission, execution } = await fixture("recovering");
  await page.goto(`/submissions/${submission.id}`);
  await page.waitForTimeout(3000);
  await expect(page.getByRole("status").filter({ hasText: recovering })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("recovering-system-error.png"),
    fullPage: true,
  });
  let polls = 0;
  page.on("request", (request) => {
    if (request.url().includes("__data.json")) polls++;
  });
  await judge.setJudgeExecutionState(
    execution!.id,
    execution!.workflowId,
    "waiting_capacity",
    "capacity",
  );
  await expect(page.getByRole("status").filter({ hasText: waiting })).toBeVisible({
    timeout: 12_000,
  });
  expect(polls).toBeGreaterThan(0);
});

test("a missing original version clearly requires explicit teacher rejudge", async ({
  page,
}, testInfo) => {
  const { submission } = await fixture("legacy");
  await page.goto(`/submissions/${submission.id}`);
  await page.waitForTimeout(3000);
  await expect(page.getByRole("status").filter({ hasText: missing })).toBeVisible();
  await expect(page.getByText("Judging in progress...", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("missing-original-version.png"),
    fullPage: true,
  });
});

test("teacher rejudge retains AC while the active execution keeps polling", async ({
  page,
}, testInfo) => {
  const { submission, execution } = await fixture("rejudge");
  await page.goto(`/submissions/${submission.id}`);
  await page.waitForTimeout(3000);
  await expect(page.getByRole("status").filter({ hasText: waiting })).toBeVisible();
  const summary = page.locator("aside");
  await expect(summary.getByText("AC", { exact: true })).toBeVisible();
  await expect(summary).toContainText("100");
  await judge.setJudgeExecutionState(execution!.id, execution!.workflowId, "running");
  await expect(page.getByRole("status").filter({ hasText: running })).toBeVisible({
    timeout: 12_000,
  });
  await expect(summary.getByText("AC", { exact: true })).toBeVisible();
  await expect(summary).toContainText("100");
  await page.screenshot({
    path: testInfo.outputPath("teacher-rejudge-retains-ac.png"),
    fullPage: true,
  });
});
