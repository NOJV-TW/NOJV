import { describe, expect, it, vi } from "vitest";

import {
  submissionSourcePrefix,
  submissionSourceKey,
  submissionSourceStagingPrefix,
  submissionSourceStagingKey,
  submissionVerdictDetailKey,
} from "../../../packages/storage/src/keys";
import {
  putSubmissionSources,
  putSubmissionSourcesStaged,
  promoteSubmissionSources,
  getSubmissionSources,
  putVerdictDetail,
  getVerdictDetail,
  deleteSubmissionStaging,
  deleteSubmissionStorage,
} from "../../../packages/storage/src/submission";

describe("submission storage key builders", () => {
  it("submissionSourcePrefix ends with a trailing slash", () => {
    expect(submissionSourcePrefix("sub_abc")).toBe("submissions/sub_abc/sources/");
  });

  it("submissionSourceStagingPrefix ends with a trailing slash", () => {
    expect(submissionSourceStagingPrefix("sub_abc")).toBe(
      "submissions/sub_abc/staging/sources/",
    );
  });

  it("submissionSourceKey joins prefix and relative path", () => {
    expect(submissionSourceKey("sub_abc", "main.cpp")).toBe(
      "submissions/sub_abc/sources/main.cpp",
    );
  });

  it("submissionSourceStagingKey joins prefix and relative path", () => {
    expect(submissionSourceStagingKey("sub_abc", "main.cpp")).toBe(
      "submissions/sub_abc/staging/sources/main.cpp",
    );
  });

  it("submissionSourceKey rejects parent traversal", () => {
    expect(() => submissionSourceKey("sub_abc", "../etc/passwd")).toThrow();
  });

  it("submissionSourceKey rejects dot segments", () => {
    expect(() => submissionSourceKey("sub_abc", "./main.py")).toThrow();
    expect(() => submissionSourceKey("sub_abc", "src/./main.py")).toThrow();
  });

  it("submissionSourceKey rejects absolute paths", () => {
    expect(() => submissionSourceKey("sub_abc", "/abs")).toThrow();
  });

  it("submissionSourceKey rejects empty path", () => {
    expect(() => submissionSourceKey("sub_abc", "")).toThrow();
  });

  it("submissionSourceKey rejects backslash", () => {
    expect(() => submissionSourceKey("sub_abc", String.raw`win\path`)).toThrow();
  });

  it("submissionSourceKey rejects NUL character", () => {
    expect(() => submissionSourceKey("sub_abc", "bad\0name")).toThrow();
  });

  it("submissionSourceKey rejects control characters (e.g. newline)", () => {
    expect(() => submissionSourceKey("sub_abc", "main.py\nfoo")).toThrow();
  });

  it("submissionSourceKey rejects colon characters", () => {
    expect(() => submissionSourceKey("sub_abc", "C:/main.py")).toThrow();
    expect(() => submissionSourceKey("sub_abc", "main:py")).toThrow();
  });

  it("submissionVerdictDetailKey returns the canonical path", () => {
    expect(submissionVerdictDetailKey("sub_abc")).toBe(
      "submissions/sub_abc/verdict-detail.json",
    );
  });
});

