import { HttpMethod, RequestContext } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";

import { createKubeConfig } from "../../../apps/worker/src/sandbox/kubernetes/executor";

function kubeConfig() {
  const config = createKubeConfig();
  config.loadFromOptions({
    clusters: [
      {
        name: "sandbox",
        server: "https://127.0.0.1:6443",
        caData: Buffer.from("ca").toString("base64"),
        skipTLSVerify: false,
      },
    ],
    users: [{ name: "worker", token: "token" }],
    contexts: [{ name: "sandbox", cluster: "sandbox", user: "worker" }],
    currentContext: "sandbox",
  });
  return config;
}

async function authenticate(config: ReturnType<typeof createKubeConfig>) {
  const context = new RequestContext("https://127.0.0.1:6443/api/v1/pods", HttpMethod.GET);
  await config.applySecurityAuthentication(context);
  return context;
}

describe("Kubernetes API transport", () => {
  it("shares one keep-alive dispatcher across requests and rotates it after 30 seconds", async () => {
    vi.useFakeTimers();
    try {
      const config = kubeConfig();
      const first = await authenticate(config);
      const second = await authenticate(config);
      expect(first.getDispatcher()).toBeDefined();
      expect(second.getDispatcher()).toBe(first.getDispatcher());
      expect(second.getHeaders().Authorization).toBe("Bearer token");
      vi.advanceTimersByTime(30_000);
      const rotated = await authenticate(config);
      expect(rotated.getDispatcher()).toBeDefined();
      expect(rotated.getDispatcher()).not.toBe(first.getDispatcher());
    } finally {
      vi.useRealTimers();
    }
  });
});
