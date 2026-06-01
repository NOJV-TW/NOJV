import { describe, expect, it, vi } from "vitest";

// The worker activity calls `log` from `@temporalio/activity`; outside a
// Temporal worker context that import throws. Stub it to a no-op logger.
vi.mock("@temporalio/activity", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { putSubmissionSources } from "@nojv/storage";
import { plagiarismDomain } from "@nojv/domain";

import { runPlagiarismCheck } from "../../../apps/worker/src/activities/plagiarism";
import {
  createTestCourse,
  createTestProblem,
  createTestSubmission,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

/**
 * Multi-file plagiarism: pre-W2.B, the MOSS pipeline saw a single
 * JSON-stringified blob per submission, which masked semantic similarity
 * behind JSON syntax tokens. W2.B reads files from object storage and
 * concatenates by sorted path with `// === path ===` boundary markers
 * (every Dolos-supported language treats `//` as a line comment), so the
 * tokenizer drops the markers and similarity scoring sees the real code.
 *
 * This integration test plants two C++ submissions whose multi-file source
 * is semantically equivalent — same `solve()` body, renamed variables,
 * different file ordering on the put side — and asserts the resulting
 * pair clears a similarity threshold that the old JSON-stringified shape
 * could not reach.
 */
async function makeAssignment(courseId: string, createdByUserId: string) {
  return testPrisma.courseAssessment.create({
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

describe("plagiarism — multi-file detection (real DB + Dolos)", () => {
  it("detects similarity between semantically equivalent multi-file C++ submissions", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const assignment = await makeAssignment(course.id, teacher.id);
    const problem = await createTestProblem({ authorId: teacher.id });

    const userA = await createTestUser({ platformRole: "student" });
    const userB = await createTestUser({ platformRole: "student" });

    // --- Submission A: main.cpp calls util.cpp::accumulate.
    const subA = await createTestSubmission({
      userId: userA.id,
      problemId: problem.id,
      courseAssessmentId: assignment.id,
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

    // Write multi-file sources directly to (mocked) storage. The factory
    // wrote a single-file placeholder; this overwrites with the real
    // multi-file payload the plagiarism domain query will read back.
    await putSubmissionSources({} as never, subA.id, [
      { path: "main.cpp", content: A_MAIN },
      { path: "util.cpp", content: A_UTIL },
    ]);

    // --- Submission B: same logic, variables renamed (x→a, count→n,
    // total→sum, i→k), files written in reverse order on the put side
    // (the storage helper sorts on read, so this exercises the
    // sorted-merge contract).
    const subB = await createTestSubmission({
      userId: userB.id,
      problemId: problem.id,
      courseAssessmentId: assignment.id,
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

    await putSubmissionSources({} as never, subB.id, [
      // Reverse order on write to confirm sort-on-read is the contract.
      { path: "util.cpp", content: B_UTIL },
      { path: "main.cpp", content: B_MAIN },
    ]);

    // Initialize the report row so updateReportStatus("running") has a
    // target to write to (matches the production flow where the route
    // calls createPlagiarismReport before dispatching the workflow).
    await plagiarismDomain.createPlagiarismReport(
      { type: "courseAssessment", id: assignment.id },
      teacher.id,
    );

    await runPlagiarismCheck(assignment.id, "courseAssessment");

    const report = await plagiarismDomain.findPlagiarismReport({
      type: "courseAssessment",
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
    const users = [pair.userId1, pair.userId2].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(users).toEqual([userA.id, userB.id].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    // Threshold: 70. Semantic equivalence (same logic, variable rename) on
    // cpp typically scores ~85-95 with Dolos. The legacy JSON-stringified
    // shape would score around 10-30 because the JSON syntax tokens
    // dominate the AST. 70 sits comfortably above the failure floor.
    expect(pair.similarity).toBeGreaterThan(70);
  });
});
