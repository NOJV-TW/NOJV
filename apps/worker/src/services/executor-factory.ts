import type { WorkerEnv } from "../env";
import { DockerExecutor } from "./docker-executor.js";
import { ExecutorOwner } from "./executor-owner.js";
import { K8sExecutor } from "./k8s-executor.js";

export function createExecutorOwner(env: WorkerEnv): ExecutorOwner {
  if (env.EXECUTION_BACKEND === "kubernetes") {
    return new ExecutorOwner(
      new K8sExecutor({
        namespace: env.K8S_NAMESPACE,
        image: env.SANDBOX_IMAGE,
        cpuRequest: env.K8S_CPU_REQUEST,
        cpuLimit: env.K8S_CPU_LIMIT,
        memoryRequest: env.K8S_MEMORY_REQUEST,
        memoryLimit: env.K8S_MEMORY_LIMIT,
        headroomMb: env.SANDBOX_MEMORY_HEADROOM_MB,
        maxMemoryMb: env.SANDBOX_MAX_MEMORY_MB,
        ...(env.K8S_IMAGE_PULL_SECRET
          ? { imagePullSecretName: env.K8S_IMAGE_PULL_SECRET }
          : {}),
      }),
    );
  }
  return new ExecutorOwner(
    new DockerExecutor({
      cpuLimit: env.SANDBOX_CPU_LIMIT,
      image: env.SANDBOX_IMAGE,
      memoryMb: env.SANDBOX_MEMORY_MB,
      pidsLimit: env.SANDBOX_PIDS_LIMIT,
      headroomMb: env.SANDBOX_MEMORY_HEADROOM_MB,
      maxMemoryMb: env.SANDBOX_MAX_MEMORY_MB,
    }),
  );
}
