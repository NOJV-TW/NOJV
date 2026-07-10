import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

import { adminAuth, apiWriteHeaders, studentAuth, teacherAuth } from "./_shared";

async function suppressOnboardingTour(page: Page) {
  await page.addInitScript(() => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      if (typeof key === "string" && key.startsWith("nojv:tour:seen:")) return "1";
      return originalGetItem.call(this, key);
    };
  });
}

async function openPostsTab(page: Page, problemId: string, tab: "Editorials" | "Discussions") {
  await suppressOnboardingTour(page);
  await page.goto(`/problems/${problemId}`);
  const tabButton = page.getByRole("tab", { name: tab });
  await expect(async () => {
    await tabButton.click({ timeout: 2000 });
    await expect(tabButton).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
  }).toPass({ timeout: 45000 });
}

const PROBLEM_ID = "problem_warmup-sum";
const DISCUSSION_PROBLEM_ID = "problem_balanced-brackets";

const WARMUP_SUM_PYTHON_AC = `a, b = map(int, input().split())
print(a + b)
`;

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

test.describe("Problem posts — auth + permissions", () => {
  test.setTimeout(120_000);

  test("unauthenticated user cannot list editorial posts", async ({ page }) => {
    const res = await page.request.get(`/api/problems/${PROBLEM_ID}/posts?type=editorial`);
    expect(res.status()).toBe(401);
  });

  test("unauthenticated user cannot create a post", async ({ page }) => {
    const res = await page.request.post(`/api/problems/${PROBLEM_ID}/posts`, {
      data: { type: "discussion", title: "Anonymous", content: "x".repeat(20) },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(401);
  });

  test("student without AC is forbidden from listing editorial posts", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/problems/${PROBLEM_ID}/posts?type=editorial`);
    expect(res.status()).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      message: "Solve this problem first to view editorials.",
    });
    await context.close();
  });

  test("student without AC is forbidden from posting an editorial", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/api/problems/${PROBLEM_ID}/posts`, {
      data: {
        type: "editorial",
        title: "Sneaky editorial",
        content: "Detailed editorial body that meets the 10-char minimum.",
      },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      message: "Solve this problem first to post an editorial.",
    });
    await context.close();
  });

  test("student without AC can list discussion posts", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(
      `/api/problems/${DISCUSSION_PROBLEM_ID}/posts?type=discussion`,
    );
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
    await context.close();
  });

  test("post create rejects content shorter than 10 chars", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/api/problems/${DISCUSSION_PROBLEM_ID}/posts`, {
      data: { type: "discussion", title: "Too short", content: "short" },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(400);
    await context.close();
  });

  test("PATCH on nonexistent post returns 404 for admin", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    const res = await page.request.fetch(`/api/posts/nonexistent-post-xyz`, {
      method: "PATCH",
      data: { content: "Some replacement post body content." },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(404);
    await context.close();
  });

  test("DELETE on nonexistent post returns 404 for admin", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    const res = await page.request.fetch(`/api/posts/nonexistent-post-xyz`, {
      method: "DELETE",
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(404);
    await context.close();
  });

  test("editorials tab shows the AC lock for a student without AC", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await openPostsTab(page, DISCUSSION_PROBLEM_ID, "Editorials");
    await expect(page.getByText("Solve this problem first to view editorials")).toBeVisible({
      timeout: 20000,
    });
    await context.close();
  });

  test("discussions tab loads for a student without AC", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await openPostsTab(page, DISCUSSION_PROBLEM_ID, "Discussions");
    await expect(page.getByRole("button", { name: "New discussion" })).toBeVisible({
      timeout: 20000,
    });
    await expect(
      page.getByText(
        "Please do not spoil the answer or post complete solutions in discussions.",
      ),
    ).toBeVisible();
    await context.close();
  });
});

test.describe("Discussions — in-panel UI happy path", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  const stamp = Date.now();
  const postTitle = `Discussion ${stamp}`;
  let created = false;

  async function openPost(page: Page) {
    await openPostsTab(page, DISCUSSION_PROBLEM_ID, "Discussions");
    const postButton = page.getByRole("button", { name: new RegExp(postTitle) });
    const heading = page.getByRole("heading", { name: postTitle });
    await expect(postButton).toBeVisible({ timeout: 20000 });
    await expect(async () => {
      if (await heading.isVisible()) return;
      await postButton.click({ timeout: 2000 }).catch(() => {});
      await expect(heading).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30000 });
  }

  test("student creates a discussion post inside the panel", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    await openPostsTab(page, DISCUSSION_PROBLEM_ID, "Discussions");
    await page.getByRole("button", { name: "New discussion" }).click();

    await page.getByLabel("Title", { exact: true }).fill(postTitle);
    await page
      .getByLabel("Content", { exact: true })
      .fill(`# Approach ${stamp}\n\nHow do you think about this problem?`);
    await page.getByRole("button", { name: "Publish" }).click();

    await expect(page.getByRole("heading", { name: postTitle })).toBeVisible({
      timeout: 20000,
    });
    created = true;
    await context.close();
  });

  test("post appears in the discussion listing", async ({ browser }) => {
    test.skip(!created, "create step did not produce a post");
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await openPostsTab(page, DISCUSSION_PROBLEM_ID, "Discussions");
    await expect(page.getByRole("button", { name: new RegExp(postTitle) })).toBeVisible({
      timeout: 20000,
    });
    await context.close();
  });

  test("student comments and replies on the post", async ({ browser }) => {
    test.skip(!created, "create step did not produce a post");
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await openPost(page);

    const commentText = `Top-level comment ${stamp}`;
    await expect(page.getByPlaceholder("Write a comment…")).toBeVisible({ timeout: 20000 });
    await page.getByPlaceholder("Write a comment…").fill(commentText);
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByText(commentText)).toBeVisible();

    const replyText = `Nested reply ${stamp}`;
    await page.getByRole("button", { name: "Reply" }).first().click();
    await page.getByPlaceholder("Write a reply…").fill(replyText);
    await page.getByRole("button", { name: "Reply", exact: true }).last().click();
    await expect(page.getByText(replyText)).toBeVisible();
    await context.close();
  });

  test("teacher votes on and reports the post through the dialog", async ({ browser }) => {
    test.skip(!created, "create step did not produce a post");
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await openPost(page);

    await page.getByRole("button", { name: "Upvote" }).click();
    await expect(page.getByRole("button", { name: "Upvote" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("article").getByRole("button", { name: "Report" }).click();
    await page
      .getByPlaceholder("Describe what is wrong with this content…")
      .fill("E2E report exercise");
    await page.getByRole("button", { name: "Submit report" }).click();
    await expect(page.getByText("Report submitted. Thank you.")).toBeVisible();
    await context.close();
  });

  test("student deletes a comment and sees the tombstone", async ({ browser }) => {
    test.skip(!created, "create step did not produce a post");
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await openPost(page);

    const replyText = `Nested reply ${stamp}`;
    await expect(page.getByText(replyText)).toBeVisible({ timeout: 20000 });
    await page
      .getByRole("listitem")
      .filter({ hasText: replyText })
      .last()
      .getByRole("button", { name: "Delete" })
      .click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("This comment has been deleted.")).toBeVisible();
    await context.close();
  });

  test("student deletes the post and lands back on the listing", async ({ browser }) => {
    test.skip(!created, "create step did not produce a post");
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await openPost(page);

    await page.getByRole("article").getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: "New discussion" })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByRole("button", { name: new RegExp(postTitle) })).toHaveCount(0);
    await context.close();
  });
});

