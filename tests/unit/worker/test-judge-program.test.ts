import { describe, expect, it, vi } from "vitest";

import {
  PYTHON_INTERACTOR_WRAPPER,
  PYTHON_VALIDATOR_WRAPPER,
  cppStandardHeader,
  testJudgeProgramCacheKey,
} from "@nojv/core";

import { WASM_OJ_LIBCXX_PCH_HEADER } from "../../../apps/worker/node_modules/@wasm-oj/core";
import {
  deserialiseBuildArtifact,
  getJudgeProgram,
  objectStorageJudgeProgramStore,
  serialiseBuildArtifact,
  type BuildArtifact,
  type JudgeProgramStore,
} from "../../../apps/worker/src/test-judge/judge-program";

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
  size: 4,
  toolchains: ["clang@0.2.0"],
  costProfile: "profile",
};

const wasmArtifact: BuildArtifact = {
  ...metadata,
  kind: "wasm",
  language: "cpp",
  bytes: new Uint8Array([0, 97, 115, 109, 255]),
};

const bundleArtifact: BuildArtifact = {
  ...metadata,
  kind: "runtime-bundle",
  language: "python",
  runtimePackage: "python",
  command: "python",
  entry: "main.py",
  files: { "main.py": "print(1)\n", "lib.pyc": new Uint8Array([1, 2, 3, 250]) },
  manifest: "{}",
};

type BuildResult = Awaited<
  ReturnType<Parameters<typeof getJudgeProgram>[0]["engine"]["compile"]>
>;

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

function memoryStore() {
  const objects = new Map<string, string>();
  const store: JudgeProgramStore = {
    get: vi.fn(async (key: string) => objects.get(key) ?? null),
    put: vi.fn(async (key: string, body: string) => {
      if (!objects.has(key)) objects.set(key, body);
    }),
  };
  return { objects, store };
}

function fakeEngine(result: BuildResult) {
  return { compile: vi.fn(async () => result) };
}

const cppChecker = {
  role: "checker" as const,
  language: "cpp" as const,
  source: "int main() { return 42; }\n",
};

describe("test-judge program cache", () => {
  it("stores a fresh build under its content-addressed key and serves the next call from it", async () => {
    const { objects, store } = memoryStore();
    const engine = fakeEngine(buildResult({ artifact: wasmArtifact }));

    const first = await getJudgeProgram({ engine, store }, cppChecker);
    const second = await getJudgeProgram({ engine, store }, cppChecker);

    expect(first).toEqual({ ok: true, artifact: wasmArtifact });
    expect(second).toEqual({ ok: true, artifact: wasmArtifact });
    expect(engine.compile).toHaveBeenCalledTimes(1);
    expect([...objects.keys()]).toEqual([
      `test-judge-programs/${await testJudgeProgramCacheKey(cppChecker)}.json`,
    ]);
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
    expect(JSON.parse([...objects.values()][0]!)).toEqual({
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
    ["checker", PYTHON_VALIDATOR_WRAPPER],
    ["interactor", PYTHON_INTERACTOR_WRAPPER],
  ] as const)("prepends the DOMjudge %s wrapper to Python sources", async (role, wrapper) => {
    const { store } = memoryStore();
    const engine = fakeEngine(buildResult({ artifact: bundleArtifact }));

    await getJudgeProgram(
      { engine, store },
      { role, language: "python", source: "accept()\n" },
    );

    expect(engine.compile).toHaveBeenCalledWith({
      language: "python",
      entry: "main.py",
      files: { "main.py": `${wrapper}accept()\n` },
    });
  });

  it("compiles C++ with the platform bits/stdc++.h shim and the libc++ PCH header", async () => {
    const { store } = memoryStore();
    const engine = fakeEngine(buildResult({ artifact: wasmArtifact }));

    await getJudgeProgram({ engine, store }, cppChecker);

    expect(engine.compile).toHaveBeenCalledWith({
      language: "cpp",
      entry: "main.cpp",
      files: {
        "main.cpp": cppChecker.source,
        "src/bits/stdc++.h": cppStandardHeader(WASM_OJ_LIBCXX_PCH_HEADER),
        "wasm-oj.pch.hpp": WASM_OJ_LIBCXX_PCH_HEADER,
      },
    });
  });

  it("keys checker and interactor builds of the same source apart", async () => {
    const { objects, store } = memoryStore();
    const engine = fakeEngine(buildResult({ artifact: wasmArtifact }));

    await getJudgeProgram({ engine, store }, cppChecker);
    await getJudgeProgram({ engine, store }, { ...cppChecker, role: "interactor" });

    expect(engine.compile).toHaveBeenCalledTimes(2);
    expect(objects.size).toBe(2);
  });
});

describe("build artifact serialisation", () => {
  it.each([
    ["wasm", wasmArtifact],
    ["runtime-bundle", bundleArtifact],
  ] as const)("round-trips a %s artifact through JSON", (_kind, artifact) => {
    const restored = deserialiseBuildArtifact(
      JSON.parse(JSON.stringify(serialiseBuildArtifact(artifact))),
    );

    expect(restored).toEqual(artifact);
  });

  it("keeps runtime-bundle text files as text and encodes byte files", () => {
    const serialised = serialiseBuildArtifact(bundleArtifact);

    expect(serialised.kind === "runtime-bundle" && serialised.files).toEqual({
      "main.py": "print(1)\n",
      "lib.pyc": { base64: Buffer.from([1, 2, 3, 250]).toString("base64") },
    });
  });

  it("restores Wasm bytes as a plain Uint8Array with its own buffer", () => {
    const restored = deserialiseBuildArtifact(serialiseBuildArtifact(wasmArtifact));

    expect(restored.kind === "wasm" && restored.bytes.constructor).toBe(Uint8Array);
    expect(restored.kind === "wasm" && restored.bytes.buffer.byteLength).toBe(5);
  });
});

describe("object-storage judge program store", () => {
  function fakeClient() {
    const objects = new Map<string, Buffer>();
    const send = vi.fn(async (command: { constructor: { name: string }; input: unknown }) => {
      const input = command.input as Record<string, unknown>;
      const key = input.Key as string;
      if (command.constructor.name === "PutObjectCommand") {
        if (input.IfNoneMatch !== "*") throw new Error("missing immutable precondition");
        if (objects.has(key)) {
          const error = new Error("PreconditionFailed");
          error.name = "PreconditionFailed";
          throw error;
        }
        objects.set(key, Buffer.from(input.Body as Buffer));
        return {};
      }
      const body = objects.get(key);
      if (!body) {
        const error = new Error("NoSuchKey");
        error.name = "NoSuchKey";
        throw error;
      }
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

    expect(await store.get("test-judge-programs/missing.json")).toBeNull();
  });

  it("lets a second writer of the same key succeed and keeps the first body", async () => {
    const { client, objects } = fakeClient();
    const store = objectStorageJudgeProgramStore(client);

    await store.put("test-judge-programs/k.json", '{"status":"ok"}');
    await expect(store.put("test-judge-programs/k.json", '{"status":"failed"}')).resolves.toBe(
      undefined,
    );

    expect(objects.get("test-judge-programs/k.json")?.toString("utf8")).toBe('{"status":"ok"}');
    expect(await store.get("test-judge-programs/k.json")).toBe('{"status":"ok"}');
  });
});
