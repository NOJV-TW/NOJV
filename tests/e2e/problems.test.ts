import { test, expect } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import path from "node:path";

import { adminAuth, apiWriteHeaders, formActionHeaders } from "./_shared";
import { PrismaClient } from "../../packages/db/generated/prisma/client";
import { resolveDestructiveTestDatabase } from "../setup/destructive-test-database";

const testPrisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: resolveDestructiveTestDatabase("nojv_e2e_test"),
  }),
});

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

test.describe("Problems", () => {
  test.afterAll(async () => testPrisma.$disconnect());

  test("can browse problem list as authenticated user", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/problems");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("can view problem detail page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto("/problems/problem_warmup-sum");
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("mobile statement dialog traps and restores keyboard focus", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: studentAuth,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto("/problems/problem_warmup-sum");

    const trigger = page.getByRole("button", { name: /view statement/i });
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Warmup Sum" });
    const close = dialog.getByRole("button", { name: /close statement/i });
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(close).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await close.click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await context.close();
  });

  test("teacher can create a problem via API and access edit page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.post("/api/problems", { headers: apiWriteHeaders });
    expect(res.ok()).toBe(true);
    const { id } = await res.json();
    expect(id).toBeTruthy();
    await page.goto(`/problems/${id}/edit`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("problem editor uses a visibility dropdown and required runtime limits", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const response = await page.request.post("/api/problems", { headers: apiWriteHeaders });
    expect(response.ok()).toBe(true);
    const { id } = await response.json();

    await page.goto(`/problems/${id}/edit`);
    await page.waitForTimeout(3000);
    const visibility = page.getByRole("button", { name: "Private", exact: true });
    await visibility.click();
    await expect(page.getByRole("option", { name: "Public" })).toBeVisible();
    await expect(page.locator('input[name="timeLimitMs"]')).toHaveAttribute("required", "");
    await expect(page.locator('input[name="memoryLimitMb"]')).toHaveAttribute("required", "");

    await context.close();
  });

  test("student can finish and publish an owned private problem", async ({ browser }) => {
    const user = await testPrisma.user.update({
      where: { email: "student@nojv.local" },
      data: { emailVerified: true },
    });
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    let id = "";

    try {
      const response = await page.request.post("/api/problems", { headers: apiWriteHeaders });
      expect(response.ok()).toBe(true);
      ({ id } = await response.json());

      await page.goto(`/problems/${id}/edit`);
      await page.locator("input[name='title']").fill(`Private Student Problem ${Date.now()}`);
      await page.locator("textarea[name='statement']").fill("Add two integers.");
      await page.locator("textarea[name='inputFormat']").fill("Two integers.");
      await page.locator("textarea[name='outputFormat']").fill("Their sum.");
      await page.getByRole("button", { name: /save|儲存/i }).click();
      await expect(page.getByRole("button", { name: /save|儲存/i })).toBeDisabled();

      const testcaseResponse = await page.request.post(
        `/problems/${id}/edit?/createTestcaseSet`,
        {
          form: {
            data: JSON.stringify({
              name: "Main",
              weight: 100,
              cases: [{ input: "1 2", output: "3" }],
            }),
          },
          headers: formActionHeaders,
        },
      );
      expect((await testcaseResponse.json()).type).not.toBe("failure");

      const referenceId = `reference-${id}`;
      const inserted = await testPrisma.$executeRaw`
        INSERT INTO "Submission" (id, "userId", "problemId", "isReferenceSolution", "referenceProblemStorageGeneration", language, "sourceStorage", status, "updatedAt")
        SELECT ${referenceId}, ${user.id}, p.id, true, p."storageGeneration", 'c'::"SupportedLanguage", source."sourceStorage", 'accepted'::"SubmissionStatus", NOW()
        FROM "Problem" p
        CROSS JOIN LATERAL (
          SELECT "sourceStorage" FROM "Submission" WHERE "sourceStorage" IS NOT NULL LIMIT 1
        ) source
        WHERE p.id = ${id}
      `;
      expect(inserted).toBe(1);
      await testPrisma.problem.update({
        where: { id },
        data: { referenceSolutionSubmissionId: referenceId },
      });

      await page.reload();
      await expect(page.getByRole("button", { name: "Finish & Publish" })).toBeEnabled();

      const publishResponse = await page.request.post(`/problems/${id}/edit?/publish`, {
        form: {},
        headers: formActionHeaders,
      });
      const publishBody = await publishResponse.json();
      expect(publishBody.type).not.toBe("error");
      expect(publishBody.type).not.toBe("failure");
      await expect
        .poll(async () => {
          const problem = await testPrisma.problem.findUnique({
            where: { id },
            select: { status: true, visibility: true },
          });
          return `${problem?.status ?? "missing"}|${problem?.visibility ?? "missing"}`;
        })
        .toBe("published|private");
    } finally {
      if (id) await testPrisma.problem.deleteMany({ where: { id } });
      await testPrisma.user.update({
        where: { id: user.id },
        data: { emailVerified: false },
      });
      await context.close();
    }
  });

  test("admin can fork a public problem into an independent draft", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    const response = await page.request.post("/api/problems/problem_warmup-sum/fork", {
      headers: apiWriteHeaders,
    });
    expect(response.status()).toBe(201);
    const { id } = await response.json();

    await page.goto(`/problems/${id}/edit`);
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();

    const deleted = await page.request.delete(`/api/problems/${id}`, {
      headers: apiWriteHeaders,
    });
    expect(deleted.ok()).toBe(true);
    await context.close();
  });
});
