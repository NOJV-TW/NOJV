import { describe, expect, it } from "vitest";

import {
  buildAdvancedDockerArgs,
  buildServiceEnv,
} from "../../../apps/worker/src/services/advanced-mode-executor";
import {
  ADVANCED_SERVICE_PORT,
  buildStartServiceArgs,
  SERVICE_HOST_ENV,
  SERVICE_NETWORK_ALIAS,
  serviceContainerName,
} from "../../../apps/worker/src/services/service-container";

describe("buildStartServiceArgs", () => {
  const args = buildStartServiceArgs({
    containerName: "nojv-service-sub-1",
    internalName: "nojv-net-internal-sub-1",
    imageRef: "ta-service:latest",
    memoryMb: 1024,
    cpuLimit: "1.0",
    pidsLimit: 128,
  });

  it("runs the service detached on the internal network with the stable alias", () => {
    expect(args[0]).toBe("run");
    expect(args).toContain("-d");
    expect(args).toContain("--rm");

    const netIdx = args.indexOf("--network");
    expect(netIdx).toBeGreaterThan(0);
    expect(args[netIdx + 1]).toBe("nojv-net-internal-sub-1");

    const aliasIdx = args.indexOf("--network-alias");
    expect(aliasIdx).toBeGreaterThan(0);
    expect(args[aliasIdx + 1]).toBe(SERVICE_NETWORK_ALIAS);
    expect(args[aliasIdx + 1]).toBe("service");
  });

  it("injects PORT=8888 so the scaffold binds the agreed platform service port", () => {
    expect(ADVANCED_SERVICE_PORT).toBe(8888);
    const envIdx = args.indexOf("-e");
    expect(envIdx).toBeGreaterThan(0);
    expect(args).toContain(`PORT=${String(ADVANCED_SERVICE_PORT)}`);
    expect(args).toContain("PORT=8888");
  });

  it("does NOT attach the egress network at start (egress is added via network connect)", () => {
    expect(args).not.toContain("nojv-net-egress-sub-1");
    expect(args.filter((a) => a === "--network")).toHaveLength(1);
  });

  it("never uses --network none in service mode", () => {
    expect(args).not.toContain("none");
  });

  it("pins the author-supplied service image to the sandbox non-root user", () => {
    const userIdx = args.indexOf("--user");
    expect(userIdx).toBeGreaterThan(0);
    expect(args[userIdx + 1]).toBe("10001:10001");
  });

  it("keeps the service hardened and resource-bounded like the grade container", () => {
    expect(args).toContain("--cap-drop");
    expect(args).toContain("ALL");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("--read-only");

    const tmpfsIdx = args.indexOf("--tmpfs");
    expect(tmpfsIdx).toBeGreaterThan(0);
    expect(args[tmpfsIdx + 1]).toBe("/tmp:rw,exec,nosuid,nodev,size=64m");

    const memIdx = args.indexOf("--memory");
    expect(memIdx).toBeGreaterThan(0);
    expect(args[memIdx + 1]).toBe("1024m");
    const swapIdx = args.indexOf("--memory-swap");
    expect(args[swapIdx + 1]).toBe("1024m");

    const pidsIdx = args.indexOf("--pids-limit");
    expect(args[pidsIdx + 1]).toBe("128");

    expect(args.at(-1)).toBe("ta-service:latest");
  });
});

describe("serviceContainerName", () => {
  it("derives a sanitized, length-bounded container name", () => {
    const name = serviceContainerName("sub/with:weird@chars");
    expect(name.startsWith("nojv-service-")).toBe(true);
    expect(name).not.toMatch(/[/:@]/);
  });
});

describe("service network mode run-phase args", () => {
  const runArgs = (extraEnv: Record<string, string>): string[] =>
    buildAdvancedDockerArgs({
      containerName: "nojv-advanced-run-abc",
      networkArgs: ["--network", "nojv-net-internal-sub-123"],
      workspaceDir: "/tmp/job/run",
      cpuLimit: "1.0",
      memoryMb: 512,
      pidsLimit: 64,
      imageRef: "run-image:latest",
      submissionId: "sub-123",
      language: "python",
      user: "10001:10001",
      extraEnv,
    });

  it("buildServiceEnv injects NOJV_SERVICE_HOST=service:8888 (host:port) and nothing else", () => {
    expect(buildServiceEnv()).toEqual({
      [SERVICE_HOST_ENV]: `${SERVICE_NETWORK_ALIAS}:${String(ADVANCED_SERVICE_PORT)}`,
    });
    expect(buildServiceEnv()).toEqual({ NOJV_SERVICE_HOST: "service:8888" });
  });

  it("runs single-homed on the internal network (egress absent, exactly one --network)", () => {
    const args = runArgs(buildServiceEnv());
    const netIdx = args.indexOf("--network");
    expect(args[netIdx + 1]).toBe("nojv-net-internal-sub-123");
    expect(args).not.toContain("nojv-net-egress-sub-123");
    expect(args.filter((a) => a === "--network")).toHaveLength(1);
    expect(args).not.toContain("none");
  });

  it("carries NOJV_SERVICE_HOST=service:8888 and NO HTTP_PROXY in service mode", () => {
    const args = runArgs(buildServiceEnv());
    const hostIdx = args.indexOf("NOJV_SERVICE_HOST=service:8888");
    expect(hostIdx).toBeGreaterThan(0);
    expect(args[hostIdx - 1]).toBe("--env");

    expect(args.some((a) => a.startsWith("HTTP_PROXY="))).toBe(false);
    expect(args.some((a) => a.startsWith("HTTPS_PROXY="))).toBe(false);
    expect(args.some((a) => a.startsWith("http_proxy="))).toBe(false);
    expect(args.some((a) => a.startsWith("https_proxy="))).toBe(false);
  });

  it("keeps the run container at the strict untrusted posture (--user 10001)", () => {
    const args = runArgs(buildServiceEnv());
    const userIdx = args.indexOf("--user");
    expect(userIdx).toBeGreaterThan(0);
    expect(args[userIdx + 1]).toBe("10001:10001");
  });
});
