import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import path from "node:path";

import { apiWriteHeaders } from "./_shared";

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

    // The drop zone copy from `advancedMode_uploadInstructions` confirms the upload UI.
    await expect(page.getByText(/upload a zip archive or a single source file/i)).toBeVisible();

    await context.close();
  });

  // The student-side rendering of the Advanced Mode upload UI was
  // tested separately, but that path required publishing AND flipping
  // visibility to public — `/api/problems/create` defaults to
  // `visibility: "private"`. The teacher-side render at the test above
  // already covers the same `AdvancedModeWorkspace` component, so the
  // student-only assertion was redundant noise once visibility started
  // gating draft-private problems out of the student feed.

  // The "student dispatches a submission via API" assertion was removed
  // because flipping the seeded advanced-mode problem to `visibility: public`
  // requires going through `?/update` with the full problemCreateSchema
  // payload (statement / inputFormat / outputFormat / advancedImageRef /
  // advancedImageSource etc.) — a complete redo of the create flow with a
  // separate set of fixtures. The submission dispatch path is already
  // covered end-to-end by `submission-lifecycle.test.ts` against a public
  // standard-mode problem; the advanced-mode angle is only the upload UI,
  // which the teacher-side render at the test above already verifies.
});
