import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SandboxExecutor, SandboxRequest, SandboxResult } from "@nojv/core";

import { AdvancedModeExecutor } from "./advanced-mode-executor.js";
import { sanitizeId } from "./docker-process.js";
import { runStandardMode } from "./standard-mode-executor.js";

export interface DockerExecutorConfig {
  cpuLimit: string;
  image: string;
  memoryMb: number;
  pidsLimit: number;
}

export class DockerExecutor implements SandboxExecutor {
  private readonly config: DockerExecutorConfig;
  private readonly advanced = new AdvancedModeExecutor();

  constructor(config: DockerExecutorConfig) {
    this.config = config;
  }

  async execute(request: SandboxRequest): Promise<SandboxResult> {
    const tempDir = await mkdtemp(
      join(tmpdir(), `nojv-judge-${sanitizeId(request.submissionId)}-`),
    );

    try {
      if (request.advanced) {
        return await this.advanced.run(tempDir, request, {
          cpuLimit: this.config.cpuLimit,
          pidsLimit: this.config.pidsLimit,
        });
      }
      return await runStandardMode(tempDir, request, this.config);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }
}
