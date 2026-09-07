import { test, expect } from "@playwright/test";

import { adminAuth, formActionHeaders, studentAuth, teacherAuth } from "./_shared";

const COURSE_ID = "course_os-lab-spring-2026";

test.describe("Course members + settings", () => {
  test("teacher can open the members management page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}/members`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open account menu for Teacher", exact: true }),
    ).toBeEnabled();
    const table = page.getByRole("table", { name: "Members", exact: true });
    const memberRows = table.locator("tbody tr[data-membership-id]");
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Email", exact: true })).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Joined", exact: true }),
    ).toBeVisible();
    await expect(memberRows.first()).toHaveAttribute("data-membership-id", /.+/);
    const membershipIds = await memberRows.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-membership-id")),
    );
    expect(new Set(membershipIds).size).toBe(membershipIds.length);
    for (const row of await memberRows.all()) {
      await expect(row).toHaveAttribute("data-is-pending", /^(true|false)$/);
      if ((await row.getAttribute("data-is-pending")) === "true") {
        await expect(row).toContainText("Not yet activated");
        await expect(row.locator('a[href^="/users/"]')).toHaveCount(0);
      }
    }

    const roleFilter = table
      .locator("thead")
      .getByRole("button", { name: "Role", exact: true });
    await roleFilter.click();
    await page.getByRole("option", { name: "TAs", exact: true }).click();
    await expect(memberRows).toHaveCount(1);
    await expect(table.locator("tbody select")).toHaveValue("ta");
    await roleFilter.click();
    await page.getByRole("option", { name: "All", exact: true }).click();
    const memberCount = await memberRows.count();
    expect(memberCount).toBeGreaterThan(1);

    const search = table.getByRole("button", { name: "Search handle or name", exact: true });
    await search.click();
    const input = page.getByRole("searchbox", { name: "Search handle or name", exact: true });
    await input.fill("no-matching-member-408");
    await input.press("Enter");
    await expect(table.getByText("No members match your filters.")).toBeVisible();
    await expect(memberRows).toHaveCount(0);
    await expect(roleFilter).toBeVisible();
    await search.click();
    await input.fill("");
    await input.press("Enter");
    await expect(memberRows).toHaveCount(memberCount);

    await page.setViewportSize({ width: 390, height: 844 });
    const emailCell = table.locator("tbody tr").first().locator("td").nth(1);
    await expect(emailCell).toHaveCSS("text-align", "left");
    expect((await emailCell.boundingBox())?.width).toBeGreaterThan(0);
    expect(
      await table.evaluate((element) => {
        const container = element.parentElement!;
        return (
          container.scrollWidth > container.clientWidth &&
          getComputedStyle(container).overflowX === "auto"
        );
      }),
    ).toBe(true);
    await context.close();
  });

  test("admin can open any course members page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}/members`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("members page does not expose manage controls to a student", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}/members`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /handles|帳號/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /add members|新增成員/i })).not.toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Email", exact: true })).toHaveCount(0);
    await expect(page.getByRole("table").locator("thead th")).toHaveCount(3);
    await expect(page.locator('tr[data-is-pending="true"]')).toHaveCount(0);
    await context.close();
  });

  test("bulkAdd action rejects students", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/courses/${COURSE_ID}/members?/bulkAdd`, {
      form: { handles: "ghost-handle", role: "student" },
      headers: formActionHeaders,
    });
    const body = await res.json().catch(() => null);
    if (body) {
      expect(body.type).not.toBe("success");
    } else {
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
    await context.close();
  });

  test("changeRole action rejects students", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/courses/${COURSE_ID}/members?/changeRole`, {
      form: { membershipId: "membership_someone", role: "ta" },
      headers: formActionHeaders,
    });
    const body = await res.json().catch(() => null);
    if (body) {
      expect(body.type).not.toBe("success");
    } else {
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
    await context.close();
  });

  test("teacher can open the settings page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto(`/courses/${COURSE_ID}/settings`);
    await expect(page.getByRole("main")).toBeVisible();
    await context.close();
  });

  test("student cannot reach the settings page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();
    const res = await page.goto(`/courses/${COURSE_ID}/settings`);
    const status = res?.status() ?? 0;
    if (status >= 400) {
      expect(status).toBeGreaterThanOrEqual(400);
    } else {
      expect(page.url()).not.toContain("/settings");
    }
    await context.close();
  });

  test("bulkAdd with empty handles surfaces a validation failure", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    const res = await page.request.post(`/courses/${COURSE_ID}/members?/bulkAdd`, {
      form: { handles: "", role: "student" },
      headers: formActionHeaders,
    });
    const body = await res.json().catch(() => null);
    if (body) {
      expect(["failure", "error"]).toContain(body.type);
    } else {
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
    await context.close();
  });
});
