import { describe, expect, it } from "vitest";

import {
  buildCreateEgressNetworkArgs,
  buildCreateInternalNetworkArgs,
  planSubmissionNetworks,
} from "../../../apps/worker/src/services/docker-network";

describe("planSubmissionNetworks", () => {
  it("derives per-submission internal/egress names and a proxy static IP in the subnet", () => {
    const plan = planSubmissionNetworks("sub-123");
    expect(plan.internalName).toBe("nojv-net-internal-sub-123");
    expect(plan.egressName).toBe("nojv-net-egress-sub-123");
    expect(plan.internalSubnet).toMatch(/^10\.88\.\d{1,3}\.0\/24$/);
    expect(plan.proxyInternalIp).toMatch(/^10\.88\.\d{1,3}\.2$/);

    const subnetOctet = plan.internalSubnet.split(".")[2];
    const ipOctet = plan.proxyInternalIp.split(".")[2];
    expect(ipOctet).toBe(subnetOctet);
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
  it("creates an --internal network with the given subnet (zero external routing)", () => {
    const args = buildCreateInternalNetworkArgs("net-internal-x", "10.88.7.0/24");
    expect(args).toEqual([
      "network",
      "create",
      "--internal",
      "--subnet",
      "10.88.7.0/24",
      "net-internal-x",
    ]);
  });
});

describe("buildCreateEgressNetworkArgs", () => {
  it("creates a normal bridge network (no --internal)", () => {
    const args = buildCreateEgressNetworkArgs("net-egress-x");
    expect(args).toEqual(["network", "create", "net-egress-x"]);
    expect(args).not.toContain("--internal");
  });
});
