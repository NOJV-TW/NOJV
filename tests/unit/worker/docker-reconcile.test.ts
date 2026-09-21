import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runDockerCommand: vi.fn(), runStandardMode: vi.fn() }));
vi.mock("../../../apps/worker/src/services/docker-process", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../apps/worker/src/services/docker-process")
  >()),
  runDockerCommand: mocks.runDockerCommand,
}));
vi.mock("../../../apps/worker/src/services/standard-mode-executor", () => ({
  runStandardMode: mocks.runStandardMode,
}));

import { DockerExecutor } from "../../../apps/worker/src/services/docker-executor";
import { reconcileDockerRun } from "../../../apps/worker/src/services/docker-reconcile";
import {
  DOCKER_MANAGED_LABEL,
  DOCKER_RUN_LABEL,
} from "../../../apps/worker/src/services/docker-resource";

const RUN = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const CONTAINER = "a".repeat(64);
const NETWORK = "b".repeat(64);
const OWNER = "worker-local";

function daemon() {
  const state = {
    running: true,
    container: true,
    network: true,
    foreignEndpoint: false,
    stuck: false,
    wrongOwner: false,
  };
  const mutations: string[][] = [];
  mocks.runDockerCommand.mockImplementation(async (args: string[]) => {
    const [kind, command] = args;
    const container = kind === "container";
    const id = container ? CONTAINER : NETWORK;
    const exists = container ? state.container : state.network;
    if (command === "ls") {
      expect(args).toContain(`label=${DOCKER_MANAGED_LABEL}=true`);
      expect(args).toContain(`label=${DOCKER_RUN_LABEL}=${RUN}`);
      return { stdout: exists ? id : "", stderr: "" };
    }
    if (command === "inspect") {
      if (!exists) return { stdout: "", stderr: "" };
      const labels = {
        [DOCKER_MANAGED_LABEL]: "true",
        [DOCKER_RUN_LABEL]: state.wrongOwner ? "other-run" : RUN,
      };
      return {
        stdout: JSON.stringify([
          container
            ? {
                Id: id,
                Config: { Labels: labels },
                State: { Running: state.running, Restarting: false },
              }
            : {
                Id: id,
                Labels: labels,
                Containers: state.foreignEndpoint ? { foreign: {} } : {},
              },
        ]),
        stderr: "",
      };
    }
    mutations.push(args);
    if (command === "stop") {
      if (!state.stuck) state.running = false;
    } else if (command === "rm") {
      if (container) state.container = false;
      else state.network = false;
    } else throw new Error(`Unexpected Docker command ${args.join(" ")}`);
    return { stdout: "", stderr: "" };
  });
  return { state, mutations };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("HOSTNAME", OWNER);
});
afterEach(() => vi.unstubAllEnvs());

describe("Docker crashed execution reconciliation", () => {
  it("checks ownership, stops the container, confirms exit and removes only exact run resources", async () => {
    const fake = daemon();
    expect(await reconcileDockerRun(RUN, OWNER)).toBe(true);
    expect(fake.mutations).toEqual([
      ["container", "stop", "-t", "10", CONTAINER],
      ["container", "rm", CONTAINER],
      ["network", "rm", NETWORK],
    ]);
    expect(fake.mutations.flat()).not.toContain("--force");
    expect(fake.mutations.flat()).not.toContain("-f");
  });

  it("does not remove a container that remains running after stop", async () => {
    const fake = daemon();
    fake.state.stuck = true;
    expect(await reconcileDockerRun(RUN, OWNER)).toBe(false);
    expect(fake.mutations).toEqual([["container", "stop", "-t", "10", CONTAINER]]);
    expect(fake.state.network).toBe(true);
  });

  it("preserves a network with an unrelated active endpoint", async () => {
    const fake = daemon();
    fake.state.container = false;
    fake.state.foreignEndpoint = true;
    expect(await reconcileDockerRun(RUN, OWNER)).toBe(false);
    expect(fake.mutations).toHaveLength(0);
  });

  it("rejects a resource whose inspected ownership differs from the listing", async () => {
    const fake = daemon();
    fake.state.wrongOwner = true;
    expect(await reconcileDockerRun(RUN, OWNER)).toBe(false);
    expect(fake.mutations).toHaveLength(0);
  });

  it("requires the original Docker host and a valid run ID", async () => {
    daemon();
    expect(await reconcileDockerRun(RUN, "other-host")).toBe(false);
    expect(await reconcileDockerRun(RUN)).toBe(false);
    expect(await reconcileDockerRun("--all", OWNER)).toBe(false);
    expect(mocks.runDockerCommand).not.toHaveBeenCalled();
  });

  it("fails closed if Docker cannot be inspected", async () => {
    mocks.runDockerCommand.mockRejectedValue(new Error("daemon offline"));
    expect(await reconcileDockerRun(RUN, OWNER)).toBe(false);
  });

  it("pins the original sandbox image without changing subsequent executor defaults", async () => {
    mocks.runStandardMode.mockResolvedValue({ testcaseResults: [] });
    const executor = new DockerExecutor({
      image: "sandbox:current",
      cpuLimit: "1",
      memoryMb: 256,
      pidsLimit: 128,
    });
    const request = {
      submissionId: "submission",
      sourceCode: "",
      language: "python" as const,
      problemType: "full_source" as const,
      judgeType: "standard" as const,
      judgeConfig: {},
      limits: { timeoutMs: 1000, memoryMb: 128 },
      testcases: [],
    };
    const execution = { runId: RUN, signal: new AbortController().signal };
    await executor.execute({ ...request, sandboxImage: "sandbox@sha256:original" }, execution);
    expect(mocks.runStandardMode.mock.calls[0][3].image).toBe("sandbox@sha256:original");
    await executor.execute(request, execution);
    expect(mocks.runStandardMode.mock.calls[1][3].image).toBe("sandbox:current");
  });
});
