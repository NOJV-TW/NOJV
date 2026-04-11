import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SandboxExecutor, SandboxRequest, SandboxResult } from "@nojv/core";

import type { WorkerEnv } from "../env";
import { AdvancedModeExecutor } from "./advanced-mode-executor.js";
import { K8sExecutor } from "./k8s-executor.js";
import { sanitizeId } from "./sandbox-result-mapper.js";
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
      join(tmpdir(), `nojv-judge-${sanitizeId(request.submissionId)}-`)
    );

    try {
      // Advanced-mode submissions skip the sandbox-runner image and
      // spawn the TA-provided judge image directly. See
      // `AdvancedModeExecutor.run` for the `/workspace/` contract.
      if (request.advanced) {
        return await this.advanced.run(tempDir, request, {
          cpuLimit: this.config.cpuLimit,
          pidsLimit: this.config.pidsLimit
        });
      }
      return await runStandardMode(tempDir, request, this.config);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }
}

export function createExecutor(env: WorkerEnv): SandboxExecutor {
  if (env.EXECUTION_BACKEND === "kubernetes") {
    return new K8sExecutor({
      namespace: env.K8S_NAMESPACE,
      image: env.SANDBOX_IMAGE,
      cpuRequest: env.K8S_CPU_REQUEST,
      cpuLimit: env.K8S_CPU_LIMIT,
      memoryRequest: env.K8S_MEMORY_REQUEST,
      memoryLimit: env.K8S_MEMORY_LIMIT
    });
  }
  return new DockerExecutor({
    cpuLimit: env.SANDBOX_CPU_LIMIT,
    image: env.SANDBOX_IMAGE,
    memoryMb: env.SANDBOX_MEMORY_MB,
    pidsLimit: env.SANDBOX_PIDS_LIMIT
  });
}
