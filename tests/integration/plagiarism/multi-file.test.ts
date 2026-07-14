import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

vi.mock("@temporalio/activity", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  createStorageClient,
  planSubmissionSources,
  putSubmissionSourcePlan,
} from "@nojv/storage";
import { plagiarismDomain } from "@nojv/application";

import { runPlagiarismCheck } from "../../../apps/worker/src/activities/plagiarism";
import {
  createTestCourse,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

async function makeAssignment(courseId: string, createdByUserId: string) {
  return testPrisma.assessment.create({
    data: {
      courseId,
      createdByUserId,
      title: "Multi-file plagiarism HW",
      summary: "for tests",
      status: "published",
      opensAt: new Date(Date.now() - 7200_000),
      closesAt: new Date(Date.now() + 3600_000),
    },
  });
}

async function replaceSubmissionSources(
  submissionId: string,
  sources: { path: string; content: string }[],
) {
  const sourceStorage = await putSubmissionSourcePlan(
    createStorageClient(),
    planSubmissionSources(submissionId, randomUUID(), sources),
  );
  await testPrisma.submission.update({
    where: { id: submissionId },
    data: { sourceStorage },
  });
}

describe("plagiarism — multi-file detection (real DB + Dolos)", () => {
  it("detects similarity between semantically equivalent multi-file C++ submissions", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const assignment = await makeAssignment(course.id, teacher.id);
    const problem = await createTestProblem({ authorId: teacher.id });

    const userA = await createTestUser({ platformRole: "student" });
    const userB = await createTestUser({ platformRole: "student" });

    const subA = await createTestSubmission({
      userId: userA.id,
      problemId: problem.id,
      assessmentId: assignment.id,
      courseId: course.id,
      language: "cpp",
      status: "accepted",
      score: 100,
      sourceCode: "// placeholder — multi-file payload below replaces this",
    });

    const A_MAIN = `#include <iostream>
#include "util.cpp"

int main() {
    int x;
    std::cin >> x;
    int count = accumulate(x);
    std::cout << count << std::endl;
    return 0;
}
`;
    const A_UTIL = `int accumulate(int n) {
    int total = 0;
    for (int i = 0; i < n; i++) {
        total += i * i;
        total -= i;
    }
    return total;
}
`;

    await replaceSubmissionSources(subA.id, [
      { path: "main.cpp", content: A_MAIN },
      { path: "util.cpp", content: A_UTIL },
    ]);

    const subB = await createTestSubmission({
      userId: userB.id,
      problemId: problem.id,
      assessmentId: assignment.id,
      courseId: course.id,
      language: "cpp",
      status: "accepted",
      score: 100,
      sourceCode: "// placeholder — multi-file payload below replaces this",
    });

    const B_MAIN = `#include <iostream>
#include "util.cpp"

int main() {
    int a;
    std::cin >> a;
    int n = accumulate(a);
    std::cout << n << std::endl;
    return 0;
}
`;
    const B_UTIL = `int accumulate(int n) {
    int sum = 0;
    for (int k = 0; k < n; k++) {
        sum += k * k;
        sum -= k;
    }
    return sum;
}
`;

    await replaceSubmissionSources(subB.id, [
      { path: "util.cpp", content: B_UTIL },
      { path: "main.cpp", content: B_MAIN },
    ]);

    await plagiarismDomain.createPlagiarismReport(
      { type: "assessment", id: assignment.id },
      teacher.id,
    );

    await runPlagiarismCheck(assignment.id, "assessment");

    const report = await plagiarismDomain.findPlagiarismReport({
      type: "assessment",
      id: assignment.id,
    });
    expect(report).not.toBeNull();
    expect(report!.status).toBe("completed");

    const results = report!.results as {
      pairs: Array<{
        problemId: string;
        userId1: string;
        userId2: string;
        similarity: number;
      }>;
    };
    expect(results.pairs).toHaveLength(1);

    const pair = results.pairs[0]!;
    expect(pair.problemId).toBe(problem.id);
    const users = [pair.userId1, pair.userId2].sort((a, b) => Number(a > b) - Number(a < b));
    expect(users).toEqual([userA.id, userB.id].sort((a, b) => Number(a > b) - Number(a < b)));
    expect(pair.similarity).toBeGreaterThan(70);
  });
});
