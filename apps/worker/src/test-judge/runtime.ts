import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  judgeProgramCompileInput,
  WASM_OJ_SERVER_VERSIONS,
  type JudgeProgramSource,
} from "@nojv/core";
import { WASM_OJ_LIBCXX_PCH_HEADER } from "@wasm-oj/core";
import { createServerEngine, type ServerToolchainSource } from "@wasm-oj/server";

import { createLogger } from "../logger.js";

export type TestJudgeEngine = Awaited<ReturnType<typeof createServerEngine>>;

const logger = createLogger("test-judge-runtime");
const WARM_UP_ATTEMPT_MS = 20_000;
const WARM_UP_ATTEMPTS = 3;
const WARM_UP_PROGRAMS: JudgeProgramSource[] = [
  { role: "checker", language: "python", source: "accept()\n" },
  { role: "checker", language: "cpp", source: "int main() { return 42; }\n" },
];

export interface EngineLease<E> {
  engine: E;
  release(): void;
}

export interface EnginePool<E> {
  acquire(): Promise<EngineLease<E>>;
  dispose(): void;
}

interface ServerToolchainModule {
  serverSource(): ServerToolchainSource;
}

async function importToolchain(
  toolchainDir: string,
  name: "clang" | "python",
): Promise<ServerToolchainModule> {
  const packageDir = join(toolchainDir, "node_modules/@wasm-oj", `toolchain-${name}`);
  const { version } = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")) as {
    version?: unknown;
  };
  const expected = WASM_OJ_SERVER_VERSIONS[name];
  if (version !== expected) {
    throw new Error(
      `@wasm-oj/toolchain-${name} in ${toolchainDir} is ${String(version)}; the worker needs ${expected}.`,
    );
  }
  const entry = join(packageDir, "dist/index.js");
  return (await import(pathToFileURL(entry).href)) as ServerToolchainModule;
}

export async function loadServerToolchains(
  toolchainDir: string,
): Promise<ServerToolchainSource[]> {
  const clang = await importToolchain(toolchainDir, "clang");
  const python = await importToolchain(toolchainDir, "python");
  return [clang.serverSource(), python.serverSource()];
}

export function poolEngines<E extends { dispose(): void }>(
  engines: readonly E[],
): EnginePool<E> {
  const idle = [...engines];
  const waiters: { resolve(lease: EngineLease<E>): void; reject(error: Error): void }[] = [];
  let disposed = false;

  function lease(engine: E): EngineLease<E> {
    let released = false;
    return {
      engine,
      release() {
        if (released) return;
        released = true;
        const next = waiters.shift();
        if (next) next.resolve(lease(engine));
        else idle.push(engine);
      },
    };
  }

  return {
    acquire() {
      if (disposed) return Promise.reject(new Error("Test-judge engine pool is disposed."));
      const engine = idle.shift();
      if (engine) return Promise.resolve(lease(engine));
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const waiter of waiters.splice(0)) {
        waiter.reject(new Error("Test-judge engine pool is disposed."));
      }
      for (const engine of engines) engine.dispose();
    },
  };
}

async function runWarmUpPrograms(
  engine: Pick<TestJudgeEngine, "compile" | "run">,
): Promise<void> {
  for (const program of WARM_UP_PROGRAMS) {
    const build = await engine.compile(
      judgeProgramCompileInput(program, WASM_OJ_LIBCXX_PCH_HEADER),
    );
    if (!build.success || !build.artifact) {
      throw new Error(`The ${program.language} warm-up program did not build: ${build.stderr}`);
    }
    const run = await engine.run(build.artifact, {
      args: ["/judge/input", "/judge/answer", "/judge/feedback"],
      files: { "/judge/input": "", "/judge/answer": "", "/judge/feedback/.keep": "" },
    });
    if (run.code !== 42) {
      throw new Error(
        `The ${program.language} warm-up program ended with ${run.termination} ${String(run.code)}.`,
      );
    }
  }
}

export async function warmEngine(
  engine: Pick<TestJudgeEngine, "compile" | "run" | "cancel">,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Warm-up exceeded ${String(WARM_UP_ATTEMPT_MS)} ms.`)),
        WARM_UP_ATTEMPT_MS,
      );
    });
    try {
      await Promise.race([runWarmUpPrograms(engine), timeout]);
      return;
    } catch (error) {
      engine.cancel();
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= WARM_UP_ATTEMPTS) {
        throw new Error(
          `A test-judge engine failed its warm-up ${String(WARM_UP_ATTEMPTS)} times: ${message}`,
          { cause: error },
        );
      }
      logger.warn("Retrying a test-judge engine warm-up", { attempt, error: message });
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function createEnginePool(options: {
  runtimeDir: string;
  toolchainDir: string;
  cacheDir: string;
  slots: number;
}): Promise<EnginePool<TestJudgeEngine>> {
  const toolchains = await loadServerToolchains(options.toolchainDir);
  const engines: TestJudgeEngine[] = [];
  for (let slot = 0; slot < options.slots; slot += 1) {
    const engine = await createServerEngine({
      runtimeDirectory: options.runtimeDir,
      toolchains,
      cacheDirectory: join(options.cacheDir, String(slot)),
    });
    await engine.ready();
    engines.push(engine);
  }
  try {
    await Promise.all(engines.map((engine) => warmEngine(engine)));
  } catch (error) {
    for (const engine of engines) engine.dispose();
    throw error;
  }
  return poolEngines(engines);
}
