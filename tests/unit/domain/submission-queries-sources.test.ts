import { beforeEach, describe, expect, it, vi } from "vitest";

import { putSubmissionSources } from "../../../packages/storage/src/submission";
import { createInMemoryStorage } from "../_fixtures/storage";

const { findById, storageRef } = vi.hoisted(() => ({
  findById: vi.fn(),
  storageRef: { client: null as unknown as { send: (cmd: unknown) => Promise<unknown> } },
}));

vi.mock("@nojv/db", () => ({
  assessmentRepo: {},
  problemRepo: {},
  submissionRepo: { findById },
  submissionRejudgeLogRepo: {},
}));

vi.mock("../../../packages/application/src/shared/storage-singleton", () => ({
  storage: () => storageRef.client,
  __setStorageClientForTests: (c: unknown) => {
    storageRef.client = c as typeof storageRef.client;
  },
}));

import { getSubmissionSources } from "../../../packages/application/src/submission/queries";

describe("getSubmissionSources — domain wrapper", () => {
  beforeEach(() => {
    storageRef.client = createInMemoryStorage() as unknown as typeof storageRef.client;
  });

  it("returns [] for a submission with no sources written", async () => {
    const pointer = await putSubmissionSources(
      storageRef.client as Parameters<typeof putSubmissionSources>[0],
      "sub_empty",
      "gen_empty",
      [],
    );
    findById.mockResolvedValue({ sourceStorage: pointer });
    const result = await getSubmissionSources("sub_empty");
    expect(result).toEqual([]);
  });

  it("round-trips a single-file submission as [{ path, content }]", async () => {
    const pointer = await putSubmissionSources(
      storageRef.client as Parameters<typeof putSubmissionSources>[0],
      "sub_single",
      "gen_single",
      [{ path: "main.py", content: "print('hi')" }],
    );
    findById.mockResolvedValue({ sourceStorage: pointer });

    const result = await getSubmissionSources("sub_single");
    expect(result).toEqual([{ path: "main.py", content: "print('hi')" }]);
  });

  it("returns multi-file sources sorted by path", async () => {
    const pointer = await putSubmissionSources(
      storageRef.client as Parameters<typeof putSubmissionSources>[0],
      "sub_multi",
      "gen_multi",
      [
        { path: "main.py", content: "from util import f\nf()" },
        { path: "util.py", content: "def f(): pass" },
        { path: "lib/helpers.py", content: "# nested" },
        { path: "README.md", content: "# hi" },
      ],
    );
    findById.mockResolvedValue({ sourceStorage: pointer });

    const result = await getSubmissionSources("sub_multi");
    expect(result.map((s) => s.path)).toEqual([
      "lib/helpers.py",
      "main.py",
      "README.md",
      "util.py",
    ]);
  });

  it("scopes by submission id — does not leak across submissions", async () => {
    const aPointer = await putSubmissionSources(
      storageRef.client as Parameters<typeof putSubmissionSources>[0],
      "sub_a",
      "gen_a",
      [{ path: "main.py", content: "A" }],
    );
    const bPointer = await putSubmissionSources(
      storageRef.client as Parameters<typeof putSubmissionSources>[0],
      "sub_b",
      "gen_b",
      [{ path: "main.py", content: "B" }],
    );

    findById.mockImplementation(async (id: string) => ({
      sourceStorage: id === "sub_a" ? aPointer : bPointer,
    }));
    const a = await getSubmissionSources("sub_a");
    const b = await getSubmissionSources("sub_b");
    expect(a).toEqual([{ path: "main.py", content: "A" }]);
    expect(b).toEqual([{ path: "main.py", content: "B" }]);
  });
});
