import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { apiWriteHeaders, formActionHeaders, studentAuth, teacherAuth } from "./_shared";

const courseId = "course_os-lab-spring-2026";
const membersUrl = `/courses/${courseId}/members`;

test("staff can enroll all school username formats and manage pending memberships", async ({
  browser,
}) => {
  const teacher = await browser.newContext({ storageState: teacherAuth });
  const student = await browser.newContext({ storageState: studentAuth });
  const page = await teacher.newPage();
  const handles = ["41247999s", "ntu_b11902998", "ntust_b11215999", `roster_${randomUUID()}`];
  const memberships: string[] = [];
  try {
    await page.goto(membersUrl);
    await expect(
      page.getByRole("button", { name: "Open account menu for Teacher", exact: true }),
    ).toBeEnabled();
    await page.locator("#bulk-handles").fill(handles.join("\n"));
    await page.locator('form[action="?/bulkAdd"] button[type="submit"]').click();
    for (const handle of handles) {
      const row = page.locator("[data-membership-id]").filter({ hasText: handle });
      await expect(row).toContainText("Not yet activated");
      const membershipId = await row.getAttribute("data-membership-id");
      expect(membershipId).toBeTruthy();
      memberships.push(membershipId!);
      await expect(row.locator('a[href^="/users/"]')).toHaveCount(0);
    }
    const row = page.locator("[data-membership-id]").filter({ hasText: handles[3]! });
    const changed = page.waitForRequest((request) => request.url().includes("?/changeRole"));
    await row.locator("select").selectOption("ta");
    const request = await changed;
    expect(request.postData()).toContain('name="membershipId"');
    expect(request.postData()).not.toContain('name="userId"');
    await expect(row.locator("select")).toHaveValue("ta");

    const studentPage = await student.newPage();
    await studentPage.goto(membersUrl);
    for (const handle of handles)
      await expect(studentPage.getByText(handle, { exact: true })).toHaveCount(0);
    const forbidden = await studentPage.request.post(`${membersUrl}?/remove`, {
      form: { membershipId: memberships[0]! },
      headers: formActionHeaders,
    });
    expect((await forbidden.json()).type).toBe("failure");
  } finally {
    for (const membershipId of memberships) {
      await page.request.post(`${membersUrl}?/remove`, {
        form: { membershipId },
        headers: formActionHeaders,
      });
    }
    await teacher.close();
    await student.close();
  }
});

for (const assessment of [
  {
    type: "assignment",
    id: "hw1-process-trace",
    url: "/assignments/hw1-process-trace",
    slot: "assignment-grade-matrix",
  },
  {
    type: "exam",
    id: "exam_midterm-systems-lab",
    url: "/exams/exam_midterm-systems-lab",
    slot: "exam-grade-matrix",
  },
] as const) {
  test(`pending ${assessment.type} student receives manual grades and feedback without participation`, async ({
    browser,
  }) => {
    const teacher = await browser.newContext({ storageState: teacherAuth });
    const student = await browser.newContext({ storageState: studentAuth });
    const page = await teacher.newPage();
    const handle = `grade_${randomUUID()}`;
    let membershipId: string | null = null;
    let overrideId: string | null = null;
    let feedbackId: string | null = null;
    try {
      const added = await page.request.post(`${membersUrl}?/bulkAdd`, {
        form: { handles: handle, role: "student" },
        headers: formActionHeaders,
      });
      expect((await added.json()).type).toBe("success");
      await page.goto(membersUrl);
      const member = page.locator("[data-membership-id]").filter({ hasText: handle });
      await expect(member).toContainText("Not yet activated");
      membershipId = await member.getAttribute("data-membership-id");
      expect(membershipId).toBeTruthy();

      await page.goto(assessment.url);
      await expect(
        page.getByRole("button", { name: "Open account menu for Teacher", exact: true }),
      ).toBeEnabled();
      await page.getByRole("tab", { name: "Results", exact: true }).click();
      const matrix = page.locator(`[data-slot="${assessment.slot}"]`);
      await matrix.getByRole("searchbox").fill(handle);
      const gradeRow = matrix.locator("tbody tr").filter({ hasText: handle });
      await expect(gradeRow).toContainText("Not yet activated");
      await expect(gradeRow.locator("a")).toHaveCount(0);
      await gradeRow.locator("td button").first().click();
      const drawer = page.getByRole("dialog");
      await expect(drawer.locator("#ov-student")).toHaveValue(membershipId!);
      await expect(drawer.locator("#fb-student")).toHaveValue(membershipId!);
      const problemId = await drawer.locator("#ov-problem").inputValue();
      await expect(drawer.locator("#fb-problem")).toHaveValue(problemId);
      await drawer.locator("#ov-score").fill("80");
      await drawer.locator("#ov-reason").fill("Roster manual grade");
      const overrideResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/overrides") && response.request().method() === "POST",
      );
      await drawer.getByRole("button", { name: "Create override", exact: true }).click();
      const override = await overrideResponse;
      expect(override.status()).toBe(201);
      expect(override.request().postDataJSON()).toMatchObject({
        courseMembershipId: membershipId,
        problemId,
      });
      expect(override.request().postDataJSON()).not.toHaveProperty("userId");
      const overrideBody = await override.json();
      expect(overrideBody.userId).toBeNull();
      overrideId = overrideBody.id;

      await drawer.locator("#fb-comment").fill("Roster feedback");
      const feedbackResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/feedback") && response.request().method() === "PUT",
      );
      await drawer.getByRole("button", { name: "Save feedback", exact: true }).click();
      const feedback = await feedbackResponse;
      expect(feedback.status()).toBe(200);
      expect(feedback.request().postDataJSON()).toMatchObject({
        courseMembershipId: membershipId,
        problemId,
      });
      expect(feedback.request().postDataJSON()).not.toHaveProperty("studentUserId");
      feedbackId = (await feedback.json()).id;
      await page.keyboard.press("Escape");
      await expect(gradeRow).toContainText("80");

      await page.goto(`/courses/${courseId}/grades`);
      await expect(
        page.getByRole("button", { name: "Open account menu for Teacher", exact: true }),
      ).toBeEnabled();
      await expect(page.locator("tbody tr").filter({ hasText: handle })).toContainText("80");
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: /export csv/i }).click();
      const downloadPath = await (await downloadPromise).path();
      expect(downloadPath).toBeTruthy();
      const csv = await readFile(downloadPath!, "utf8");
      expect(csv).toContain(handle);
      expect(csv).not.toContain(membershipId!);

      const studentPage = await student.newPage();
      await studentPage.goto(`/courses/${courseId}/grades`);
      await expect(studentPage.getByText(handle, { exact: true })).toHaveCount(0);
      const contextQuery = `type=${assessment.type}&${assessment.type}Id=${assessment.id}`;
      expect((await studentPage.request.get(`/api/feedback?${contextQuery}`)).status()).toBe(
        403,
      );
      expect((await studentPage.request.get(`/api/overrides?${contextQuery}`)).status()).toBe(
        403,
      );
    } finally {
      if (overrideId)
        await page.request.delete(`/api/overrides/${overrideId}`, { headers: apiWriteHeaders });
      if (feedbackId)
        await page.request.delete(`/api/feedback/${feedbackId}`, { headers: apiWriteHeaders });
      if (membershipId)
        await page.request.post(`${membersUrl}?/remove`, {
          form: { membershipId },
          headers: formActionHeaders,
        });
      await teacher.close();
      await student.close();
    }
  });
}
