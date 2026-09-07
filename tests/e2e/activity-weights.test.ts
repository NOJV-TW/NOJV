import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../packages/db/generated/prisma/client";
import { resolveDestructiveTestDatabase } from "../setup/destructive-test-database";
import { teacherAuth } from "./_shared";

test.use({ storageState: teacherAuth });

test("assignment weights persist, rescale, and show validation after closure", async ({
  page,
}) => {
  await page.goto("/assignments/hw1-process-trace?tab=problems");
  await page.waitForTimeout(3000);
  await page.getByRole("tab", { name: "Problems", exact: true }).click();
  const editor = page.locator('[data-slot="activity-weights"]');
  await expect(editor).toBeVisible();
  await expect(page.getByLabel("Reason for grading change")).not.toBeVisible();
  const lastProblem = page.locator('[data-slot$="-problems-tab"]').getByRole("listitem").last();
  const rowBox = await lastProblem.boundingBox();
  const editorBox = await editor.boundingBox();
  expect(editorBox!.y).toBeGreaterThanOrEqual(rowBox!.y + rowBox!.height);
  await page.waitForTimeout(3000);
  await editor.getByLabel("Total points", { exact: true }).fill("100");
  const weights = editor.locator('input[aria-label$=" weight"]');
  await expect(weights).toHaveCount(2);
  await weights.nth(0).fill("40");
  await weights.nth(1).fill("60");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).not.toBeVisible();
  await page.reload();
  await page.waitForTimeout(3000);
  await page.getByRole("tab", { name: "Problems", exact: true }).click();
  await expect(weights.nth(0)).toHaveValue("40");
  await expect(weights.nth(1)).toHaveValue("60");
  await expect(editor.getByLabel("Total points", { exact: true })).toHaveValue("100");
  await editor.getByLabel("Total points", { exact: true }).fill("200");
  await expect(weights.nth(0)).toHaveValue("40");
  await expect(weights.nth(1)).toHaveValue("60");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).not.toBeVisible();
  await weights.nth(0).fill("30");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/100%/, { exact: false }).first()).toBeVisible();
  await editor.getByRole("button", { name: "Split equally" }).click();
  await expect(weights.nth(0)).toHaveValue("50");
  await expect(weights.nth(1)).toHaveValue("50");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "output/playwright/activity-weights-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.getByRole("button", { name: "中", exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("tab", { name: "題目", exact: true }).click();
  await expect(page.getByLabel("配分異動理由")).not.toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "output/playwright/assignment-weights-ui-zh.png",
    fullPage: true,
  });
  await editor.screenshot({ path: "output/playwright/assignment-weights-editor-zh.png" });
});

test("exam equal distribution preserves basis-point remainders after reload", async ({
  page,
}) => {
  await page.goto("/exams/exam_midterm-systems-lab?tab=problems");
  await page.waitForTimeout(3000);
  await page.getByRole("tab", { name: "Problems", exact: true }).click();
  const editor = page.locator('[data-slot="activity-weights"]');
  await expect(editor).toBeVisible();
  await expect(page.getByLabel("Reason for grading change")).not.toBeVisible();
  const lastProblem = page.locator('[data-slot$="-problems-tab"]').getByRole("listitem").last();
  const rowBox = await lastProblem.boundingBox();
  const editorBox = await editor.boundingBox();
  expect(editorBox!.y).toBeGreaterThanOrEqual(rowBox!.y + rowBox!.height);
  await page.waitForTimeout(3000);
  await editor.getByLabel("Total points", { exact: true }).fill("100");
  await editor.getByRole("button", { name: "Split equally" }).click();
  const weights = editor.locator('input[aria-label$=" weight"]');
  await expect(weights).toHaveCount(3);
  await expect(weights.nth(0)).toHaveValue("33.34");
  await expect(weights.nth(1)).toHaveValue("33.33");
  await expect(weights.nth(2)).toHaveValue("33.33");
  const saved = page.waitForResponse((response) => response.url().includes("?/updateProblems"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(JSON.parse(await (await saved).text()).type).toBe("success");
  await expect(page.getByRole("button", { name: "Save", exact: true })).not.toBeVisible();
  await page.reload();
  await page.waitForTimeout(3000);
  await page.getByRole("tab", { name: "Problems", exact: true }).click();
  await expect(weights.nth(0)).toHaveValue("33.34");
  await expect(weights.nth(1)).toHaveValue("33.33");
  await expect(weights.nth(2)).toHaveValue("33.33");
  await page.screenshot({ path: "output/playwright/exam-weights-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.getByRole("button", { name: "中", exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("tab", { name: "題目", exact: true }).click();
  await expect(page.getByLabel("配分異動理由")).not.toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "output/playwright/exam-weights-ui-zh.png", fullPage: true });
  await editor.screenshot({ path: "output/playwright/exam-weights-editor-zh.png" });
});

test("empty exam drafts can save totals and restore a removed question", async ({ page }) => {
  const testPrisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: resolveDestructiveTestDatabase("nojv_e2e_test"),
    }),
  });
  const source = await testPrisma.exam.findUniqueOrThrow({
    where: { id: "exam_midterm-systems-lab" },
    include: { problems: { include: { problem: true }, orderBy: { ordinal: "asc" } } },
  });
  const problem = source.problems[0]!.problem;
  const draft = await testPrisma.exam.create({
    data: {
      title: "Weights draft browser test",
      summary: "Weights draft",
      courseId: source.courseId,
      createdByUserId: source.createdByUserId,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 3600000),
      problems: { create: { problemId: problem.id, ordinal: 1, points: 100 } },
    },
  });
  await page.goto(`/exams/${draft.id}`);
  await page.waitForTimeout(3000);
  await page.getByRole("tab", { name: "Problems", exact: true }).click();
  await page.getByRole("button", { name: "Remove from exam", exact: true }).click();
  const editor = page.locator('[data-slot="activity-weights"]');
  await editor.getByLabel("Total points", { exact: true }).fill("80");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).not.toBeVisible();
  await page.reload();
  await page.waitForTimeout(3000);
  await page.getByRole("tab", { name: "Problems", exact: true }).click();
  await expect(editor.getByLabel("Total points", { exact: true })).toHaveValue("80");
  await expect(editor.locator('input[aria-label$=" weight"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("searchbox").fill(problem.title);
  await dialog.getByText(problem.title, { exact: true }).first().click();
  await dialog.getByRole("button", { name: "Add selected" }).click();
  await expect(editor.locator('input[aria-label$=" weight"]')).toHaveValue("0");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).not.toBeVisible();
  const restored = await testPrisma.examProblem.findMany({ where: { examId: draft.id } });
  expect(restored.map((p) => p.problemId)).toEqual([problem.id]);
  await testPrisma.$disconnect();
});
