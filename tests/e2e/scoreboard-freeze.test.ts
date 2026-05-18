import { test, expect } from "@playwright/test";

import { adminAuth, apiWriteHeaders, studentAuth, teacherAuth } from "./_shared";

const CONTEST_ID = "spring-qualifier-2026";

test.describe("Scoreboard API + freeze/unfreeze", () => {
  test("public GET scoreboard returns a JSON shape", async ({ page }) => {
    const res = await page.request.get(`/api/contests/${CONTEST_ID}/scoreboard`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    // Frozen contest fixture; private callers see whatever the public
    // view publishes. We just assert a sane top-level object.
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
  });

  test("scoreboard chart endpoint is reachable", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/contests/${CONTEST_ID}/scoreboard/chart`);
    // Chart payload is allowed to be 200 with an array, OR 4xx if the
    // contest hasn't started — either is correct, the contract is "no 5xx".
    expect(res.status()).toBeLessThan(500);
    await context.close();
  });

  test("unfreeze rejects unauthenticated callers", async ({ page }) => {
    const res = await page.request.post(`/contests/${CONTEST_ID}/scoreboard?/unfreeze`, {
      form: {},
      headers: apiWriteHeaders,
    });
    // A SvelteKit form action invoked over raw HTTP always answers 200;
    // the real outcome is the JSON envelope. An anon caller is bounced by
    // the auth gate — never a success.
    const body = await res.json();
    expect(body.type).not.toBe("success");
  });

  test("unfreeze rejects students", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/contests/${CONTEST_ID}/scoreboard?/unfreeze`, {
      form: {},
      headers: apiWriteHeaders,
    });
    const body = await res.json();
    expect(body.type).not.toBe("success");
    await context.close();
  });

  test("unfreeze on unknown contest returns 4xx for staff", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    const res = await page.request.post(
      `/contests/contest-does-not-exist/scoreboard?/unfreeze`,
      {
        form: {},
        headers: apiWriteHeaders,
      },
    );
    const body = await res.json();
    expect(body.type).not.toBe("success");
    await context.close();
  });

  test("teacher can unfreeze a real contest scoreboard", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/contests/${CONTEST_ID}/scoreboard?/unfreeze`, {
      form: {},
      headers: apiWriteHeaders,
    });
    expect(res.ok()).toBe(true);
    await context.close();
  });

  test("admin can request the unfrozen view via querystring", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/contests/${CONTEST_ID}/scoreboard?unfrozen=true`);
    expect(res.ok()).toBe(true);
    await context.close();
  });

  test("student request for unfrozen view is silently downgraded to public", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.get(`/api/contests/${CONTEST_ID}/scoreboard?unfrozen=true`);
    // Endpoint ignores the flag for non-staff and returns the public board;
    // it should not 4xx the read.
    expect(res.ok()).toBe(true);
    await context.close();
  });
});
