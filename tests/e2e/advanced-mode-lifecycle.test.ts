import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

const ORIGIN = "http://localhost:5173";
const REGISTRY_REF = "ghcr.io/test-org/test-judge:test";

// -----------------------------------------------------------------------------
// Helpers — mirror the `postFormAction` pattern from submission-lifecycle.test.ts.
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

async function buildSubmissionZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "main.sh",
    "#!/bin/sh\n# Minimal advanced-mode submission for E2E — never actually runs.\necho hello\n",
  );
  zip.file("README.md", "# advanced-mode e2e upload\n");
  return zip.generateAsync({ type: "nodebuffer" });
}

// -----------------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------------

let advancedProblemId = "";

test.describe("Advanced Mode Lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  test("teacher creates an Advanced Mode problem via API", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    // The same endpoint the "Create Advanced Mode problem" dropdown item hits
    // from Tabs.svelte (handleCreate("advanced")). Sending the mode through
    // the JSON body keeps the test surface narrow and avoids depending on a
    // fragile click path through the dropdown menu.
    const res = await page.request.post("/api/problems/create", {
      data: { mode: "advanced" },
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

    // Both modes share the same /edit route — the page detects problem.type
    // and renders the advanced sections (BasicInfoTab + ContainerContract +
    // ImageSection) instead of the standard tabbed layout.
    await page.goto(`/problems/${advancedProblemId}/edit`);
    await expect(page.getByRole("heading", { name: /advanced mode/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /judge image/i })).toBeVisible();

    // Save the registry ref through the form action directly — the UI hands
    // off via an `onsave` callback that POSTs the same endpoint, but going
    // through the action keeps the assertion on the server-side contract.
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
    // Registry radio is the default when imageSource === "registry"; the
    // bound input reflects the persisted value.
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

    // Advanced Mode badge from AdvancedModeWorkspace.svelte — two places render
    // it (left-column description + right-column top bar), so `.first()` is
    // the stable assertion.
    await expect(page.getByText(/advanced mode/i).first()).toBeVisible();

    // No Monaco editor — the standard ProblemWorkspace would mount `.monaco-editor`.
    await expect(page.locator(".monaco-editor")).toHaveCount(0);

    // The drop zone copy ("Drop a .zip archive…") confirms the upload UI.
    await expect(
      page.getByText(/drop a .*\.zip.* archive or a single source file/i),
    ).toBeVisible();

    await context.close();
  });

  test("student sees the Advanced Mode upload UI and no code editor", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    await page.goto(`/problems/${advancedProblemId}`);
    await expect(page.getByRole("main")).toBeVisible();

    // No Monaco code editor on an advanced problem.
    await expect(page.locator(".monaco-editor")).toHaveCount(0);

    // Upload dropzone is present — both the copy and the hidden file input.
    await expect(
      page.getByText(/drop a .*\.zip.* archive or a single source file/i),
    ).toBeVisible();
    const fileInput = page.locator(`#advanced-upload-${advancedProblemId}`);
    await expect(fileInput).toHaveCount(1);

    await context.close();
  });

  test("student dispatches a submission via API", async ({ browser }) => {
    // Publish the problem first — draft problems reject submissions.
    const teacherCtx = await browser.newContext({ storageState: teacherAuth });
    const teacherPage = await teacherCtx.newPage();
    const pubResult = await postFormAction(
      teacherPage,
      `/problems/${advancedProblemId}/edit?/publish`,
      {},
    );
    expect(pubResult.type).not.toBe("error");
    await teacherCtx.close();

    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    // POST the submission directly via the API. Playwright's setInputFiles
    // doesn't reliably trigger Svelte 5's compiled onchange handler on
    // hidden file inputs (display:none), so we bypass the file-upload UI
    // and test the submission dispatch contract directly — the same
    // endpoint the AdvancedModeWorkspace component calls on Submit.
    const createRes = await page.request.post("/api/submissions", {
      data: {
        problemId: advancedProblemId,
        language: "python",
        sourceCode: "print('hello')\n",
        sourceFiles: [{ path: "README.md", content: "# advanced-mode e2e upload\n" }],
      },
    });
    if (!createRes.ok()) {
      const errBody = await createRes.text().catch(() => "no body");
      throw new Error(`Submission failed (${String(createRes.status())}): ${errBody}`);
    }
    const dispatchBody = (await createRes.json()) as {
      pollUrl: string;
      status: string;
      submissionId: string;
    };
    expect(dispatchBody.submissionId).toBeTruthy();
    expect(dispatchBody.status).toBe("queued");
    expect(dispatchBody.pollUrl).toBe(`/api/submissions/${dispatchBody.submissionId}`);

    // Poll exactly once to confirm the submission record exists in a valid
    // operation state. We do NOT loop until a verdict — worker-dependent.
    const pollRes = await page.request.get(dispatchBody.pollUrl);
    expect(pollRes.ok()).toBe(true);
    const pollBody = (await pollRes.json()) as { submissionId: string; status: string };
    expect(pollBody.submissionId).toBe(dispatchBody.submissionId);
    expect(["queued", "running"]).toContain(pollBody.status);

    await context.close();
  });
});