test.describe("Editorial posts — happy path (AC required)", () => {
  test.skip(
    process.env.NOJV_E2E_RUN_JUDGE !== "1",
    "set NOJV_E2E_RUN_JUDGE=1 to run AC pipeline",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  let postId = "";
  let acReached = false;

  test("student submits an AC solution to warmup-sum", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    const verdict = await submitAcAndAwait(page.request, PROBLEM_ID);
    expect(
      verdict,
      `judge did not accept the warmup-sum AC solution (final verdict: ${verdict})`,
    ).toBe("accepted");
    acReached = true;
    await context.close();
  });

  test("student with AC can list editorial posts", async ({ browser }) => {
    test.skip(!acReached, "no AC submission landed in the previous step");
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/problems/${PROBLEM_ID}/posts?type=editorial`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
    await context.close();
  });

  test("student with AC can create an editorial post", async ({ browser }) => {
    test.skip(!acReached, "no AC submission landed");
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const stamp = Date.now();
    const res = await page.request.post(`/api/problems/${PROBLEM_ID}/posts`, {
      data: {
        type: "editorial",
        title: `Editorial ${stamp}`,
        content: `# Editorial ${stamp}\n\nRead two integers, print their sum. Trivial warmup.`,
      },
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(typeof body.id).toBe("string");
    postId = body.id;
    await context.close();
  });

  test("created editorial appears in the listing", async ({ browser }) => {
    test.skip(!acReached || !postId, "create step did not produce an id");
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/problems/${PROBLEM_ID}/posts?type=editorial`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.some((e) => e.id === postId)).toBe(true);
    await context.close();
  });

  test("author can update their own editorial via PATCH", async ({ browser }) => {
    test.skip(!acReached || !postId, "no post id to update");
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const updatedContent = `# Updated editorial — revised explanation goes here.`;
    const res = await page.request.fetch(`/api/posts/${postId}`, {
      method: "PATCH",
      data: { content: updatedContent },
      headers: apiWriteHeaders,
    });
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { content: string };
    expect(body.content).toContain("revised explanation");
    await context.close();
  });

  test("a different user is rejected from updating someone else's editorial", async ({
    browser,
  }) => {
    test.skip(!acReached || !postId, "no post id to challenge");
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.fetch(`/api/posts/${postId}`, {
      method: "PATCH",
      data: { content: "Sneaky overwrite by the wrong user." },
      headers: apiWriteHeaders,
    });
    expect([403, 404]).toContain(res.status());
    await context.close();
  });

  test("author can soft-delete their editorial", async ({ browser }) => {
    test.skip(!acReached || !postId, "no post id to delete");
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.fetch(`/api/posts/${postId}`, {
      method: "DELETE",
      headers: apiWriteHeaders,
    });
    expect(res.status()).toBe(204);

    const listRes = await page.request.get(`/api/problems/${PROBLEM_ID}/posts?type=editorial`);
    expect(listRes.ok()).toBe(true);
    const body = (await listRes.json()) as { items: Array<{ id: string }> };
    expect(body.items.some((e) => e.id === postId)).toBe(false);
    await context.close();
  });
});
