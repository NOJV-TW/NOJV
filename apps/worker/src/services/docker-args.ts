import { dockerLabelArgs } from "./docker-resource";

export interface SandboxDockerArgsParams {
  containerName: string;
  networkArgs: string[];
  tempDir: string;
  cpuLimit: string;
  memoryMb: number;
  pidsLimit: number;
  image: string;
  interactive?: boolean;
  artifactMount?: { hostDir: string; readOnly: boolean };
  extraEnv?: string[];
  labels?: Readonly<Record<string, string>>;
}

export function buildSandboxDockerArgs(params: SandboxDockerArgsParams): string[] {
  const interactiveArgs = params.interactive ? ["-i"] : [];
  const artifactArgs = params.artifactMount
    ? [
        "-v",
        `${params.artifactMount.hostDir}:/artifact:${params.artifactMount.readOnly ? "ro" : "rw"}`,
      ]
    : [];
  const extraEnvArgs = (params.extraEnv ?? []).flatMap((kv) => ["--env", kv]);

  return [
    "run",
    ...interactiveArgs,
    "--rm",
    "--name",
    params.containerName,
    ...dockerLabelArgs(params.labels ?? {}),
    ...params.networkArgs,
    "--user",
    "10001:10001",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,exec,nosuid,nodev,size=64m",
    "--tmpfs",
    "/workspace:rw,exec,nosuid,nodev,size=128m",
    "-v",
    `${params.tempDir}:/submission:ro`,
    ...artifactArgs,
    "--cpus",
    params.cpuLimit,
    "--memory",
    `${String(params.memoryMb)}m`,
    "--memory-swap",
    `${String(params.memoryMb)}m`,
    "--pids-limit",
    String(params.pidsLimit),
    "--env",
    "HOME=/tmp",
    ...extraEnvArgs,
    params.image,
    "node",
    "/runner/index.js",
  ];
}
