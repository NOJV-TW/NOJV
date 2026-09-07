import { expect, test } from "@playwright/test";
import { adminAuth, teacherAuth } from "./_shared";

test("member role menu restores its value after a rejected change", async ({ browser }) => {
  const context = await browser.newContext({ storageState: teacherAuth });
  const page = await context.newPage();
  let requests = 0;
  await page.route(
    (url) => url.search === "?/changeRole",
    async (route) => {
      requests++;
      expect(route.request().postData()).toContain('name="role"\r\n\r\nta');
      await route.fulfill({ status: 500, body: "Rejected test change" });
    },
  );
  await page.goto("/courses/course_os-lab-spring-2026/members");
  await expect(
    page.getByRole("button", { name: "Open account menu for Teacher", exact: true }),
  ).toBeEnabled();
  const role = page.getByRole("button", { name: "Change role for Student", exact: true });
  await expect(role).toHaveText("Student");
  await role.click();
  await page.getByRole("option", { name: "Teaching Assistant", exact: true }).click();
  await expect(role).toBeEnabled();
  await expect(role).toHaveText("Student");
  expect(requests).toBe(1);
  await expect(page.locator("table select")).toHaveCount(0);
  await context.close();
});

test("admin row menus preserve confirmation cancellation and failed-action resets", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: adminAuth });
  const page = await context.newPage();
  const requests: string[] = [];
  await page.route(
    (url) => ["?/updateRole", "?/updateAdvancedCreation"].includes(url.search),
    async (route) => {
      const action = new URL(route.request().url()).search;
      requests.push(action);
      const form = new URLSearchParams(route.request().postData() ?? "");
      expect(form.get(action === "?/updateRole" ? "role" : "allowed")).toBe(
        action === "?/updateRole" ? "student" : "false",
      );
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          type: "failure",
          status: 400,
          data: '[{"error":1},"Rejected test change"]',
        }),
      });
    },
  );
  await page.goto("/admin/users");
  await expect(page.getByRole("button", { name: /Open account menu for/ })).toBeEnabled();
  const role = page.getByRole("button", { name: "Role: teacher", exact: true });
  await role.click();
  await page.getByRole("option", { name: "Admin", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Change role", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(role).toHaveText("Teacher");
  await expect(role).toBeEnabled();
  expect(requests).toHaveLength(0);

  await role.click();
  await page.getByRole("option", { name: "Student", exact: true }).click();
  await expect(role).toHaveText("Teacher");
  await expect(role).toBeEnabled();
  expect(requests).toEqual(["?/updateRole"]);

  const advanced = page.getByRole("button", { name: "Advanced access: teacher", exact: true });
  await advanced.click();
  await page.getByRole("option", { name: "Not allowed", exact: true }).click();
  await expect(advanced).toHaveText("Allowed");
  await expect(advanced).toBeEnabled();
  expect(requests).toEqual(["?/updateRole", "?/updateAdvancedCreation"]);
  await expect(page.locator("table select")).toHaveCount(0);
  await context.close();
});
