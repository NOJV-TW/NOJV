import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  judgeProgramCompileInput,
  testJudgeProgramCacheKey,
  type JudgeProgramSource,
} from "@nojv/core";

import {
  getJudgeProgram,
  objectStorageJudgeProgramStore,
  type JudgeProgram,
  type JudgeProgramStore,
} from "../../../apps/worker/src/test-judge/judge-program";
import type { TestJudgeEngine } from "../../../apps/worker/src/test-judge/runtime";

type BuildArtifact = Extract<JudgeProgram, { ok: true }>["artifact"];
type BuildResult = Awaited<ReturnType<TestJudgeEngine["compile"]>>;
type CompileInput = Parameters<TestJudgeEngine["compile"]>[0];

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../../apps/worker/src/logger.js", () => ({ createLogger: () => logger }));

const metadata = {
  wasmOjContract: 2 as const,
  id: "artifact-1",
  projectId: "sdk:main",
  cacheKey: "cache-key",
  name: "main",
  target: "wasip1" as const,
  optimization: "release" as const,
  createdAt: 1,
  durationMs: 2,
  toolchains: ["clang@0.2.0"],
  costProfile: "profile",
};

const wasmArtifact: BuildArtifact = {
  ...metadata,
  kind: "wasm",
  language: "cpp",
  size: 5,
  bytes: new Uint8Array([0, 97, 115, 109, 255]),
};

const bundleArtifact: BuildArtifact = {
  ...metadata,
  kind: "runtime-bundle",
  language: "python",
  size: 13,
  runtimePackage: "python",
  command: "python",
  entry: "main.py",
  files: { "main.py": "print(1)\n", "lib.pyc": new Uint8Array([1, 2, 3, 250]) },
  manifest: "{}",
};

function buildResult(overrides: Partial<BuildResult>): BuildResult {
  return {
    success: true,
    diagnostics: [],
    stdout: "",
    stderr: "",
    cacheHit: false,
    ...overrides,
  };
}

function memoryStore(initial: Record<string, string> = {}) {
  const objects = new Map(Object.entries(initial));
  const store: JudgeProgramStore = {
    get: vi.fn(async (key: string) => objects.get(key) ?? null),
    put: vi.fn(async (key: string, body: string) => {
      if (!objects.has(key)) objects.set(key, body);
    }),
  };
  return { objects, store };
}

function fakeEngine(result: BuildResult) {
  return { compile: vi.fn(async (_input: CompileInput) => result) };
}

const cppChecker: JudgeProgramSource = {
  role: "checker",
  language: "cpp",
  source: "int main() { return 42; }\n",
};

async function objectKey(program: JudgeProgramSource): Promise<string> {
  return `test-judge-programs/v1/${await testJudgeProgramCacheKey(program)}.json`;
}

beforeEach(() => {
  logger.warn.mockClear();
});

