import { test, expect } from "@playwright/test";

import { apiWriteHeaders, teacherAuth } from "./_shared";
import { psql } from "./_disposable-user";

test.use({ storageState: teacherAuth });

for (const entry of ["list", "editor"] as const) {
  for (const linked of [false, true]) {
    test(`${linked ? "explains why it cannot delete" : "deletes"} a problem draft from the ${entry}`, async ({
      page,
    }) => {
      const created = await page.request.post("/api/problems", {
        headers: apiWriteHeaders,
        data: {},
      });
      expect(created.ok()).toBe(true);
      const { id } = await created.json();
      await psql(`
        INSERT INTO "Submission" (id, "userId", "problemId", "isReferenceSolution", language, "sourceStorage", status, "updatedAt")
        SELECT '${id}-reference', p."authorId", p.id, true, 'python', s."sourceStorage", 'accepted', NOW()
        FROM "Problem" p CROSS JOIN LATERAL (
          SELECT "sourceStorage" FROM "Submission" WHERE "sourceStorage" IS NOT NULL LIMIT 1
        ) s WHERE p.id = '${id}';
        UPDATE "Problem" SET "referenceSolutionSubmissionId" = '${id}-reference' WHERE id = '${id}';
      `);
      if (linked) {
        await psql(
          `INSERT INTO "AssessmentProblem" (id, "assessmentId", "problemId", ordinal) SELECT '${id}', id, '${id}', ${entry === "list" ? 999 : 1000} FROM "Assessment" LIMIT 1`,
        );
      }
      await page.goto(entry === "list" ? "/problems?tab=mine" : `/problems/${id}/edit`);
      const deleteButton =
        entry === "list"
          ? page
              .locator('[data-slot="card"]')
              .filter({ has: page.locator(`a[href="/problems/${id}/edit"]`) })
              .getByRole("button", { name: "Delete", exact: true })
          : page.getByRole("button", { name: "Delete Problem", exact: true });
      await page.waitForTimeout(3000);
      await deleteButton.click();
      const response = page.waitForResponse(
        (res) => res.request().method() !== "GET" && res.url().includes(id),
      );
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      expect((await response).status()).toBe(linked ? 409 : 204);
      if (linked) {
        await expect(
          page.getByText(
            "This problem is used in a contest, exam, or assignment and cannot be deleted. Remove it from those first.",
            { exact: true },
          ),
        ).toBeVisible();
        expect(await psql(`SELECT count(*) FROM "Problem" WHERE id = '${id}'`)).toBe("1");
        await psql(
          `DELETE FROM "AssessmentProblem" WHERE "problemId" = '${id}'; DELETE FROM "Problem" WHERE id = '${id}'`,
        );
        return;
      }
      await expect(page).toHaveURL(/\/problems\?tab=mine$/);
      await expect(page.locator(`a[href="/problems/${id}/edit"]`)).toHaveCount(0);
      expect(await psql(`SELECT count(*) FROM "Problem" WHERE id = '${id}'`)).toBe("0");
    });
  }
}
