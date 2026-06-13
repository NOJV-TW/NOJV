import { describe, expect, it } from "vitest";

import {
  buildCreateEgressNetworkArgs,
  buildCreateInternalNetworkArgs,
  planSubmissionNetworks,
} from "../../../apps/worker/src/services/docker-network";

describe("planSubmissionNetworks", () => {
  it("derives per-submission internal/egress names without any static subnet/IP", () => {
    const plan = planSubmissionNetworks("sub-123");
    expect(plan.internalName).toBe("nojv-net-internal-sub-123");
    expect(plan.egressName).toBe("nojv-net-egress-sub-123");
    expect(plan).not.toHaveProperty("internalSubnet");
    expect(plan).not.toHaveProperty("proxyInternalIp");
  });

  it("is deterministic for the same submission id", () => {
    expect(planSubmissionNetworks("sub-abc")).toEqual(planSubmissionNetworks("sub-abc"));
  });

  it("sanitizes weird characters out of the network names", () => {
    const plan = planSubmissionNetworks("sub/weird:id");
    expect(plan.internalName).not.toMatch(/[/:]/);
    expect(plan.egressName).not.toMatch(/[/:]/);
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

describe("buildCreateEgressNetworkArgs", () => {
  it("creates a normal bridge network (no --internal)", () => {
    const args = buildCreateEgressNetworkArgs("net-egress-x");
    expect(args).toEqual(["network", "create", "net-egress-x"]);
    expect(args).not.toContain("--internal");
  });
});
