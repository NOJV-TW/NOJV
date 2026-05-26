import { spawn, spawnSync } from "node:child_process";

export function sanitizeId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_.-]/g, "_");
}

export function forceRemoveContainer(containerName: string): void {
  const child = spawn("docker", ["rm", "-f", containerName], {
    env: process.env,
    stdio: "pipe",
  });

  child.stdin.end();
  child.on("error", () => undefined);
}

export function forceRemoveContainerSync(containerName: string): void {
  spawnSync("docker", ["rm", "-f", containerName], { env: process.env, stdio: "ignore" });
}
