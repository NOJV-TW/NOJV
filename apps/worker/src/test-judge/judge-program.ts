import {
  deserialiseBuildArtifact,
  judgeProgramCompileInput,
  serialiseBuildArtifact,
  storedJudgeProgramSchema,
  testJudgeProgramCacheKey,
  testJudgeProgramObjectKey,
  truncateUtf8,
  type JudgeProgramSource,
  type StoredJudgeProgram,
} from "@nojv/core";
import {
  getText,
  isStorageObjectNotFoundError,
  putObjectIfAbsent,
  type createStorageClient,
} from "@nojv/storage";
import { WASM_OJ_LIBCXX_PCH_HEADER, type BuildArtifact, type BuildResult } from "@wasm-oj/core";

import { createLogger } from "../logger.js";
import type { TestJudgeEngine } from "./runtime";

const logger = createLogger("test-judge-program");
const MAX_DIAGNOSTIC_BYTES = 4 * 1024;

export type JudgeProgram =
  { ok: true; artifact: BuildArtifact } | { ok: false; diagnostics: string };

export interface JudgeProgramStore {
  get(key: string): Promise<string | null>;
  put(key: string, body: string): Promise<void>;
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

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function readRecord(body: string): JudgeProgram | null {
  const parsed = storedJudgeProgramSchema.safeParse(parseJson(body));
  if (!parsed.success) return null;
  const record = parsed.data;
  if (record.status === "failed") return { ok: false, diagnostics: record.diagnostics };
  return { ok: true, artifact: deserialiseBuildArtifact(record.artifact) as BuildArtifact };
}

function toRecord(program: JudgeProgram): StoredJudgeProgram {
  return program.ok
    ? { status: "ok", artifact: serialiseBuildArtifact(program.artifact) }
    : { status: "failed", diagnostics: program.diagnostics };
}

export async function getJudgeProgram(
  deps: { engine: Pick<TestJudgeEngine, "compile">; store: JudgeProgramStore },
  source: JudgeProgramSource,
  { throwOnStoreError = false }: { throwOnStoreError?: boolean } = {},
): Promise<JudgeProgram> {
  const objectKey = testJudgeProgramObjectKey(await testJudgeProgramCacheKey(source));
  const cached = await deps.store.get(objectKey);
  if (cached !== null) {
    const program = readRecord(cached);
    if (program) return program;
    logger.warn("Rebuilding a test-judge program whose cached record is unreadable", {
      objectKey,
    });
  }

  const build = await deps.engine.compile(
    judgeProgramCompileInput(source, WASM_OJ_LIBCXX_PCH_HEADER),
  );
  const program: JudgeProgram =
    build.success && build.artifact
      ? { ok: true, artifact: build.artifact }
      : { ok: false, diagnostics: buildDiagnostics(build) };
  try {
    await deps.store.put(objectKey, JSON.stringify(toRecord(program)));
  } catch (error) {
    if (throwOnStoreError) throw error;
    logger.warn("Could not cache a test-judge program build", {
      objectKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return program;
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
