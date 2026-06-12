import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import path from "node:path";

import { apiWriteHeaders } from "./_shared";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

const ORIGIN = "http://localhost:5173";
const REGISTRY_REF = "ghcr.io/test-org/test-judge:test";
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
    headers: { origin: ORIGIN },
  });
  return res.json() as Promise<FormActionResult>;
}

async function buildSubmissionZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("main.sh", "#!/bin/sh\necho hello\n");
  zip.file("README.md", "# advanced-mode e2e upload\n");
  return zip.generateAsync({ type: "nodebuffer" });
}

let advancedProblemId = "";

test.describe("Advanced Mode Lifecycle", () => {
  test.describe.configure({ mode: "serial" });

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

  test("edit page renders the advanced layout for special_env problems and accepts a registry image ref", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    await page.goto(`/problems/${advancedProblemId}/edit`);
    await expect(page.getByRole("heading", { name: /advanced mode/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /judge image/i })).toBeVisible();

    const saveResult = await postFormAction(
      page,
      `/problems/${advancedProblemId}/edit?/updateImage`,
      {
        data: JSON.stringify({
          ref: REGISTRY_REF,
          source: "registry",
          timeLimitMs: 30_000,
          memoryLimitMb: 1_024,
        }),
      },
    );
    expect(saveResult.type).not.toBe("error");
    expect(saveResult.type).not.toBe("failure");

    await context.close();
  });

  test("saved registry ref persists across a reload", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    await page.goto(`/problems/${advancedProblemId}/edit`);
    const refInput = page.locator(`input[placeholder*="ghcr.io"]`);
    await expect(refInput).toBeVisible();
    await expect(refInput).toHaveValue(REGISTRY_REF);

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
      const fileInput = page.locator(`#advanced-upload-${SEEDED_ADVANCED_PROBLEM_ID}`);
      await expect(async () => {
        await fileInput.setInputFiles({
          name: "exam-advanced.zip",
          mimeType: "application/zip",
          buffer: zip,
        });
        await expect(submitBtn).toBeEnabled({ timeout: 1_500 });
      }).toPass({ intervals: [250, 500, 1000, 2000], timeout: 20_000 });

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
