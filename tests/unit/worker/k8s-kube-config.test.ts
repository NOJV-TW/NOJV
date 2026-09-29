import { describe, expect, it } from "vitest";

import { createKubeConfig } from "../../../apps/worker/src/sandbox/kubernetes/executor";

describe("createKubeConfig", () => {
  it("keeps Kubernetes API connections on HTTP/1.1", () => {
    const config = createKubeConfig();
    config.loadFromOptions({
      clusters: [{ name: "c", server: "https://127.0.0.1:6443", skipTLSVerify: true }],
      users: [{ name: "u", token: "t" }],
      contexts: [{ name: "x", cluster: "c", user: "u" }],
      currentContext: "x",
    });
    const options = config.createDispatcherOptions(config.getCurrentCluster(), {
      ca: "cluster-ca",
    });
    expect(options.type).toBe("agent");
    expect(options.type === "agent" && options.connect).toMatchObject({ allowH2: false });
  });
});
