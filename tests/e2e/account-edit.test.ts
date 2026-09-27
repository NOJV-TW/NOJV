import { test, expect } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import path from "node:path";
import { PrismaClient } from "../../packages/db/generated/prisma/client";
import { resolveDestructiveTestDatabase } from "../setup/destructive-test-database";
import { readLiveSession } from "./_shared";

const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDestructiveTestDatabase("nojv_e2e_test") }),
});

test.afterAll(async () => db.$disconnect());

test.describe("profile edit", () => {
  test("success toast appears after renaming name", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    const userId = (await readLiveSession(page)).user.id;
    const { name } = await db.user.findUniqueOrThrow({ where: { id: userId } });

    try {
      await page.goto(`/users/${userId}`);

      const editName = page.locator("#edit-name");
      await expect(async () => {
        await page.getByRole("button", { name: "Edit" }).first().click();
        await expect(editName).toBeVisible({ timeout: 1_500 });
      }).toPass({ timeout: 15_000 });

      await editName.fill(`E2E ${Date.now()}`);
      await page.getByRole("button", { name: "Save" }).first().click();

      await expect(
        page.getByRole("status").filter({ hasText: /Name updated|已更新姓名/ }),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      await db.user.update({ where: { id: userId }, data: { name } });
      await context.close();
    }
  });
});
