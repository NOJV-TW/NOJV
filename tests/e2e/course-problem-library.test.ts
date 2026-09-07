import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test, type Page } from "@playwright/test";
import {
  createStorageClient,
  deleteBlobsByPrefix,
  putImmutableText,
  putSubmissionSources,
} from "@nojv/storage";
import { PLAYWRIGHT_STORAGE_ENVIRONMENT } from "../setup/playwright-environment";
import { PrismaClient } from "../../packages/db/generated/prisma/client";
import { resolveDestructiveTestDatabase } from "../setup/destructive-test-database";
import { formActionHeaders, readLiveSession, studentAuth, teacherAuth } from "./_shared";

const testPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDestructiveTestDatabase("nojv_e2e_test") }),
});
test.afterAll(async () => testPrisma.$disconnect());

async function openPage(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole("button", { name: /Open account menu/ })).toBeEnabled();
}

test("course library authorizes bound staff, shares drafts, forks public imports, reuses and removes through UI", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const teacher = await browser.newContext({ storageState: teacherAuth });
  const student = await browser.newContext({ storageState: studentAuth });
  const teacherPage = await teacher.newPage();
  const page = await student.newPage();
  const teacherId = (await readLiveSession(teacherPage)).user.id;
  const studentId = (await readLiveSession(page)).user.id;
  const studentUser = await testPrisma.user.findUniqueOrThrow({ where: { id: studentId } });
  const id = `library_${randomUUID()}`;
  const libraryUrl = `/courses/${id}/problems`;
  const draftId = `${id}_draft`;
  const historicalId = `${id}_historical`;
  const publicId = `${id}_public`;
  const assignmentId = `${id}_assignment`;
  const examId = `${id}_exam`;
  let forkId: string | undefined;

  try {
    await testPrisma.course.create({
      data: {
        id,
        title: "Course library UI",
        description: "",
        ownerId: teacherId,
        memberships: {
          create: [
            { userId: teacherId, role: "teacher" },
            { userId: studentId, role: "student" },
          ],
        },
      },
    });
    for (const problem of [
      {
        id: draftId,
        title: `${id} private draft`,
        authorId: studentId,
        visibility: "private" as const,
        status: "draft" as const,
      },
      {
        id: historicalId,
        title: `${id} historical draft`,
        authorId: teacherId,
        visibility: "private" as const,
        status: "draft" as const,
      },
      {
        id: publicId,
        title: `${id} public source`,
        authorId: teacherId,
        visibility: "public" as const,
        status: "published" as const,
      },
    ]) {
      await testPrisma.problem.create({
        data: {
          ...problem,
          timeLimitMs: 1000,
          memoryLimitMb: 256,
          statement: {
            create: {
              bodyMarkdown: "Course library fixture",
              inputFormat: "",
              outputFormat: "",
            },
          },
        },
      });
    }
    await testPrisma.courseProblem.create({ data: { courseId: id, problemId: historicalId } });
    const starts = new Date(Date.now() + 86_400_000);
    const ends = new Date(starts.getTime() + 3_600_000);
    await testPrisma.assessment.create({
      data: {
        id: assignmentId,
        courseId: id,
        title: "Library assignment",
        summary: "",
        createdByUserId: teacherId,
        opensAt: starts,
        closesAt: ends,
        totalPoints: 100,
        gradingRevision: 0,
        problems: { create: { problemId: historicalId, ordinal: 1, points: 100 } },
      },
    });
    await testPrisma.exam.create({
      data: {
        id: examId,
        courseId: id,
        title: "Library exam",
        summary: "",
        createdByUserId: teacherId,
        startsAt: starts,
        endsAt: ends,
        totalPoints: 100,
        gradingRevision: 0,
        problems: { create: { problemId: historicalId, ordinal: 1, points: 100 } },
      },
    });

    await openPage(page, `/courses/${id}`);
    await expect(
      page
        .locator('[data-slot="course-tab-bar"]')
        .getByRole("link", { name: "Course library" }),
    ).toHaveCount(0);
    expect((await page.goto(libraryUrl))?.status()).toBe(403);
    const denied = await page.request.post(`${libraryUrl}?/add`, {
      form: { problemIds: draftId },
      headers: formActionHeaders,
    });
    expect(await denied.json()).toMatchObject({ type: "failure", status: 403 });
    expect(
      await testPrisma.courseProblem.count({ where: { courseId: id, problemId: draftId } }),
    ).toBe(0);

    const membership = await testPrisma.courseMembership.findUniqueOrThrow({
      where: { courseId_userId: { courseId: id, userId: studentId } },
    });
    await testPrisma.courseMembership.update({
      where: { id: membership.id },
      data: {
        userId: null,
        pendingUsername: studentUser.username,
        role: "ta",
      },
    });
    expect((await page.goto(libraryUrl))?.status()).toBe(403);
    await expect(
      (
        await page.request.post(`${libraryUrl}?/add`, {
          form: { problemIds: draftId },
          headers: formActionHeaders,
        })
      ).json(),
    ).resolves.toMatchObject({ type: "failure", status: 403 });

    await testPrisma.courseMembership.update({
      where: { id: membership.id },
      data: {
        userId: studentId,
        pendingUsername: null,
        role: "ta",
      },
    });
    await openPage(page, libraryUrl);
    await expect(
      page
        .locator('[data-slot="course-tab-bar"]')
        .getByRole("link", { name: "Course library" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: /Create problem/i })).toHaveCount(0);
    await page.getByRole("button", { name: "Add to course library", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("radio", { name: "Add my private problems" })).toBeChecked();
    await dialog.getByRole("searchbox").fill(draftId);
    await dialog.locator('label:has(input[type="checkbox"])').click();
    await dialog.getByRole("button", { name: "Add selected" }).click();
    const draftRow = page.locator(`[data-problem-id="${draftId}"]`);
    await expect(draftRow).toContainText("Draft");
    await expect(draftRow.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
    expect(
      await testPrisma.courseProblem.count({ where: { courseId: id, problemId: draftId } }),
    ).toBe(1);
    await page.reload();
    await expect(page.getByRole("button", { name: /Open account menu/ })).toBeEnabled();
    await expect(draftRow).toBeVisible();

    await page.getByRole("button", { name: "Add to course library", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "Import public problems" }).check();
    await dialog.getByRole("searchbox").fill(publicId);
    await dialog.locator('label:has(input[type="checkbox"])').click();
    await dialog.getByRole("button", { name: "Add selected" }).click();
    const forkRow = page
      .locator("[data-problem-id]")
      .filter({ hasText: `${id} public source` });
    await expect(forkRow).toBeVisible();
    const importedId = await forkRow.getAttribute("data-problem-id");
    if (!importedId) throw new Error("Imported problem ID is missing.");
    forkId = importedId;
    expect(forkId).not.toBe(publicId);
    expect(await testPrisma.problem.findUnique({ where: { id: forkId } })).toMatchObject({
      authorId: studentId,
      visibility: "private",
      forkedFromProblemId: publicId,
    });
    await expect(forkRow.locator(`a[href="/problems/${publicId}"]`)).toBeVisible();
    await expect(forkRow).toContainText(
      studentUser.name || (studentUser.username ?? studentUser.id),
    );

    for (const kind of ["assignments", "exams"]) {
      await openPage(teacherPage, `/courses/${id}/${kind}/new`);
      await teacherPage.getByRole("button", { name: "Add", exact: true }).click();
      const picker = teacherPage.getByRole("dialog");
      await picker.getByRole("searchbox").fill(draftId);
      await expect(picker.getByRole("checkbox")).toHaveCount(0);
      await teacherPage.keyboard.press("Escape");
    }

    // Publication is an editor responsibility; stage its resulting state for reuse checks.
    await testPrisma.problem.update({ where: { id: forkId }, data: { status: "published" } });
    for (const activity of [
      {
        route: `/assignments/${assignmentId}`,
        slot: "assignment-problems-tab",
      },
      { route: `/exams/${examId}`, slot: "exam-problems-tab" },
    ]) {
      await openPage(teacherPage, activity.route);
      await teacherPage.getByRole("tab", { name: "Problems", exact: true }).click();
      const problems = teacherPage.locator(`[data-slot="${activity.slot}"]`);
      await expect(problems).toContainText(`${id} historical draft`);
      await problems.getByRole("button", { name: "Add", exact: true }).click();
      const picker = teacherPage.getByRole("dialog");
      await picker.getByRole("searchbox").fill(forkId);
      await expect(
        picker.getByRole("heading", { name: "Course library", exact: true }),
      ).toBeVisible();
      await picker.locator('label:has(input[type="checkbox"])').click();
      await picker.getByRole("button", { name: "Add selected" }).click();
      const weights = problems.locator('[data-slot="activity-weights"]');
      await weights.getByRole("spinbutton", { name: "Total points", exact: true }).fill("200");
      await weights.getByRole("button", { name: "Split equally", exact: true }).click();
      await expect(weights.getByRole("status")).toHaveText("Allocated: 100% / 100%");
      const saved = teacherPage.waitForResponse(
        (response) =>
          response.request().method() === "POST" && response.url().includes("/updateProblems"),
      );
      await problems.getByRole("button", { name: "Save", exact: true }).click();
      const saveResponse = await saved;
      expect(saveResponse.ok()).toBe(true);
      const request = saveResponse.request();
      const submitted = await new Response(request.postData(), {
        headers: { "content-type": request.headers()["content-type"]! },
      }).formData();
      expect(JSON.parse(String(submitted.get("payload")))).toEqual({
        totalPoints: 200,
        gradingRevision: 0,
        problems: [
          { problemId: historicalId, points: 100 },
          { problemId: forkId, points: 100 },
        ],
      });
      await expect(problems.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
      await teacherPage.reload();
      await expect(
        teacherPage.getByRole("button", { name: /Open account menu/ }),
      ).toBeEnabled();
      await teacherPage.getByRole("tab", { name: "Problems", exact: true }).click();
      await expect(problems).toContainText(`${id} public source`);
      await expect(problems).toContainText(`${id} historical draft`);
      await expect(
        weights.getByRole("spinbutton", { name: "Total points", exact: true }),
      ).toHaveValue("200");
      for (const title of [`${id} historical draft`, `${id} public source`]) {
        await expect(
          weights.getByRole("spinbutton", { name: `${title} weight`, exact: true }),
        ).toHaveValue("50");
      }
    }
    expect(
      (
        await testPrisma.assessmentProblem.findMany({
          where: { assessmentId: assignmentId },
          orderBy: { ordinal: "asc" },
          select: { problemId: true, points: true },
        })
      ).map(({ problemId, points }) => ({ problemId, points: Number(points) })),
    ).toEqual([
      { problemId: historicalId, points: 100 },
      { problemId: forkId, points: 100 },
    ]);
    expect(
      (
        await testPrisma.examProblem.findMany({
          where: { examId },
          orderBy: { ordinal: "asc" },
          select: { problemId: true, points: true },
        })
      ).map(({ problemId, points }) => ({ problemId, points: Number(points) })),
    ).toEqual([
      { problemId: historicalId, points: 100 },
      { problemId: forkId, points: 100 },
    ]);
    for (const activity of [
      await testPrisma.assessment.findUniqueOrThrow({ where: { id: assignmentId } }),
      await testPrisma.exam.findUniqueOrThrow({ where: { id: examId } }),
    ]) {
      expect(Number(activity.totalPoints)).toBe(200);
      expect(activity.gradingRevision).toBe(1);
    }
    expect(await testPrisma.problem.count({ where: { forkedFromProblemId: publicId } })).toBe(
      1,
    );

    await openPage(page, libraryUrl);
    await expect(
      forkRow.getByRole("button", { name: "Remove from course library" }),
    ).toBeDisabled();
    await expect(forkRow.locator(`a[href="/assignments/${assignmentId}"]`)).toBeVisible();
    await expect(forkRow.locator(`a[href="/exams/${examId}"]`)).toBeVisible();
    await page.getByRole("searchbox").fill("no matching library problem");
    await expect(page.locator("[data-problem-id]")).toHaveCount(0);
    await page.getByRole("searchbox").fill(draftId);
    await draftRow.getByRole("button", { name: "Remove from course library" }).click();
    await expect(draftRow).toHaveCount(0);
    expect(
      await testPrisma.courseProblem.count({ where: { courseId: id, problemId: draftId } }),
    ).toBe(0);
    expect(await testPrisma.problem.findUnique({ where: { id: draftId } })).not.toBeNull();

    await testPrisma.course.update({ where: { id }, data: { archived: true } });
    await openPage(page, libraryUrl);
    await expect(
      page.getByText("This course is archived. Problem content is available to read."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Add to course library" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(page.locator('form[action="?/remove"]')).toHaveCount(0);
    await expect(forkRow.getByRole("link", { name: "Preview", exact: true })).toBeVisible();
    await expect(
      (
        await page.request.post(`${libraryUrl}?/add`, {
          form: { problemIds: draftId },
          headers: formActionHeaders,
        })
      ).json(),
    ).resolves.toMatchObject({ type: "failure", status: 400 });
    await expect(
      (
        await page.request.post(`${libraryUrl}?/remove`, {
          form: { problemId: forkId },
          headers: formActionHeaders,
        })
      ).json(),
    ).resolves.toMatchObject({ type: "failure", status: 400 });
  } finally {
    await testPrisma.course.deleteMany({ where: { id } });
    await testPrisma.problem.deleteMany({
      where: {
        OR: [
          { id: { in: [draftId, historicalId, publicId] } },
          { forkedFromProblemId: publicId },
        ],
      },
    });
    await teacher.close();
    await student.close();
  }
});

test("archived nonowner staff can navigate and copy all editor content while writes stay disabled", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  Object.assign(process.env, PLAYWRIGHT_STORAGE_ENVIRONMENT);
  const storage = createStorageClient();
  const owner = await browser.newContext({ storageState: teacherAuth });
  const reader = await browser.newContext({
    storageState: studentAuth,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const ownerPage = await owner.newPage();
  const page = await reader.newPage();
  const ownerId = (await readLiveSession(ownerPage)).user.id;
  const readerId = (await readLiveSession(page)).user.id;
  const id = `archived_editor_${randomUUID()}`;
  const advancedId = `${id}_advanced`;
  const referenceId = `${id}_reference`;
  const hidden = `${"hidden content beyond the preview limit\n".repeat(8)}END_OF_HIDDEN_FILE`;
  const input = `${"1234567890".repeat(20)}\nEND_OF_INPUT`;
  const output = `${"abcdefghij".repeat(20)}\nEND_OF_OUTPUT`;
  const checker = "# checker contents\nprint('END_OF_CHECKER')";
  const sourceFiles = [
    { path: "main.py", content: "print('REFERENCE_MAIN')" },
    { path: "solution/helper.py", content: "# REFERENCE_HELPER" },
  ];
  const advancedConfig = {
    run: {
      imageRef: `registry.example.com/run@sha256:${"a".repeat(64)}`,
      imageSource: "registry",
    },
    grade: {
      imageRef: `registry.example.com/grade@sha256:${"b".repeat(64)}`,
      imageSource: "registry",
    },
    network: {
      mode: "service",
      service: {
        imageRef: `registry.example.com/service@sha256:${"c".repeat(64)}`,
        imageSource: "registry",
      },
    },
    maxScore: 100,
  };

  async function expectCopied(
    region: ReturnType<Page["locator"]>,
    content: string | Record<string, unknown>,
  ) {
    const copy = region.getByRole("button", { name: "Copy", exact: true });
    await expect(copy).toBeEnabled();
    await copy.click();
    await expect
      .poll(async () => {
        const copied = await page.evaluate<string>("navigator.clipboard.readText()");
        return typeof content === "string" ? copied : JSON.parse(copied);
      })
      .toEqual(content);
  }

  try {
    const [hiddenStorage, inputStorage, outputStorage, checkerStorage, sourceStorage] =
      await Promise.all([
        putImmutableText(storage, `problems/${id}/hidden.py`, hidden),
        putImmutableText(storage, `problems/${id}/input`, input),
        putImmutableText(storage, `problems/${id}/output`, output),
        putImmutableText(storage, `problems/${id}/checker.py`, checker),
        putSubmissionSources(storage, referenceId, "fixture", sourceFiles),
      ]);
    await testPrisma.course.create({
      data: {
        id,
        title: "Archived editor inspection",
        description: "",
        ownerId,
        archived: true,
        memberships: {
          create: [
            { userId: ownerId, role: "teacher" },
            { userId: readerId, role: "ta" },
          ],
        },
      },
    });
    const common = {
      authorId: ownerId,
      visibility: "private" as const,
      status: "draft" as const,
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      statement: {
        create: { bodyMarkdown: "Archived **statement**", inputFormat: "", outputFormat: "" },
      },
      courseLinks: { create: { courseId: id } },
    };
    await testPrisma.problem.create({
      data: {
        ...common,
        id,
        title: "Archived multi-file",
        type: "multi_file",
        tags: ["dp"],
        judgeConfig: {
          type: "checker",
          checkerLanguage: "python",
          runtime: { timeLimitMs: 1000, memoryLimitMb: 256, env: { INSPECTION: "visible" } },
        },
        checkerStorage,
        workspaceFiles: {
          create: {
            language: "python",
            path: "hidden.py",
            visibility: "hidden",
            description: "Hidden workspace fixture",
            contentStorage: hiddenStorage,
          },
        },
        testcaseSets: {
          create: {
            name: "Full hidden cases",
            weight: 0,
            testcases: { create: { ordinal: 1, inputStorage, outputStorage } },
          },
        },
      },
    });
    await testPrisma.submission.create({
      data: {
        id: referenceId,
        userId: ownerId,
        problemId: id,
        language: "python",
        status: "accepted",
        isReferenceSolution: true,
        referenceProblemStorageGeneration: 0,
        sourceStorage,
      },
    });
    await testPrisma.problem.update({
      where: { id },
      data: { referenceSolutionSubmissionId: referenceId },
    });
    await testPrisma.problem.create({
      data: {
        ...common,
        id: advancedId,
        title: "Archived advanced",
        type: "special_env",
        advancedConfig,
        advancedRequiredPaths: ["main.py", "solution/helper.py"],
      },
    });

    await openPage(page, `/problems/${id}/edit`);
    await expect(page.getByRole("note")).toBeVisible();
    await expect(page.locator('input[name="title"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Finish & Publish", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Convert to Advanced Mode", exact: true }),
    ).toHaveCount(0);
    await page.locator("summary").filter({ hasText: "Advanced options" }).click();
    await expect(page.locator("details[open]")).toContainText("dp");
    await expectCopied(
      page.getByRole("region", { name: "Statement", exact: true }),
      "Archived **statement**",
    );

    // Basic output format is intentionally incomplete: inspection must still be reachable.
    for (const section of [
      "Workspace",
      "Testcase Management",
      "Judge Settings",
      "Reference solution",
    ]) {
      const navigation = page.locator("aside").getByRole("button", { name: section });
      await expect(navigation).toBeEnabled();
      await navigation.click();
      await expect(page.locator('input[type="file"], form[method="POST"]')).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Save draft", exact: true }),
      ).toBeDisabled();
      if (section === "Workspace") {
        await page.locator("summary").filter({ hasText: "hidden.py" }).click();
        const file = page.locator("details[open]");
        await expect(file).toContainText("Hidden workspace fixture");
        await expectCopied(file, hidden);
        await expect(page.getByRole("button", { name: /Add file|Delete/ })).toHaveCount(0);
      } else if (section === "Testcase Management") {
        await page.locator("summary").filter({ hasText: "Full hidden cases" }).click();
        await expectCopied(page.getByRole("region", { name: "Input", exact: true }), input);
        await expectCopied(page.getByRole("region", { name: "Output", exact: true }), output);
        await expect(page.getByRole("button", { name: /Edit|Delete|Upload/ })).toHaveCount(0);
      } else if (section === "Judge Settings") {
        await expectCopied(
          page.getByRole("region", { name: "Checker script", exact: true }),
          checker,
        );
        await expect(page.locator('input[name="judgeType"]')).toHaveCount(0);
      } else {
        await expect(
          page.getByRole("button", { name: "Validate reference solution", exact: true }),
        ).toBeDisabled();
        for (const file of sourceFiles) {
          const details = page
            .locator("details")
            .filter({ has: page.locator("summary", { hasText: file.path }) });
          await details.locator("summary").click();
          await expectCopied(details, file.content);
        }
      }
      for (const textbox of await page.getByRole("textbox", { name: "Editor content" }).all()) {
        await expect(textbox).not.toBeEditable();
      }
    }

    await openPage(page, `/problems/${advancedId}/edit`);
    await expectCopied(
      page.getByRole("region", { name: "Judge environment images", exact: true }),
      advancedConfig,
    );
    await expectCopied(
      page.getByRole("region", {
        name: "Required student files (one path per line, optional)",
        exact: true,
      }),
      "main.py\nsolution/helper.py",
    );
    await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
    await expect(page.locator('form[method="POST"], input[type="file"]')).toHaveCount(0);

    // Archiving does not revoke the owner's independent edit permission.
    await openPage(ownerPage, `/problems/${id}/edit`);
    await expect(ownerPage.locator('input[name="title"]')).toBeEditable();
    await ownerPage.locator('input[name="title"]').fill("Owner can still edit");
    await expect(
      ownerPage.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeEnabled();
  } finally {
    await testPrisma.course.deleteMany({ where: { id } });
    await testPrisma.problem.deleteMany({ where: { id: { in: [id, advancedId] } } });
    await deleteBlobsByPrefix(storage, `problems/${id}/`);
    await deleteBlobsByPrefix(storage, `submissions/${referenceId}/`);
    storage.destroy();
    await owner.close();
    await reader.close();
  }
});
