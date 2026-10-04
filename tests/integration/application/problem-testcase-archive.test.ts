import { randomUUID } from "node:crypto";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { NotFoundError, problemDomain } from "@nojv/application";
import {
  createStorageClient,
  putImmutableText,
  testcaseInputFileKey,
  testcaseInputKey,
  testcaseOutputKey,
} from "@nojv/storage";

import { detectSubtasksFromFiles } from "../../../apps/web/src/lib/components/features/problem/detect-subtasks";
import {
  createTestCourse,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

interface SeedCase {
  ordinal: number;
  input: string;
  output: string | null;
  files?: Record<string, string>;
}

function actorFor(user: { id: string; username: string | null; platformRole: string }) {
  return {
    userId: user.id,
    username: user.username ?? user.id,
    platformRole: user.platformRole as "student" | "teacher" | "admin",
  };
}

async function seedSet(problemId: string, ordinal: number, cases: SeedCase[]) {
  const storage = createStorageClient();
  const set = await testPrisma.testcaseSet.create({
    data: { problemId, name: `subtask #${String(ordinal + 1)}`, weight: 10, ordinal },
  });
  for (const tc of cases) {
    const id = randomUUID();
    const version = randomUUID();
    const inputStorage = await putImmutableText(
      storage,
      testcaseInputKey(problemId, id, version),
      tc.input,
    );
    const outputStorage =
      tc.output === null
        ? null
        : await putImmutableText(storage, testcaseOutputKey(problemId, id, version), tc.output);
    const inputFileStorage = tc.files
      ? Object.fromEntries(
          await Promise.all(
            Object.entries(tc.files).map(
              async ([name, content]) =>
                [
                  name,
                  await putImmutableText(
                    storage,
                    testcaseInputFileKey(problemId, id, version, name),
                    content,
                  ),
                ] as const,
            ),
          ),
        )
      : undefined;
    await testPrisma.testcase.create({
      data: {
        id,
        testcaseSetId: set.id,
        ordinal: tc.ordinal,
        inputStorage,
        ...(outputStorage ? { outputStorage } : {}),
        ...(inputFileStorage ? { inputFileStorage } : {}),
      },
    });
  }
}

async function seedProblem() {
  const owner = await createTestUser({ platformRole: "teacher" });
  const problem = await createTestProblem({ authorId: owner.id, visibility: "private" });
  await testPrisma.testcase.deleteMany({ where: { testcaseSet: { problemId: problem.id } } });
  await testPrisma.testcaseSet.deleteMany({ where: { problemId: problem.id } });
  await seedSet(problem.id, 1, [
    { ordinal: 1, input: "100\n", output: null, files: { "grid.txt": "#.#\n" } },
  ]);
  await seedSet(problem.id, 0, [
    { ordinal: 3, input: "1 2\n", output: "3\n" },
    { ordinal: 7, input: "10 20\n", output: "30\n" },
  ]);
  return { owner, problem };
}

async function unzip(body: ReadableStream<Uint8Array>): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(Buffer.from(await new Response(body).arrayBuffer()));
  const entries: Record<string, string> = {};
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) entries[name] = await entry.async("string");
  }
  return entries;
}

describe("exportTestcaseArchive (real Postgres, mocked storage)", () => {
  it("archives every subtask in ordinal order with uploader-compatible names", async () => {
    const { owner, problem } = await seedProblem();

    const { fileName, body } = await problemDomain.exportTestcaseArchive(
      actorFor(owner),
      problem.id,
    );
    const entries = await unzip(body);

    expect(fileName).toBe(`problem-${String(problem.displayId)}-testcases.zip`);
    expect(entries).toEqual({
      "0101.in": "1 2\n",
      "0101.out": "3\n",
      "0102.in": "10 20\n",
      "0102.out": "30\n",
      "0201.in": "100\n",
      "0201.files/grid.txt": "#.#\n",
    });

    const parsed = detectSubtasksFromFiles(
      Object.entries(entries).map(([name, content]) => ({ name, content })),
      "(\\d\\d)(\\d\\d)",
      ".in",
      ".out",
    );
    expect(parsed.cases.map(({ input }) => input)).toEqual(["1 2\n", "10 20\n", "100\n"]);
    expect(parsed.subtasks.map((subtask) => subtask.caseIndices)).toEqual([[0, 1], [2]]);
  });

  it("lets staff of an archived course that shares the problem download", async () => {
    const { owner, problem } = await seedProblem();
    const staff = await createTestUser();
    const course = await createTestCourse({ ownerId: owner.id, archived: true });
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: staff.id, role: "ta" },
    });
    await testPrisma.courseProblem.create({
      data: { courseId: course.id, problemId: problem.id, addedByUserId: owner.id },
    });

    const { body } = await problemDomain.exportTestcaseArchive(actorFor(staff), problem.id);

    expect(Object.keys(await unzip(body))).toContain("0201.in");
  });

  it("hides the testcases from a user without content read access", async () => {
    const { problem } = await seedProblem();
    const outsider = await createTestUser();

    await expect(
      problemDomain.exportTestcaseArchive(actorFor(outsider), problem.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