describe("test-judge program cache", () => {
  it.each([
    ["wasm", cppChecker, wasmArtifact],
    [
      "runtime-bundle",
      { role: "checker", language: "python", source: "accept()\n" },
      bundleArtifact,
    ],
  ] as const)(
    "stores a fresh %s build and serves the next call from the stored record",
    async (_kind, program, artifact) => {
      const { objects, store } = memoryStore();
      const engine = fakeEngine(buildResult({ artifact }));

      const first = await getJudgeProgram({ engine, store }, program);
      const second = await getJudgeProgram({ engine, store }, program);

      expect(first).toEqual({ ok: true, artifact });
      expect(second).toEqual({ ok: true, artifact });
      expect(engine.compile).toHaveBeenCalledTimes(1);
      expect([...objects.keys()]).toEqual([await objectKey(program)]);
    },
  );

  it("compiles exactly the shared compile input with the toolchain's libc++ PCH header", async () => {
    const { store } = memoryStore();
    const engine = fakeEngine(buildResult({ artifact: wasmArtifact }));
    const program = { ...cppChecker, source: "#include <bits/stdc++.h>\nint main() {}\n" };

    await getJudgeProgram({ engine, store }, program);

    const input = engine.compile.mock.calls[0]?.[0];
    const pchHeader = input?.files["wasm-oj.pch.hpp"] ?? "";
    expect(pchHeader).toMatch(/^#pragma once\n#include <algorithm>\n/);
    expect(input).toEqual(judgeProgramCompileInput(program, pchHeader));
  });

  it("caches a failed build and returns its diagnostics without recompiling", async () => {
    const { objects, store } = memoryStore();
    const engine = fakeEngine(
      buildResult({ success: false, stderr: "main.cpp:1:1: error: expected ';'" }),
    );

    const first = await getJudgeProgram({ engine, store }, cppChecker);
    const second = await getJudgeProgram({ engine, store }, cppChecker);

    expect(first).toEqual({ ok: false, diagnostics: "main.cpp:1:1: error: expected ';'" });
    expect(second).toEqual(first);
    expect(engine.compile).toHaveBeenCalledTimes(1);
    expect(JSON.parse(objects.get(await objectKey(cppChecker))!)).toEqual({
      status: "failed",
      diagnostics: "main.cpp:1:1: error: expected ';'",
    });
  });

  it("formats error diagnostics when the compiler printed nothing", async () => {
    const { store } = memoryStore();
    const engine = fakeEngine(
      buildResult({
        success: false,
        diagnostics: [
          {
            severity: "warning",
            message: "unused variable",
            file: "main.cpp",
            line: 1,
            column: 1,
            source: "clang",
          },
          {
            severity: "error",
            message: "expected ';'",
            file: "main.cpp",
            line: 3,
            column: 7,
            source: "clang",
          },
        ],
      }),
    );

    expect(await getJudgeProgram({ engine, store }, cppChecker)).toEqual({
      ok: false,
      diagnostics: "main.cpp:3:7: expected ';'",
    });
  });

  it("caps stored diagnostics at 4 KiB", async () => {
    const { store } = memoryStore();
    const engine = fakeEngine(buildResult({ success: false, stderr: "é".repeat(4096) }));

    const result = await getJudgeProgram({ engine, store }, cppChecker);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(new TextEncoder().encode(result.diagnostics).byteLength).toBe(4096);
    }
  });

  it("does not cache an engine failure", async () => {
    const { objects, store } = memoryStore();
    const engine = { compile: vi.fn(async () => Promise.reject(new Error("runtime crashed"))) };

    await expect(getJudgeProgram({ engine, store }, cppChecker)).rejects.toThrow(
      "runtime crashed",
    );
    expect(objects.size).toBe(0);
  });

  it.each([
    "not json",
    JSON.stringify({ status: "ok" }),
    JSON.stringify({ status: "ok", artifact: { kind: "wasm", bytes: { base64: "%%" } } }),
    JSON.stringify({ status: "unknown" }),
  ])("rebuilds over an unreadable record and warns: %s", async (record) => {
    const { store } = memoryStore({ [await objectKey(cppChecker)]: record });
    const engine = fakeEngine(buildResult({ artifact: wasmArtifact }));

    expect(await getJudgeProgram({ engine, store }, cppChecker)).toEqual({
      ok: true,
      artifact: wasmArtifact,
    });
    expect(engine.compile).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Rebuilding a test-judge program whose cached record is unreadable",
      { objectKey: await objectKey(cppChecker) },
    );
  });

  it("returns the build and warns when the record cannot be stored", async () => {
    const { store } = memoryStore();
    vi.mocked(store.put).mockRejectedValueOnce(new Error("bucket unavailable"));
    const engine = fakeEngine(buildResult({ artifact: wasmArtifact }));

    expect(await getJudgeProgram({ engine, store }, cppChecker)).toEqual({
      ok: true,
      artifact: wasmArtifact,
    });
    expect(logger.warn).toHaveBeenCalledWith("Could not cache a test-judge program build", {
      objectKey: await objectKey(cppChecker),
      error: "bucket unavailable",
    });
  });

  it("throws a store failure when the caller needs the record cached", async () => {
    const { store } = memoryStore();
    vi.mocked(store.put).mockRejectedValueOnce(new Error("bucket unavailable"));
    const engine = fakeEngine(buildResult({ artifact: wasmArtifact }));

    await expect(
      getJudgeProgram({ engine, store }, cppChecker, { throwOnStoreError: true }),
    ).rejects.toThrow("bucket unavailable");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("propagates a storage read failure without compiling", async () => {
    const { store } = memoryStore();
    vi.mocked(store.get).mockRejectedValueOnce(new Error("bucket unavailable"));
    const engine = fakeEngine(buildResult({ artifact: wasmArtifact }));

    await expect(getJudgeProgram({ engine, store }, cppChecker)).rejects.toThrow(
      "bucket unavailable",
    );
    expect(engine.compile).not.toHaveBeenCalled();
  });
});

describe("object-storage judge program store", () => {
  function storageError(name: string, httpStatusCode: number): Error {
    return Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });
  }

  function fakeClient(getError?: Error) {
    const objects = new Map<string, Buffer>();
    const send = vi.fn(async (command: { constructor: { name: string }; input: unknown }) => {
      const input = command.input as Record<string, unknown>;
      const key = input.Key as string;
      if (command.constructor.name === "PutObjectCommand") {
        if (input.IfNoneMatch !== "*") throw new Error("missing immutable precondition");
        if (objects.has(key)) throw storageError("PreconditionFailed", 412);
        objects.set(key, Buffer.from(input.Body as Buffer));
        return {};
      }
      if (getError) throw getError;
      const body = objects.get(key);
      if (!body) throw storageError("NoSuchKey", 404);
      return {
        Body: (async function* () {
          yield body;
        })(),
      };
    });
    return { client: { send } as never, objects };
  }

  it("reads a missing object as a cache miss", async () => {
    const store = objectStorageJudgeProgramStore(fakeClient().client);

    expect(await store.get("test-judge-programs/v1/missing.json")).toBeNull();
  });

  it("propagates a read failure other than not-found", async () => {
    const store = objectStorageJudgeProgramStore(
      fakeClient(storageError("AccessDenied", 403)).client,
    );

    await expect(store.get("test-judge-programs/v1/k.json")).rejects.toMatchObject({
      name: "AccessDenied",
    });
  });

  it("lets a second writer of the same key succeed and keeps the first body", async () => {
    const { client, objects } = fakeClient();
    const store = objectStorageJudgeProgramStore(client);

    await store.put("test-judge-programs/v1/k.json", '{"status":"ok"}');
    await expect(
      store.put("test-judge-programs/v1/k.json", '{"status":"failed"}'),
    ).resolves.toBeUndefined();

    expect(objects.get("test-judge-programs/v1/k.json")?.toString("utf8")).toBe(
      '{"status":"ok"}',
    );
    expect(await store.get("test-judge-programs/v1/k.json")).toBe('{"status":"ok"}');
  });
});
