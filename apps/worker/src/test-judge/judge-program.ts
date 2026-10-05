import {
  WASM_OJ_PCH_PATH,
  cppStandardHeader,
  pythonJudgeWrapper,
  testJudgeProgramCacheKey,
  testJudgeProgramObjectKey,
  truncateUtf8,
  type JudgeScriptLanguage,
} from "@nojv/core";
import {
  getText,
  isStorageObjectNotFoundError,
  putObjectIfAbsent,
  type createStorageClient,
} from "@nojv/storage";
import { WASM_OJ_LIBCXX_PCH_HEADER } from "@wasm-oj/core";

import type { TestJudgeEngine } from "./runtime";

type BuildResult = Awaited<ReturnType<TestJudgeEngine["compile"]>>;
type CompileInput = Parameters<TestJudgeEngine["compile"]>[0];
export type BuildArtifact = NonNullable<BuildResult["artifact"]>;
type WasmArtifact = Extract<BuildArtifact, { kind: "wasm" }>;
type RuntimeBundleArtifact = Extract<BuildArtifact, { kind: "runtime-bundle" }>;

interface EncodedBytes {
  base64: string;
}

export type SerialisedBuildArtifact =
  | (Omit<WasmArtifact, "bytes"> & { bytes: EncodedBytes })
  | (Omit<RuntimeBundleArtifact, "files"> & { files: Record<string, string | EncodedBytes> });

type StoredJudgeProgram =
  | { status: "ok"; artifact: SerialisedBuildArtifact }
  | { status: "failed"; diagnostics: string };

export type JudgeProgram =
  { ok: true; artifact: BuildArtifact } | { ok: false; diagnostics: string };

export interface JudgeProgramInput {
  role: "checker" | "interactor";
  language: JudgeScriptLanguage;
  source: string;
}

export interface JudgeProgramStore {
  get(key: string): Promise<string | null>;
  put(key: string, body: string): Promise<void>;
}

const MAX_DIAGNOSTIC_BYTES = 4 * 1024;

function encodeBytes(bytes: Uint8Array): EncodedBytes {
  return { base64: Buffer.from(bytes).toString("base64") };
}

function decodeBytes(encoded: EncodedBytes): Uint8Array {
  return new Uint8Array(Buffer.from(encoded.base64, "base64"));
}

export function serialiseBuildArtifact(artifact: BuildArtifact): SerialisedBuildArtifact {
  if (artifact.kind === "wasm") return { ...artifact, bytes: encodeBytes(artifact.bytes) };
  const files = Object.entries(artifact.files).map(
    ([path, content]): [string, string | EncodedBytes] => [
      path,
      typeof content === "string" ? content : encodeBytes(content),
    ],
  );
  return { ...artifact, files: Object.fromEntries(files) };
}

export function deserialiseBuildArtifact(serialised: SerialisedBuildArtifact): BuildArtifact {
  if (serialised.kind === "wasm") {
    return { ...serialised, bytes: decodeBytes(serialised.bytes) };
  }
  const files = Object.entries(serialised.files).map(
    ([path, content]): [string, string | Uint8Array] => [
      path,
      typeof content === "string" ? content : decodeBytes(content),
    ],
  );
  return { ...serialised, files: Object.fromEntries(files) };
}

function compileInput({ role, language, source }: JudgeProgramInput): CompileInput {
  if (language === "python") {
    return {
      language,
      entry: "main.py",
      files: { "main.py": `${pythonJudgeWrapper(role)}${source}` },
    };
  }
  return {
    language,
    entry: "main.cpp",
    files: {
      "main.cpp": source,
      "src/bits/stdc++.h": cppStandardHeader(WASM_OJ_LIBCXX_PCH_HEADER),
      [WASM_OJ_PCH_PATH]: WASM_OJ_LIBCXX_PCH_HEADER,
    },
  };
}

function buildDiagnostics(build: BuildResult): string {
  const diagnostics = build.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map(
      (diagnostic) =>
        `${diagnostic.file}:${String(diagnostic.line)}:${String(diagnostic.column)}: ${diagnostic.message}`,
    )
    .join("\n");
  return truncateUtf8(
    build.stderr || build.stdout || diagnostics || "Build failed.",
    MAX_DIAGNOSTIC_BYTES,
  );
}

function fromStored(stored: StoredJudgeProgram): JudgeProgram {
  if (stored.status === "failed") return { ok: false, diagnostics: stored.diagnostics };
  return { ok: true, artifact: deserialiseBuildArtifact(stored.artifact) };
}

export async function getJudgeProgram(
  deps: { engine: Pick<TestJudgeEngine, "compile">; store: JudgeProgramStore },
  input: JudgeProgramInput,
): Promise<JudgeProgram> {
  const objectKey = testJudgeProgramObjectKey(await testJudgeProgramCacheKey(input));
  const cached = await deps.store.get(objectKey);
  if (cached !== null) return fromStored(JSON.parse(cached) as StoredJudgeProgram);

  const build = await deps.engine.compile(compileInput(input));
  if (build.success && build.artifact) {
    const stored: StoredJudgeProgram = {
      status: "ok",
      artifact: serialiseBuildArtifact(build.artifact),
    };
    await deps.store.put(objectKey, JSON.stringify(stored));
    return { ok: true, artifact: build.artifact };
  }
  const stored: StoredJudgeProgram = { status: "failed", diagnostics: buildDiagnostics(build) };
  await deps.store.put(objectKey, JSON.stringify(stored));
  return { ok: false, diagnostics: stored.diagnostics };
}

export function objectStorageJudgeProgramStore(
  client: ReturnType<typeof createStorageClient>,
): JudgeProgramStore {
  return {
    async get(key) {
      try {
        return await getText(client, key);
      } catch (reason) {
        if (isStorageObjectNotFoundError(reason)) return null;
        throw reason;
      }
    },
    async put(key, body) {
      await putObjectIfAbsent(client, key, Buffer.from(body, "utf8"), {
        contentType: "application/json",
      });
    },
  };
}
