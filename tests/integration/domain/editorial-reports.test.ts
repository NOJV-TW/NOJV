import { describe, expect, it } from "vitest";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  editorialDomain,
} from "@nojv/application";

import { createTestProblem, createTestUser, testPrisma } from "../../fixtures/factories";

const { reportEditorial, listEditorialReports, resolveEditorialReport } = editorialDomain;

interface ActorOverrides {
  platformRole?: "student" | "teacher" | "admin";
}

async function buildActor(overrides: ActorOverrides = {}) {
  const user = await createTestUser({ platformRole: overrides.platformRole ?? "student" });
  return {
    userId: user.id,
    username: user.username ?? user.id,
    displayName: user.name,
    email: user.email,
    emailVerified: false,
    platformRole: user.platformRole as "student" | "teacher" | "admin",
  };
}

async function createEditorial(authorId: string, problemId: string) {
  return testPrisma.editorial.create({
    data: {
      userId: authorId,
      problemId,
      content: "A sufficiently long editorial body for the test.",
      language: "cpp",
    },
  });
}

describe("editorialDomain.reportEditorial — integration", () => {
  it("creates a report row with a trimmed reason on the happy path", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const problem = await createTestProblem();
    const editorial = await createEditorial(author.userId, problem.id);

    const report = await reportEditorial(reporter, editorial.id, "  spam content  ");

    const persisted = await testPrisma.editorialReport.findUnique({ where: { id: report.id } });
    expect(persisted).not.toBeNull();
    expect(persisted!.reason).toBe("spam content");
    expect(persisted!.status).toBe("open");
    expect(persisted!.reportedByUserId).toBe(reporter.userId);
  });

  it("rejects a second report from the same user via the unique constraint", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const problem = await createTestProblem();
    const editorial = await createEditorial(author.userId, problem.id);

    await reportEditorial(reporter, editorial.id, "first");
    await expect(reportEditorial(reporter, editorial.id, "second")).rejects.toBeInstanceOf(
      ConflictError,
    );

    const all = await testPrisma.editorialReport.findMany({
      where: { editorialId: editorial.id },
    });
    expect(all).toHaveLength(1);
  });

  it("rejects reporting your own editorial", async () => {
    const author = await buildActor();
    const problem = await createTestProblem();
    const editorial = await createEditorial(author.userId, problem.id);

    await expect(reportEditorial(author, editorial.id, "self")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects a report against a soft-deleted editorial", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const problem = await createTestProblem();
    const editorial = await createEditorial(author.userId, problem.id);
    await testPrisma.editorial.update({
      where: { id: editorial.id },
      data: { deletedAt: new Date() },
    });

    await expect(reportEditorial(reporter, editorial.id, "late")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("editorialDomain.listEditorialReports — integration", () => {
  it("returns open reports for an admin", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const admin = await buildActor({ platformRole: "admin" });
    const problem = await createTestProblem();
    const editorial = await createEditorial(author.userId, problem.id);
    const report = await reportEditorial(reporter, editorial.id, "needs review");

    const rows = await listEditorialReports(admin, "open");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(report.id);
  });

  it("throws ForbiddenError for a non-admin", async () => {
    const teacher = await buildActor({ platformRole: "teacher" });
    await expect(listEditorialReports(teacher, "open")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("editorialDomain.resolveEditorialReport — integration", () => {
  it("resolve soft-deletes the editorial and marks the report resolved", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const admin = await buildActor({ platformRole: "admin" });
    const problem = await createTestProblem();
    const editorial = await createEditorial(author.userId, problem.id);
    const report = await reportEditorial(reporter, editorial.id, "plagiarised");

    await resolveEditorialReport(admin, report.id, "resolve");

    const persistedEditorial = await testPrisma.editorial.findUnique({
      where: { id: editorial.id },
    });
    expect(persistedEditorial!.deletedAt).not.toBeNull();

    const persistedReport = await testPrisma.editorialReport.findUnique({
      where: { id: report.id },
    });
    expect(persistedReport!.status).toBe("resolved");
    expect(persistedReport!.resolvedByUserId).toBe(admin.userId);
    expect(persistedReport!.resolvedAt).not.toBeNull();
  });

  it("dismiss leaves the editorial intact and marks the report dismissed", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const admin = await buildActor({ platformRole: "admin" });
    const problem = await createTestProblem();
    const editorial = await createEditorial(author.userId, problem.id);
    const report = await reportEditorial(reporter, editorial.id, "false alarm");

    await resolveEditorialReport(admin, report.id, "dismiss");

    const persistedEditorial = await testPrisma.editorial.findUnique({
      where: { id: editorial.id },
    });
    expect(persistedEditorial!.deletedAt).toBeNull();

    const persistedReport = await testPrisma.editorialReport.findUnique({
      where: { id: report.id },
    });
    expect(persistedReport!.status).toBe("dismissed");
  });

  it("throws NotFoundError for a missing report", async () => {
    const admin = await buildActor({ platformRole: "admin" });
    await expect(
      resolveEditorialReport(admin, "report_does_not_exist", "resolve"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
