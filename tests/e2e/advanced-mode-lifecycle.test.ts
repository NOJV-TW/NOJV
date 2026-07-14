import { test, expect, type FileChooser } from "@playwright/test";
import JSZip from "jszip";
import path from "node:path";

import { apiWriteHeaders, formActionHeaders } from "./_shared";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

const ADVANCED_EXAM_ID = "exam_demo_advanced_active";
const SEEDED_ADVANCED_PROBLEM_ID = "problem_shell-scripting-lab";

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
    headers: formActionHeaders,
  });
  return res.json() as Promise<FormActionResult>;
}

async function buildSubmissionZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("main.py", "a, b = map(int, input().split())\nprint(a + b)\n");
  zip.file("README.md", "# advanced-mode e2e upload\n");
  return zip.generateAsync({ type: "nodebuffer" });
}

let advancedProblemId = "";

test.describe("Advanced Mode Lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  test("problem creation is an ordinary keyboard disclosure", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: teacherAuth,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();

    await page.goto("/problems?tab=mine");
    const trigger = page.getByRole("button", { name: /create options/i });
    await expect(trigger).toHaveAttribute("aria-controls", "problem-create-options");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.focus();
    await page.keyboard.press("Enter");
    const disclosure = page.locator("#problem-create-options");
    await expect(disclosure).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("menu")).toHaveCount(0);

    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Advanced Mode" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(disclosure).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);

    await context.close();
  });

  test("server rendering exposes only controls that work without hydration", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      storageState: teacherAuth,
    });
    const page = await context.newPage();

    await page.goto("/problems?tab=mine");
    await expect(page.getByRole("link", { name: "Public Library" })).toBeVisible();
    await expect(page.getByRole("link", { name: "My Problems" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /create new problem|create options/i }),
    ).toHaveCount(0);

    await context.close();
  });

  test("teacher creates an Advanced Mode problem via API", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    const res = await page.request.post("/api/problems", {
      data: { mode: "advanced" },
      headers: apiWriteHeaders,
    });
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { id: string; mode: string };
    advancedProblemId = body.id;
    expect(advancedProblemId).toBeTruthy();
    expect(body.mode).toBe("advanced");

    await context.close();
  });

  test("edit page renders the image-based authoring flow for special_env problems", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    await page.goto(`/problems/${advancedProblemId}/edit`);
    await expect(page.getByRole("heading", { name: /advanced mode/i })).toBeVisible();
    await expect(page.locator('[data-tour="edit-rail"]')).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: /judge environment images/i }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: /run image/i })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /grade image/i })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const layout = page.getByTestId("advanced-edit-layout");
    await expect(layout).toHaveCSS("flex-direction", "column");
    await expect(layout.locator("aside")).toHaveCSS("position", "static");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);

    await context.close();
  });

  test("teacher viewing the student page sees the Advanced Mode upload UI, not Monaco", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    await page.goto(`/problems/${advancedProblemId}`);
    await expect(page.getByRole("main")).toBeVisible();

    await expect(page.getByText(/advanced mode/i).first()).toBeVisible();

    await expect(page.locator(".monaco-editor")).toHaveCount(0);

    await expect(page.getByText(/upload a zip archive or a single source file/i)).toBeVisible();

    await context.close();
  });

  test("student can start an active advanced-mode exam and submit a zip", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    let released = false;

    try {
      const startResult = await postFormAction(
        page,
        `/exams/${ADVANCED_EXAM_ID}?/startExam`,
        {},
      );
      expect(startResult.type).toBe("success");

      await page.goto(`/exams/${ADVANCED_EXAM_ID}/problems/${SEEDED_ADVANCED_PROBLEM_ID}`);
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByText("Demo: Advanced Mode Exam")).toBeVisible();
      await expect(page.getByText(/advanced mode/i).first()).toBeVisible();
      await expect(page.locator(".monaco-editor")).toHaveCount(0);

      const submitBtn = page.getByRole("button", { name: /^submit$|^繳交$/i });
      await expect(submitBtn).toBeDisabled();

      const zip = await buildSubmissionZip();
      const uploader = page.getByRole("button", {
        name: /drop a \.zip archive or a single source file/i,
      });
      let fileChooser: FileChooser | undefined;
      await expect(async () => {
        const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 1_500 });
        await uploader.click();
        fileChooser = await fileChooserPromise;
      }).toPass({ timeout: 20_000 });
      if (!fileChooser) throw new Error("Advanced uploader did not open a file chooser.");

      await fileChooser.setFiles({
        name: "exam-advanced.zip",
        mimeType: "application/zip",
        buffer: zip,
      });
      await expect(submitBtn).toBeEnabled({ timeout: 20_000 });

      await expect(page.getByText(/extracted 2 files|已解壓 2 個檔案/i)).toBeVisible();

      const responsePromise = page.waitForResponse(
        (r) => r.url().endsWith("/api/submissions") && r.request().method() === "POST",
      );
      await submitBtn.click();
      const response = await responsePromise;
      expect(response.status()).toBe(202);
      const body = await response.json();
      expect(body.submissionId).toBeTruthy();
      expect(body.pollUrl).toContain(body.submissionId);

      const releaseResult = await postFormAction(
        page,
        `/exams/${ADVANCED_EXAM_ID}?/releaseSession`,
        {},
      );
      expect(releaseResult.type).toBe("success");
      released = true;
    } finally {
      if (!released) {
        await postFormAction(page, `/exams/${ADVANCED_EXAM_ID}?/releaseSession`, {}).catch(
          () => undefined,
        );
      }
      await context.close();
    }
  });
});