function createFakeS3() {
  const store = new Map<string, string>();

  const send = vi.fn(async (command: { constructor: { name: string }; input: unknown }) => {
    const name = command.constructor.name;
    const input = command.input as Record<string, unknown>;

    if (name === "PutObjectCommand") {
      const key = input.Key as string;
      const body = input.Body as Buffer;
      store.set(key, body.toString("utf-8"));
      return {};
    }
    if (name === "GetObjectCommand") {
      const key = input.Key as string;
      if (!store.has(key)) {
        const err = new Error("NoSuchKey");
        (err as Error & { name: string }).name = "NoSuchKey";
        throw err;
      }
      const content = store.get(key) ?? "";
      const body = (async function* () {
        yield Buffer.from(content, "utf-8");
      })();
      return { Body: body };
    }
    if (name === "CopyObjectCommand") {
      const sourceKey = decodeCopySource(input.CopySource as string);
      const targetKey = input.Key as string;
      if (!store.has(sourceKey)) {
        const err = new Error("NoSuchKey");
        (err as Error & { name: string }).name = "NoSuchKey";
        throw err;
      }
      store.set(targetKey, store.get(sourceKey) ?? "");
      return {};
    }
    if (name === "DeleteObjectCommand") {
      store.delete(input.Key as string);
      return {};
    }
    if (name === "ListObjectsV2Command") {
      const prefix = (input.Prefix as string) ?? "";
      const contents = [...store.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort((a, b) => Number(a > b) - Number(a < b))
        .map((key) => ({ Key: key }));
      return { Contents: contents, IsTruncated: false };
    }
    if (name === "DeleteObjectsCommand") {
      const del = input.Delete as { Objects: { Key: string }[] };
      for (const { Key } of del.Objects) {
        store.delete(Key);
      }
      return {};
    }
    throw new Error(`unexpected command ${name}`);
  });

  return { send, store } as unknown as { send: typeof send; store: Map<string, string> };
}

function decodeCopySource(copySource: string): string {
  const slash = copySource.indexOf("/");
  const encodedKey = slash >= 0 ? copySource.slice(slash + 1) : copySource;
  return encodedKey.split("/").map(decodeURIComponent).join("/");
}

describe("submission storage helpers", () => {
  it("putSubmissionSources + getSubmissionSources round-trips and returns sorted paths", async () => {
    const fake = createFakeS3();
    const client = fake as unknown as Parameters<typeof putSubmissionSources>[0];

    await putSubmissionSources(client, "sub_1", [
      { path: "main.cpp", content: "int main() {}" },
      { path: "lib/util.cpp", content: "void util();" },
      { path: "README.md", content: "# hi" },
    ]);

    const result = await getSubmissionSources(client, "sub_1");
    expect(result.map((s) => s.path)).toEqual(["lib/util.cpp", "main.cpp", "README.md"]);
    expect(result.find((s) => s.path === "main.cpp")?.content).toBe("int main() {}");
  });

  it("stages sources, promotes them to final keys, and removes staging keys", async () => {
    const fake = createFakeS3();
    const client = fake as unknown as Parameters<typeof putSubmissionSourcesStaged>[0];

    await putSubmissionSourcesStaged(client, "sub_1", [
      { path: "main.cpp", content: "int main() {}" },
      { path: "lib/util.cpp", content: "void util();" },
    ]);

    expect([...fake.store.keys()].sort((a, b) => Number(a > b) - Number(a < b))).toEqual([
      "submissions/sub_1/staging/sources/lib/util.cpp",
      "submissions/sub_1/staging/sources/main.cpp",
    ]);

    await promoteSubmissionSources(client, "sub_1", [
      { path: "main.cpp", content: "ignored during copy" },
      { path: "lib/util.cpp", content: "ignored during copy" },
    ]);

    expect([...fake.store.keys()].sort((a, b) => Number(a > b) - Number(a < b))).toEqual([
      "submissions/sub_1/sources/lib/util.cpp",
      "submissions/sub_1/sources/main.cpp",
    ]);
    expect(fake.store.get("submissions/sub_1/sources/main.cpp")).toBe("int main() {}");
  });

  it("deleteSubmissionStaging removes only staged source keys", async () => {
    const fake = createFakeS3();
    const client = fake as unknown as Parameters<typeof deleteSubmissionStaging>[0];

    await putSubmissionSourcesStaged(client, "sub_1", [{ path: "main.cpp", content: "x" }]);
    await putSubmissionSources(client, "sub_1", [{ path: "main.cpp", content: "y" }]);

    await deleteSubmissionStaging(client, "sub_1");

    expect([...fake.store.keys()]).toEqual(["submissions/sub_1/sources/main.cpp"]);
    expect(fake.store.get("submissions/sub_1/sources/main.cpp")).toBe("y");
  });

  it("putVerdictDetail + getVerdictDetail round-trips JSON, missing key returns null", async () => {
    const fake = createFakeS3();
    const client = fake as unknown as Parameters<typeof putVerdictDetail>[0];

    expect(await getVerdictDetail(client, "sub_missing")).toBeNull();

    await putVerdictDetail(client, "sub_1", { verdict: "AC", score: 100 });
    const detail = await getVerdictDetail<{ verdict: string; score: number }>(client, "sub_1");
    expect(detail).toEqual({ verdict: "AC", score: 100 });
  });

  it("deleteSubmissionStorage wipes every key under the submission prefix", async () => {
    const fake = createFakeS3();
    const client = fake as unknown as Parameters<typeof deleteSubmissionStorage>[0];

    await putSubmissionSources(client, "sub_1", [
      { path: "main.cpp", content: "x" },
      { path: "lib.cpp", content: "y" },
    ]);
    await putVerdictDetail(client, "sub_1", { ok: true });

    await putSubmissionSources(client, "sub_2", [{ path: "main.cpp", content: "z" }]);

    await deleteSubmissionStorage(client, "sub_1");

    expect([...fake.store.keys()].filter((k) => k.startsWith("submissions/sub_1/"))).toEqual(
      [],
    );
    expect([...fake.store.keys()].some((k) => k.startsWith("submissions/sub_2/"))).toBe(true);
  });
});
