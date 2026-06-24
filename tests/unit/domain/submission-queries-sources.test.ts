import { beforeEach, describe, expect, it, vi } from "vitest";

import { putSubmissionSources } from "../../../packages/storage/src/submission";
import { createInMemoryStorage } from "../_fixtures/storage";

const { storageRef } = vi.hoisted(() => ({
  storageRef: { client: null as unknown as { send: (cmd: unknown) => Promise<unknown> } },
}));

vi.mock("../../../packages/application/src/shared/storage-singleton", () => ({
  storage: () => storageRef.client,
  __setStorageClientForTests: (c: unknown) => {
    storageRef.client = c as typeof storageRef.client;
  },
}));

import { submissionDomain } from "@nojv/application";

const { getSubmissionSources } = submissionDomain;

describe("getSubmissionSources — domain wrapper", () => {
  beforeEach(() => {
    storageRef.client = createInMemoryStorage() as unknown as typeof storageRef.client;
  });

  it("returns [] for a submission with no sources written", async () => {
    const result = await getSubmissionSources("sub_empty");
    expect(result).toEqual([]);
  });

  it("round-trips a single-file submission as [{ path, content }]", async () => {
    await putSubmissionSources(
      storageRef.client as Parameters<typeof putSubmissionSources>[0],
      "sub_single",
      [{ path: "main.py", content: "print('hi')" }],
    );

    const result = await getSubmissionSources("sub_single");
    expect(result).toEqual([{ path: "main.py", content: "print('hi')" }]);
  });

  it("returns multi-file sources sorted by path", async () => {
    await putSubmissionSources(
      storageRef.client as Parameters<typeof putSubmissionSources>[0],
      "sub_multi",
      [
        { path: "main.py", content: "from util import f\nf()" },
        { path: "util.py", content: "def f(): pass" },
        { path: "lib/helpers.py", content: "# nested" },
        { path: "README.md", content: "# hi" },
      ],
    );

    const result = await getSubmissionSources("sub_multi");
    expect(result.map((s) => s.path)).toEqual([
      "lib/helpers.py",
      "main.py",
      "README.md",
      "util.py",
    ]);
  });

  it("scopes by submission id — does not leak across submissions", async () => {
    await putSubmissionSources(
      storageRef.client as Parameters<typeof putSubmissionSources>[0],
      "sub_a",
      [{ path: "main.py", content: "A" }],
    );
    await putSubmissionSources(
      storageRef.client as Parameters<typeof putSubmissionSources>[0],
      "sub_b",
      [{ path: "main.py", content: "B" }],
    );

    const a = await getSubmissionSources("sub_a");
    const b = await getSubmissionSources("sub_b");
    expect(a).toEqual([{ path: "main.py", content: "A" }]);
    expect(b).toEqual([{ path: "main.py", content: "B" }]);
  });
});
