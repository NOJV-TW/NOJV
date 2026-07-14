import { describe, expect, it } from "vitest";

import { shouldSweepNetworkInspection } from "../../../apps/worker/src/services/docker-network";
import {
  DOCKER_CREATED_AT_LABEL,
  DOCKER_EXPIRES_AT_LABEL,
  DOCKER_MANAGED_LABEL,
  DOCKER_RUN_LABEL,
  DOCKER_WORKER_LABEL,
  buildDockerResourceLabels,
  dockerLabelArgs,
} from "../../../apps/worker/src/services/docker-resource";

describe("Docker resource ownership", () => {
  const labels = buildDockerResourceLabels("run-a", {
    workerId: "worker-a",
    nowMs: 1_000,
    ttlMs: 2_000,
  });

  it("labels every managed resource with immutable ownership and expiry metadata", () => {
    expect(labels).toEqual({
      [DOCKER_MANAGED_LABEL]: "true",
      [DOCKER_WORKER_LABEL]: "worker-a",
      [DOCKER_RUN_LABEL]: "run-a",
      [DOCKER_CREATED_AT_LABEL]: "1000",
      [DOCKER_EXPIRES_AT_LABEL]: "3000",
    });
    expect(dockerLabelArgs(labels).filter((value) => value === "--label")).toHaveLength(5);
  });

  it("sweeps only fully-labelled expired networks with no attached containers", () => {
    expect(shouldSweepNetworkInspection({ Labels: labels, Containers: {} }, 3_000)).toBe(true);
    expect(
      shouldSweepNetworkInspection(
        { Labels: labels, Containers: { active: { Name: "other-worker" } } },
        3_000,
      ),
    ).toBe(false);
    expect(shouldSweepNetworkInspection({ Labels: labels, Containers: {} }, 2_999)).toBe(false);
  });

  it("never treats prefix or partial labels as proof of ownership", () => {
    const { [DOCKER_WORKER_LABEL]: _, ...missingWorker } = labels;
    expect(shouldSweepNetworkInspection({ Labels: missingWorker, Containers: {} }, 4_000)).toBe(
      false,
    );
    expect(
      shouldSweepNetworkInspection(
        {
          Labels: { [DOCKER_MANAGED_LABEL]: "true" },
          Containers: {},
        },
        4_000,
      ),
    ).toBe(false);
  });
});
