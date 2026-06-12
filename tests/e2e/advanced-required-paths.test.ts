import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

const ORIGIN = "http://localhost:5173";

const ADVANCED_PROBLEM_ID = "problem_shell-scripting-lab";

const REQUIRED_FILE = "src/main.c";
const REQUIRED_FOLDER = "src/";

type FormActionResult = {
  type?: string;
  status?: number;
  data?: Record<string, unknown>;
  location?: string;
};

async function postFormAction(
  page: import("@playwright/test").Page,
  urlPath: string,
  form: Record<string, string>,
): Promise<FormActionResult> {
  const res = await page.request.post(urlPath, {
    form,
    headers: { origin: ORIGIN },
  });
  return res.json() as Promise<FormActionResult>;
}

async function setRequiredPaths(
  page: import("@playwright/test").Page,
  paths: string[],
): Promise<void> {
  const result = await postFormAction(
    page,
    `/problems/${ADVANCED_PROBLEM_ID}/edit?/updateRequiredPaths`,
    { data: JSON.stringify({ paths }) },
  );
  expect(result.type).not.toBe("error");
  expect(result.type).not.toBe("failure");
}

async function buildZipWithFiles(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [filePath, content] of Object.entries(files)) {
    zip.file(filePath, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

test.describe("Advanced Mode — required-paths flow", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await setRequiredPaths(page, []);
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await setRequiredPaths(page, []);
    await context.close();
  });

  test("teacher configures required paths through the editor and they persist", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    await page.goto(`/problems/${ADVANCED_PROBLEM_ID}/edit`);
    await expect(page.getByRole("main")).toBeVisible();

    await expect(
      page.getByRole("heading", { name: /required paths|必要檔案路徑/i }),
    ).toBeVisible();

    const input = page.getByTestId("required-paths-input");
    const addButton = page.getByRole("button", { name: /^add$|^新增$/i });

    await input.fill(REQUIRED_FILE);
    await addButton.click();
    await expect(
      page.locator(`[data-testid="required-paths-chip"][data-path="${REQUIRED_FILE}"]`),
    ).toBeVisible();

    await input.fill(REQUIRED_FOLDER);
    await addButton.click();
    const folderChip = page.locator(
      `[data-testid="required-paths-chip"][data-path="${REQUIRED_FOLDER}"]`,
    );
    await expect(folderChip).toBeVisible();
    await expect(folderChip).toHaveAttribute("data-kind", "folder");

    await page.getByRole("button", { name: /save required paths|儲存必要路徑/i }).click();
    await expect(page.getByText(/required paths saved\.|已儲存必要路徑。/i)).toBeVisible({
      timeout: 5_000,
    });

    await page.goto("/problems");
    await page.goto(`/problems/${ADVANCED_PROBLEM_ID}/edit`);

    const reloadedFileChip = page.locator(
      `[data-testid="required-paths-chip"][data-path="${REQUIRED_FILE}"]`,
    );
    const reloadedFolderChip = page.locator(
      `[data-testid="required-paths-chip"][data-path="${REQUIRED_FOLDER}"]`,
    );
    await expect(reloadedFileChip).toBeVisible();
    await expect(reloadedFileChip).toHaveAttribute("data-kind", "file");
    await expect(reloadedFolderChip).toBeVisible();
    await expect(reloadedFolderChip).toHaveAttribute("data-kind", "folder");

    await context.close();
  });

  test("student upload missing the required file is blocked client-side", async ({
    browser,
  }) => {
    const teacherCtx = await browser.newContext({ storageState: teacherAuth });
    const teacherPage = await teacherCtx.newPage();
    await setRequiredPaths(teacherPage, [REQUIRED_FILE, REQUIRED_FOLDER]);
    await teacherCtx.close();

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
    const teacherCtx = await browser.newContext({ storageState: teacherAuth });
    const teacherPage = await teacherCtx.newPage();
    await setRequiredPaths(teacherPage, [REQUIRED_FILE, REQUIRED_FOLDER]);
    await teacherCtx.close();

    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    await page.goto(`/problems/${ADVANCED_PROBLEM_ID}`);
    await expect(page.getByRole("main")).toBeVisible();

    const submitBtn = page.getByRole("button", { name: /^submit$|^繳交$/i });
    await expect(submitBtn).toBeDisabled();

    const goodZip = await buildZipWithFiles({
      "src/main.c": "int main(void){return 0;}\n",
      "src/util.c": "int helper(void){return 1;}\n",
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

    await expect(page.getByText(/extracted 3 files|已解壓 3 個檔案/i)).toBeVisible();

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
