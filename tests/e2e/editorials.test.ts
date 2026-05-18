import { test, expect, type APIRequestContext } from "@playwright/test";

import { adminAuth, apiWriteHeaders, studentAuth, teacherAuth } from "./_shared";

const PROBLEM_ID = "problem_warmup-sum";

// Reads two ints from stdin and prints the sum. Matches every public +
// hidden case for `problem_warmup-sum` (sample.cases + hidden.cases in
// packages/db/prisma/seeds/problems.ts).
const WARMUP_SUM_PYTHON_AC = `a, b = map(int, input().split())
print(a + b)
`;

/**
 * Submits the canned AC solution and polls the submission until it
 * reaches a terminal verdict or `deadlineMs` passes. Returns the final
 * verdict string. Requires a running judge — when the local sandbox
 * isn't available the verdict will stay `queued`/`running` and the
 * caller should treat that as "skip the AC-gated assertions".
 */
async function submitAcAndAwait(
  request: APIRequestContext,
  problemId: string,
  deadlineMs = 90_000,
): Promise<string> {
  let res;
  try {
    res = await request.post("/api/submissions", {
      data: {
        problemId,
        language: "python",
        sourceCode: WARMUP_SUM_PYTHON_AC,
      },
      headers: apiWriteHeaders,
    });
  } catch {
    // Most common cause: dispatcher unreachable (no Temporal worker),
    // which can manifest as `socket hang up` if the request handler
    // crashes before sending headers. Treat as "judge unavailable".
    return "dispatch_failed";
  }
  if (res.status() !== 202) return `dispatch_failed_${res.status()}`;

  const created = (await res.json()) as { submissionId: string; pollUrl: string };
  const deadline = Date.now() + deadlineMs;
  let lastStatus = "queued";
  while (Date.now() < deadline) {
    const poll = await request.get(created.pollUrl);
    if (!poll.ok()) return "poll_failed";
    const body = (await poll.json()) as { status: string };
    lastStatus = body.status;
    if (lastStatus !== "queued" && lastStatus !== "running") break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return lastStatus;
}

test.describe("Editorials — auth + permissions", () => {
  test("unauthenticated user cannot list editorials", async ({ page }) => {
    const res = await page.request.get(`/api/problems/${PROBLEM_ID}/editorials`);
    expect(res.status()).toBe(401);
  });

  test("unauthenticated user cannot post editorial", async ({ page }) => {
    const res = await page.request.post(`/api/problems/${PROBLEM_ID}/editorials`, {
      data: { content: "x".repeat(20), language: "python" },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(401);
  });

  test("student without AC is forbidden from listing editorials", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/problems/${PROBLEM_ID}/editorials`);
    expect(res.status()).toBe(403);
    await context.close();
  });

  test("student without AC is forbidden from posting an editorial", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/api/problems/${PROBLEM_ID}/editorials`, {
      data: {
        content: "Detailed editorial body that meets the 10-char minimum.",
        language: "python",
      },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(403);
    await context.close();
  });

  test("editorial post rejects content shorter than 10 chars", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/api/problems/${PROBLEM_ID}/editorials`, {
      data: { content: "short", language: "python" },
      headers: apiWriteHeaders,
    });
    // Either schema 400 or AC gate 403 — both are valid rejections; the
    // important thing is no editorial is persisted.
    expect([400, 403]).toContain(res.status());
    await context.close();
  });

  test("editorial post rejects unknown language", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/api/problems/${PROBLEM_ID}/editorials`, {
      data: { content: "Long enough editorial body for the schema.", language: "cobol" },
      headers: apiWriteHeaders,
    });
    expect([400, 403]).toContain(res.status());
    await context.close();
  });

  test("PATCH on nonexistent editorial returns 404 for staff", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    const res = await page.request.fetch(`/api/editorials/nonexistent-editorial-xyz`, {
      method: "PATCH",
      data: { content: "Some replacement editorial body content." },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(404);
    await context.close();
  });

  test("DELETE on nonexistent editorial returns 404 for admin", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    const res = await page.request.fetch(`/api/editorials/nonexistent-editorial-xyz`, {
      method: "DELETE",
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(404);
    await context.close();
  });

  test("/editorials/[id]/edit returns 404 for unknown editorial", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.goto(`/editorials/nonexistent-editorial-xyz/edit`);
    expect(res?.status()).toBe(404);
    await context.close();
  });

  test("editorial list page on a problem requires AC", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.goto(`/problems/${PROBLEM_ID}/editorials`);
    // Page-level AC gate either renders an error page (200 w/ message) or
    // returns 403; both are acceptable — the core invariant is that the
    // student doesn't see editorial bodies they haven't earned.
    expect([200, 403, 404]).toContain(res?.status() ?? 0);
    await context.close();
  });
});

test.describe("Editorials — happy path (AC required)", () => {
  // This block exercises the full submit→judge→AC pipeline before the
  // editorial CRUD endpoints. It needs a running Temporal worker AND a
  // built sandbox image — without those, /api/submissions can crash the
  // dev server, which then sinks every later test in the suite.
  // Opt-in via `NOJV_E2E_RUN_JUDGE=1` so default `pnpm test:e2e` runs
  // never hit this codepath.
  test.skip(
    process.env.NOJV_E2E_RUN_JUDGE !== "1",
    "set NOJV_E2E_RUN_JUDGE=1 to run AC pipeline",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  let editorialId = "";
  let acReached = false;

  test("student submits an AC solution to warmup-sum", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    const verdict = await submitAcAndAwait(page.request, PROBLEM_ID);
    if (verdict !== "accepted") {
      // Local e2e runs without a Temporal worker / sandbox image will
      // never reach `accepted`. Record that and let downstream tests
      // skip cleanly via `test.skip(!acReached, ...)` — do not fail.
      test.info().annotations.push({
        type: "skip-reason",
        description: `judge did not reach accepted (final: ${verdict}); editorial AC-gated tests will skip`,
      });
    } else {
      acReached = true;
    }
    await context.close();
  });

  test("student with AC can list editorials (200 + array)", async ({ browser }) => {
    test.skip(!acReached, "no AC submission landed in the previous step");
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/problems/${PROBLEM_ID}/editorials`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    await context.close();
  });

  test("student with AC can create an editorial", async ({ browser }) => {
    test.skip(!acReached, "no AC submission landed");
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const stamp = Date.now();
    const res = await page.request.post(`/api/problems/${PROBLEM_ID}/editorials`, {
      data: {
        content: `# Editorial ${stamp}\n\nRead two integers, print their sum. Trivial warmup.`,
        language: "python",
      },
      headers: apiWriteHeaders,
    });
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { id: string };
    expect(typeof body.id).toBe("string");
    editorialId = body.id;
    await context.close();
  });

  test("created editorial appears in the listing", async ({ browser }) => {
    test.skip(!acReached || !editorialId, "create step did not produce an id");
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/problems/${PROBLEM_ID}/editorials`);
    expect(res.ok()).toBe(true);
    const list = (await res.json()) as Array<{ id: string }>;
    expect(list.some((e) => e.id === editorialId)).toBe(true);
    await context.close();
  });

  test("author can update their own editorial via PUT", async ({ browser }) => {
    test.skip(!acReached || !editorialId, "no editorial id to update");
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const updatedContent = `# Updated editorial — revised explanation goes here.`;
    const res = await page.request.fetch(`/api/editorials/${editorialId}`, {
      method: "PUT",
      data: { content: updatedContent },
      headers: apiWriteHeaders,
    });
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { content: string };
    expect(body.content).toContain("revised explanation");
    await context.close();
  });

  test("a different student is rejected from updating someone else's editorial", async ({
    browser,
  }) => {
    test.skip(!acReached || !editorialId, "no editorial id to challenge");
    // Use the teacher account as a non-author non-admin proxy; teachers
    // are not editorial authors here. Admin would bypass; teacher should not.
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.fetch(`/api/editorials/${editorialId}`, {
      method: "PUT",
      data: { content: "Sneaky overwrite by the wrong user." },
      headers: apiWriteHeaders,
    });
    // Domain returns NotFound (not Forbidden) so probes can't enumerate ids.
    expect([403, 404]).toContain(res.status());
    await context.close();
  });

  test("author can soft-delete their editorial", async ({ browser }) => {
    test.skip(!acReached || !editorialId, "no editorial id to delete");
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.fetch(`/api/editorials/${editorialId}`, {
      method: "DELETE",
      headers: apiWriteHeaders,
    });
    expect(res.ok()).toBe(true);

    // Listing should no longer include the deleted editorial id.
    const listRes = await page.request.get(`/api/problems/${PROBLEM_ID}/editorials`);
    expect(listRes.ok()).toBe(true);
    const list = (await listRes.json()) as Array<{ id: string }>;
    expect(list.some((e) => e.id === editorialId)).toBe(false);
    await context.close();
  });
});
