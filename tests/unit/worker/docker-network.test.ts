import { describe, expect, it } from "vitest";

import {
  buildCreateInternalNetworkArgs,
  planSubmissionNetwork,
} from "../../../apps/worker/src/services/docker-network";

describe("planSubmissionNetwork", () => {
  it("derives a per-submission internal name without any static subnet/IP", () => {
    const plan = planSubmissionNetwork("sub-123");
    expect(plan.internalName).toBe("nojv-net-internal-sub-123");
    expect(plan).not.toHaveProperty("internalSubnet");
    expect(plan).not.toHaveProperty("proxyInternalIp");
  });

  it("is deterministic for the same submission id", () => {
    expect(planSubmissionNetwork("sub-abc")).toEqual(planSubmissionNetwork("sub-abc"));
  });

  it("sanitizes weird characters out of the network names", () => {
    const plan = planSubmissionNetwork("sub/weird:id");
    expect(plan.internalName).not.toMatch(/[/:]/);
  });
});

describe("buildCreateInternalNetworkArgs", () => {
  it("creates an --internal network and lets Docker IPAM assign the subnet", () => {
    const args = buildCreateInternalNetworkArgs("net-internal-x");
    expect(args).toEqual(["network", "create", "--internal", "net-internal-x"]);
    expect(args).not.toContain("--subnet");
    expect(args).not.toContain("--ip");
  });
});
