import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { test, expect } from "@playwright/test";
import { teacherAuth, studentAuth } from "./_shared";

test("activity manager uses the split export button for combined and individual downloads", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: teacherAuth });
  const page = await context.newPage();
  await page.goto("/assignments/hw1-process-trace?tab=submissions");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const allDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: /^(Export|匯出)$/ }).click();
  const all = await allDownload;
  expect(await all.failure()).toBeNull();
  const bundle = await JSZip.loadAsync(await readFile((await all.path())!));
  expect(bundle.file("submissions.csv")).not.toBeNull();
  expect(Object.values(bundle.files).filter((file) => !file.dir).length).toBeGreaterThan(1);
  await page.getByRole("button", { name: /Export options|匯出選項/ }).click();
  const csvLink = page.getByRole("menuitem", { name: /Records CSV|紀錄 CSV/ });
  await expect(csvLink).toBeVisible();
  await page.screenshot({ path: "output/playwright/submission-export-menu-en.png" });
  const csvDownload = page.waitForEvent("download");
  await csvLink.click();
  const csv = await csvDownload;
  expect(await csv.failure()).toBeNull();
  expect(csv.suggestedFilename()).toBe("assignment-hw1-process-trace-submissions.csv");
  const content = await readFile((await csv.path())!, "utf8");
  expect(content).toContain('"submission_id"');
  const zipDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export options|匯出選項/ }).click();
  await page.getByRole("menuitem", { name: /Sources ZIP|原始碼 ZIP/ }).click();
  const archive = await zipDownload;
  expect(await archive.failure()).toBeNull();
  const zip = await JSZip.loadAsync(await readFile((await archive.path())!));
  expect(archive.suggestedFilename()).toBe("assignment-hw1-process-trace-submissions.zip");
  expect(Object.values(zip.files).filter((file) => !file.dir).length).toBeGreaterThan(0);
  await context.close();
});

test("student cannot use activity export controls or endpoint", async ({ browser }) => {
  const context = await browser.newContext({ storageState: studentAuth });
  const page = await context.newPage();
  await page.goto("/assignments/hw1-process-trace");
  await expect(page.getByRole("link", { name: /^(Export|匯出)$/ })).toHaveCount(0);
  expect(
    (
      await page.request.get(
        "/api/submissions/export?context=assignment&id=hw1-process-trace&format=csv",
      )
    ).status(),
  ).toBe(403);
  await context.close();
});
