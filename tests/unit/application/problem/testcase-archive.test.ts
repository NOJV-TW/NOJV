import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Storage from "@nojv/storage";

const { blobs, findByProblemId, getVerifiedText, hasStaffAccess, problemFindById } = vi.hoisted(
  () => ({
    blobs: new Map<string, string>(),
    findByProblemId: vi.fn(),
    getVerifiedText: vi.fn(),
    hasStaffAccess: vi.fn(),
    problemFindById: vi.fn(),
  }),
);

vi.mock("@nojv/storage", async (importOriginal) => {
  const original = await importOriginal<typeof Storage>();
  return { ...original, createStorageClient: vi.fn(() => ({})), getVerifiedText };
});

vi.mock("@nojv/db", () => ({
  courseProblemRepo: { hasStaffAccess },
  problemRepo: { findById: problemFindById },
  testcaseSetRepo: { findByProblemId },
}));

import { detectSubtasksFromFiles } from "../../../../apps/web/src/lib/components/features/problem/detect-subtasks";
import { NotFoundError } from "../../../../packages/application/src/shared/errors";
import {
  exportTestcaseArchive,
  testcaseArchiveStem,
} from "../../../../packages/application/src/problem/testcase-archive";

const owner = { userId: "usr_owner", username: "owner", platformRole: "teacher" as const };
const outsider = { userId: "usr_other", username: "other", platformRole: "student" as const };

function pointer(key: string, content: string) {
  blobs.set(key, content);
  return { key, sha256: "a".repeat(64), size: Buffer.byteLength(content) };
}

function testcase(
  id: string,
  ordinal: number,
  input: string,
  output: string | null,
  files?: Record<string, string>,
) {
  return {
    id,
    ordinal,
    inputStorage: pointer(`${id}/input`, input),
    outputStorage: output === null ? null : pointer(`${id}/output`, output),
    inputFileStorage: files
      ? Object.fromEntries(
          Object.entries(files).map(([name, content]) => [
            name,
            pointer(`${id}/files/${name}`, content),
          ]),
        )
      : null,
  };
}

async function readAll(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(body).arrayBuffer());
}

async function unzip(body: ReadableStream<Uint8Array>): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(await readAll(body));
  const entries: Record<string, string> = {};
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) entries[name] = await entry.async("string");
  }
  return entries;
}

beforeEach(() => {
  vi.clearAllMocks();
  blobs.clear();
  getVerifiedText.mockImplementation((_client: unknown, { key }: { key: string }) => {
    const content = blobs.get(key);
    return content === undefined
      ? Promise.reject(new Error(`missing ${key}`))
      : Promise.resolve(content);
  });
  hasStaffAccess.mockResolvedValue(false);
  problemFindById.mockResolvedValue({
    id: "prob_1",
    authorId: owner.userId,
    displayId: 42,
    visibility: "private",
  });
  findByProblemId.mockResolvedValue([]);
});

describe("testcaseArchiveStem", () => {
  it("pads subtask and case numbers to two digits", () => {
    expect(testcaseArchiveStem(1, 1, 3)).toBe("0101");
    expect(testcaseArchiveStem(12, 7, 99)).toBe("1207");
    expect(testcaseArchiveStem(20, 99, 99)).toBe("2099");
  });

  it("widens case padding only for subtasks with at least 100 cases", () => {
    expect(testcaseArchiveStem(2, 5, 100)).toBe("02005");
    expect(testcaseArchiveStem(3, 256, 256)).toBe("03256");
  });
});

