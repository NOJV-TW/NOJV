import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import path from "node:path";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

const ADVANCED_PROBLEM_ID = "problem_shell-scripting-lab";

const REQUIRED_FILE = "main.py";

async function buildZipWithFiles(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [filePath, content] of Object.entries(files)) {
    zip.file(filePath, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

test.describe("Advanced Mode — required-paths flow", () => {
  test.describe.configure({ mode: "serial" });

  test("student upload missing the required file is blocked client-side", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    await page.goto(`/problems/${ADVANCED_PROBLEM_ID}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText(/upload a zip archive or a single source file/i)).toBeVisible();

    const submitBtn = page.getByRole("button", { name: /^submit$|^繳交$/i });
    await expect(submitBtn).toBeDisabled();

    const badZip = await buildZipWithFiles({ "wrong-name.c": "int main(){return 0;}\n" });

    const fileInput = page.locator(`#advanced-upload-${ADVANCED_PROBLEM_ID}`);
    const errorRegion = page.getByTestId("advanced-staging-error");
    await expect(async () => {
      await fileInput.setInputFiles({
        name: "missing-main.zip",
        mimeType: "application/zip",
        buffer: badZip,
      });
      await expect(errorRegion).toBeVisible({ timeout: 1_500 });
    }).toPass({ intervals: [250, 500, 1000, 2000], timeout: 20_000 });

    await expect(errorRegion).toContainText(REQUIRED_FILE);

    await expect(submitBtn).toBeDisabled();

    await context.close();
  });

  test("student upload that satisfies required paths submits", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    await page.goto(`/problems/${ADVANCED_PROBLEM_ID}`);
    await expect(page.getByRole("main")).toBeVisible();

    const submitBtn = page.getByRole("button", { name: /^submit$|^繳交$/i });
    await expect(submitBtn).toBeDisabled();

    const goodZip = await buildZipWithFiles({
      "main.py": "print(5)\n",
      "README.md": "# advanced-mode e2e\n",
    });

    const fileInput = page.locator(`#advanced-upload-${ADVANCED_PROBLEM_ID}`);
    await expect(async () => {
      await fileInput.setInputFiles({
        name: "valid.zip",
        mimeType: "application/zip",
        buffer: goodZip,
      });
      await expect(submitBtn).toBeEnabled({ timeout: 1_500 });
    }).toPass({ intervals: [250, 500, 1000, 2000], timeout: 20_000 });

    await expect(page.getByTestId("advanced-staging-error")).not.toBeVisible();

    await expect(page.getByText(/extracted 2 files|已解壓 2 個檔案/i)).toBeVisible();

    const responsePromise = page.waitForResponse(
      (r) => r.url().endsWith("/api/submissions") && r.request().method() === "POST",
    );
    await submitBtn.click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.submissionId).toBeTruthy();
    expect(body.pollUrl).toContain(body.submissionId);

    await page.goto("/");

    await context.close();
  });
});
