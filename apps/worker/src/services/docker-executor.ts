import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_MAX_MEMORY_MB,
  DEFAULT_MEMORY_HEADROOM_MB,
  resolveContainerMemoryMb,
  type SandboxExecutionContext,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult,
} from "@nojv/core";

import { AdvancedModeExecutor } from "./advanced-mode-executor.js";
import { sanitizeId } from "./docker-process.js";
import { runStandardMode } from "./standard-mode-executor.js";

export interface DockerExecutorConfig {
  cpuLimit: string;
  image: string;
  memoryMb: number;
  pidsLimit: number;
  headroomMb?: number;
  maxMemoryMb?: number;
}

export function resolveDockerMemoryMb(
  request: SandboxRequest,
  config: Pick<DockerExecutorConfig, "memoryMb" | "headroomMb" | "maxMemoryMb">,
): number {
  return resolveContainerMemoryMb(request.limits.memoryMb, {
    defaultMemoryMb: config.memoryMb,
    headroomMb: config.headroomMb ?? DEFAULT_MEMORY_HEADROOM_MB,
    maxMemoryMb: config.maxMemoryMb ?? DEFAULT_MAX_MEMORY_MB,
  });
}

export class DockerExecutor implements SandboxExecutor {
  private readonly config: DockerExecutorConfig;
  private readonly advanced = new AdvancedModeExecutor();

  constructor(config: DockerExecutorConfig) {
    this.config = config;
  }

  async execute(
    request: SandboxRequest,
    execution: SandboxExecutionContext,
  ): Promise<SandboxResult> {
    execution.signal.throwIfAborted();
    const tempDir = await mkdtemp(join(tmpdir(), `nojv-judge-${sanitizeId(execution.runId)}-`));

    try {
      execution.signal.throwIfAborted();
      if (request.advanced) {
        return await this.advanced.run(tempDir, request, execution, {
          cpuLimit: this.config.cpuLimit,
          pidsLimit: this.config.pidsLimit,
        });
      }
      return await runStandardMode(tempDir, request, execution, {
        ...this.config,
        memoryMb: resolveDockerMemoryMb(request, this.config),
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }
}