describe("exportTestcaseArchive", () => {
  it("writes subtask/case-numbered files that the ZIP uploader defaults read back", async () => {
    findByProblemId.mockResolvedValue([
      {
        id: "set_a",
        ordinal: 0,
        testcases: [testcase("tc_1", 2, "1 2\n", "3\n"), testcase("tc_2", 5, "4 5\n", "9\n")],
      },
      {
        id: "set_b",
        ordinal: 3,
        testcases: [testcase("tc_3", 1, "7\n", "", { "data.txt": "payload\n" })],
      },
    ]);

    const { fileName, body } = await exportTestcaseArchive(owner, "prob_1");
    const entries = await unzip(body);

    expect(fileName).toBe("problem-42-testcases.zip");
    expect(findByProblemId).toHaveBeenCalledWith("prob_1");
    expect(entries).toEqual({
      "0101.in": "1 2\n",
      "0101.out": "3\n",
      "0102.in": "4 5\n",
      "0102.out": "9\n",
      "0201.in": "7\n",
      "0201.out": "",
      "0201.files/data.txt": "payload\n",
    });

    const parsed = detectSubtasksFromFiles(
      Object.entries(entries).map(([name, content]) => ({ name, content })),
      "(\\d\\d)(\\d\\d)",
      ".in",
      ".out",
    );
    expect(parsed.error).toBeUndefined();
    expect(parsed.cases.map(({ input, output }) => ({ input, output }))).toEqual([
      { input: "1 2\n", output: "3\n" },
      { input: "4 5\n", output: "9\n" },
      { input: "7\n", output: "" },
    ]);
    expect(parsed.subtasks.map((subtask) => subtask.caseIndices)).toEqual([[0, 1], [2]]);
  });

  it("omits the output file when a testcase has no expected output", async () => {
    findByProblemId.mockResolvedValue([
      { id: "set_a", ordinal: 0, testcases: [testcase("tc_1", 1, "in\n", null)] },
    ]);

    const { body } = await exportTestcaseArchive(owner, "prob_1");

    expect(await unzip(body)).toEqual({ "0101.in": "in\n" });
  });

  it("names the archive after the problem id while the problem has no display id", async () => {
    problemFindById.mockResolvedValue({
      id: "prob_1",
      authorId: owner.userId,
      displayId: null,
      visibility: "private",
    });

    const { fileName, body } = await exportTestcaseArchive(owner, "prob_1");

    expect(fileName).toBe("problem-prob_1-testcases.zip");
    expect(await unzip(body)).toEqual({});
  });

  it("uses wider case numbers for a subtask with 100 or more cases", async () => {
    const cases = Array.from({ length: 100 }, (_, index) =>
      testcase(`tc_${String(index)}`, index + 1, String(index), null),
    );
    findByProblemId.mockResolvedValue([{ id: "set_a", ordinal: 0, testcases: cases }]);

    const { body } = await exportTestcaseArchive(owner, "prob_1");
    const names = Object.keys(await unzip(body));

    expect(names).toHaveLength(100);
    expect(names[0]).toBe("01001.in");
    expect(names[99]).toBe("01100.in");
  });

  it("lets course staff with content read access download", async () => {
    const staff = { userId: "usr_staff", username: "staff", platformRole: "student" as const };
    hasStaffAccess.mockResolvedValue(true);

    const { body } = await exportTestcaseArchive(staff, "prob_1");
    await readAll(body);

    expect(hasStaffAccess).toHaveBeenCalledWith("prob_1", "usr_staff");
  });

  it.each([
    ["an unrelated user", { id: "prob_1", authorId: owner.userId, visibility: "private" }],
    [
      "a public problem's non-owner",
      { id: "prob_1", authorId: owner.userId, visibility: "public" },
    ],
    ["a missing problem", null],
  ])("hides testcases from %s as not found", async (_label, problem) => {
    problemFindById.mockResolvedValue(problem);
    hasStaffAccess.mockResolvedValue(problem?.visibility === "public");

    await expect(exportTestcaseArchive(outsider, "prob_1")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(findByProblemId).not.toHaveBeenCalled();
    expect(getVerifiedText).not.toHaveBeenCalled();
  });

  it("errors the stream when a testcase object cannot be read", async () => {
    findByProblemId.mockResolvedValue([
      { id: "set_a", ordinal: 0, testcases: [testcase("tc_1", 1, "in\n", "out\n")] },
    ]);
    blobs.delete("tc_1/output");

    const { body } = await exportTestcaseArchive(owner, "prob_1");

    await expect(readAll(body)).rejects.toThrow("missing tc_1/output");
  });

  it("reads storage only as fast as the archive is consumed", async () => {
    const cases = Array.from({ length: 10 }, (_, index) =>
      testcase(
        `tc_${String(index)}`,
        index + 1,
        randomBytes(512 * 1024).toString("latin1"),
        null,
      ),
    );
    findByProblemId.mockResolvedValue([{ id: "set_a", ordinal: 0, testcases: cases }]);

    const { body } = await exportTestcaseArchive(owner, "prob_1");
    await delay(100);

    expect(getVerifiedText.mock.calls.length).toBeLessThan(cases.length);
    expect(Object.keys(await unzip(body))).toHaveLength(cases.length);
    expect(getVerifiedText).toHaveBeenCalledTimes(cases.length);
  });

  it("stops reading storage once the download is cancelled", async () => {
    const cases = Array.from({ length: 20 }, (_, index) =>
      testcase(`tc_${String(index)}`, index + 1, "in\n", "out\n"),
    );
    findByProblemId.mockResolvedValue([{ id: "set_a", ordinal: 0, testcases: cases }]);

    const { body } = await exportTestcaseArchive(owner, "prob_1");
    await body.cancel();
    await delay(50);

    expect(getVerifiedText.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
