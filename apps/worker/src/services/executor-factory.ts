import type { WorkerEnv } from "../env";
import { DockerExecutor } from "./docker-executor.js";
import { K8sExecutor } from "./k8s-executor.js";
import type { SandboxExecutor } from "@nojv/sandbox";

export function createExecutor(env: WorkerEnv): SandboxExecutor {
  if (env.EXECUTION_BACKEND === "kubernetes") {
    if (!env.K8S_NAMESPACE)
      throw new Error("K8S_NAMESPACE is required when EXECUTION_BACKEND=kubernetes");
    if (!env.K8S_CPU_REQUEST)
      throw new Error("K8S_CPU_REQUEST is required when EXECUTION_BACKEND=kubernetes");
    if (!env.K8S_CPU_LIMIT)
      throw new Error("K8S_CPU_LIMIT is required when EXECUTION_BACKEND=kubernetes");
    if (!env.K8S_MEMORY_REQUEST)
      throw new Error("K8S_MEMORY_REQUEST is required when EXECUTION_BACKEND=kubernetes");
    if (!env.K8S_MEMORY_LIMIT)
      throw new Error("K8S_MEMORY_LIMIT is required when EXECUTION_BACKEND=kubernetes");
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
