import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

const ORIGIN = "http://localhost:5173";

// Seeded `special_env` problem. Owned by the seeded teacher,
// `visibility: public`, `status: published` — both teacher and student can
// reach the solve page without extra setup. See
// `packages/db/prisma/seeds/problems.ts` (problem_shell-scripting-lab).
const ADVANCED_PROBLEM_ID = "problem_shell-scripting-lab";

// Required paths exercised by the spec. `src/main.c` is a file path,
// `src/` is a folder prefix — together they cover both branches of the
// chip renderer (FileText vs Folder icon) and the validator.
const REQUIRED_FILE = "src/main.c";
const REQUIRED_FOLDER = "src/";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------------

test.describe("Advanced Mode — required-paths flow", () => {
  test.describe.configure({ mode: "serial" });

  // Reset required paths before AND after the suite. The seed leaves the
  // column at `[]`, but a half-finished prior run may have left chips
  // behind, and we want to leave the DB clean for adjacent specs.
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

    // Section heading lives in RequiredPathsSection.svelte. The English copy
    // ("Required paths") and zh-TW ("必要檔案路徑") are accepted — Playwright
    // config defaults to en-US, but matching both keeps the assertion robust
    // if the runner ever flips locale.
    await expect(
      page.getByRole("heading", { name: /required paths|必要檔案路徑/i }),
    ).toBeVisible();

    const input = page.getByTestId("required-paths-input");
    const addButton = page.getByRole("button", { name: /^add$|^新增$/i });

    // Add the file path first.
    await input.fill(REQUIRED_FILE);
    await addButton.click();
    await expect(
      page.locator(`[data-testid="required-paths-chip"][data-path="${REQUIRED_FILE}"]`),
    ).toBeVisible();

    // Then the folder path. Folder chips render the Folder icon — the
    // `data-kind` attribute reflects the same branch the component takes.
    await input.fill(REQUIRED_FOLDER);
    await addButton.click();
    const folderChip = page.locator(
      `[data-testid="required-paths-chip"][data-path="${REQUIRED_FOLDER}"]`,
    );
    await expect(folderChip).toBeVisible();
    await expect(folderChip).toHaveAttribute("data-kind", "folder");

    // Save. The Save button is disabled while clean; it becomes enabled
    // once `requiredPaths` differs from the baseline. After a successful
    // save the toast announces the localized success message.
    await page.getByRole("button", { name: /save required paths|儲存必要路徑/i }).click();
    await expect(page.getByText(/required paths saved\.|已儲存必要路徑。/i)).toBeVisible({
      timeout: 5_000,
    });

    // Navigate away then back to confirm persistence.
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
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    await page.goto(`/problems/${ADVANCED_PROBLEM_ID}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText(/upload a zip archive or a single source file/i)).toBeVisible();

    // Submit button is part of AdvancedModeWorkspace's bottom action bar.
    // Disabled until `staged` is non-null.
    const submitBtn = page.getByRole("button", { name: /^submit$|^繳交$/i });
    await expect(submitBtn).toBeDisabled();

    // Build a ZIP that lacks `src/main.c` — only contains a stray file.
    const badZip = await buildZipWithFiles({ "wrong-name.c": "int main(){return 0;}\n" });

    // The drop-zone wraps a hidden <input type="file">; setInputFiles()
    // feeds the bytes directly so JSZip extraction kicks in. We retry the
    // setInputFiles + assertion via toPass() because Svelte 5 attaches
    // event handlers during hydration via root-level event delegation —
    // there's no public hydration flag to wait for, and a setInputFiles
    // call dispatched before hydration races silently. Each retry is
    // safe: onPick resets input.value so re-selecting the same file
    // refires the change event. The pre-flight in stageFile() runs
    // validateRequiredPaths after JSZip extraction; on miss it sets
    // stagingError to the localized message and refuses to set `staged`.
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

    // The message should name the missing path so students can fix it.
    await expect(errorRegion).toContainText(REQUIRED_FILE);

    // Submit must remain disabled because `staged` was never set.
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

    // Valid ZIP — `src/main.c` covers both the explicit file and the
    // `src/` folder prefix in one entry, but include a sibling so the
    // assertion proves we accept multi-file payloads.
    const goodZip = await buildZipWithFiles({
      "src/main.c": "int main(void){return 0;}\n",
      "src/util.c": "int helper(void){return 1;}\n",
      "README.md": "# advanced-mode e2e\n",
    });

    // Same hydration retry shape as the miss-path test — see that comment
    // for why setInputFiles is wrapped in toPass(). Probe is "Submit
    // button enabled" instead of "error region visible".
    const fileInput = page.locator(`#advanced-upload-${ADVANCED_PROBLEM_ID}`);
    await expect(async () => {
      await fileInput.setInputFiles({
        name: "valid.zip",
        mimeType: "application/zip",
        buffer: goodZip,
      });
      await expect(submitBtn).toBeEnabled({ timeout: 1_500 });
    }).toPass({ intervals: [250, 500, 1000, 2000], timeout: 20_000 });

    // No error region — the valid ZIP satisfies all required paths.
    await expect(page.getByTestId("advanced-staging-error")).not.toBeVisible();

    // Drop-zone copy switches to staged metadata, including the file count.
    // This is the visible-to-the-user proof that staging completed.
    await expect(page.getByText(/extracted 3 files|展開 3 個檔案/i)).toBeVisible();

    // Click Submit and assert the dispatch POST. /api/submissions persists
    // the Submission row and queues the Temporal workflow; the endpoint
    // returns BEFORE judging actually runs (judging needs the demo-judge
    // image, which local dev may lack — but that's a separate phase).
    // A 2xx here proves:
    //   1. Staging passed the client-side required-paths check (above).
    //   2. The server-side defense-in-depth re-check inside
    //      createQueuedSubmissionRecord did NOT throw — exactly Task C's
    //      contract for the happy path.
    //   3. The submission row exists.
    // Pollution: the Submission row lingers in the DB. No precedent for
    // E2E-level submission cleanup (submission-lifecycle.test.ts also
    // leaves rows behind); db:seed resets the schema between sessions.
    const responsePromise = page.waitForResponse(
      (r) => r.url().endsWith("/api/submissions") && r.request().method() === "POST",
    );
    await submitBtn.click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.submissionId).toBeTruthy();
    expect(body.pollUrl).toContain(body.submissionId);

    // After dispatch, the workspace polls /api/submissions/{id} until the
    // verdict arrives or times out. Navigate away so that polling loop
    // unmounts cleanly before context.close() — otherwise the in-flight
    // fetch races with teardown.
    await page.goto("/");

    await context.close();
  });
});
