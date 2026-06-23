import type { SandboxExecutor } from "@nojv/core";

import type { WorkerEnv } from "../env";
import { DockerExecutor } from "./docker-executor.js";
import { K8sExecutor } from "./k8s-executor.js";

export function createExecutor(env: WorkerEnv): SandboxExecutor {
  if (env.EXECUTION_BACKEND === "kubernetes") {
    return new K8sExecutor({
      namespace: env.K8S_NAMESPACE,
      image: env.SANDBOX_IMAGE,
      cpuRequest: env.K8S_CPU_REQUEST,
      cpuLimit: env.K8S_CPU_LIMIT,
      memoryRequest: env.K8S_MEMORY_REQUEST,
      memoryLimit: env.K8S_MEMORY_LIMIT,
      headroomMb: env.SANDBOX_MEMORY_HEADROOM_MB,
      maxMemoryMb: env.SANDBOX_MAX_MEMORY_MB,
      egressProxyImage: env.EGRESS_PROXY_IMAGE,
    });
  }
  return new DockerExecutor({
    cpuLimit: env.SANDBOX_CPU_LIMIT,
    image: env.SANDBOX_IMAGE,
    memoryMb: env.SANDBOX_MEMORY_MB,
    pidsLimit: env.SANDBOX_PIDS_LIMIT,
    headroomMb: env.SANDBOX_MEMORY_HEADROOM_MB,
    maxMemoryMb: env.SANDBOX_MAX_MEMORY_MB,
  });
}
