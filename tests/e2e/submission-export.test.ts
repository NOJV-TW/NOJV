import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { test, expect } from "@playwright/test";
import { teacherAuth, studentAuth } from "./_shared";

test("activity manager downloads CSV and ZIP separately from submission history", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: teacherAuth });
  const page = await context.newPage();
  await page.goto("/assignments/hw1-process-trace?tab=submissions");
  const csvLink = page.getByRole("link", { name: /Export all submissions|匯出所有提交紀錄/ });
  await expect(csvLink).toBeVisible();
  const csvDownload = page.waitForEvent("download");
  await csvLink.click();
  const csv = await csvDownload;
  expect(await csv.failure()).toBeNull();
  expect(csv.suggestedFilename()).toBe("assignment-hw1-process-trace-submissions.csv");
  const content = await readFile((await csv.path())!, "utf8");
  expect(content).toContain('"submission_id"');
  const zipDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: /Download all sources|下載所有原始碼/ }).click();
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
  await expect(
    page.getByRole("link", { name: /Export all submissions|匯出所有提交紀錄/ }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.get(
        "/api/submissions/export?context=assignment&id=hw1-process-trace&format=csv",
      )
    ).status(),
  ).toBe(403);
  await context.close();
});
