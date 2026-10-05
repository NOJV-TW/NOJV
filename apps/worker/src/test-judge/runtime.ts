import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { WASM_OJ_SERVER_VERSIONS } from "@nojv/core";
import { createServerEngine, type ServerToolchainSource } from "@wasm-oj/server";

export type TestJudgeEngine = Awaited<ReturnType<typeof createServerEngine>>;

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
  return poolEngines(engines);
}
