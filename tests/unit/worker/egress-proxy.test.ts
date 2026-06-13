import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { buildInspectNetworkIpArgs } from "../../../apps/worker/src/services/docker-process";
import {
  buildProxyEnvArgs,
  buildStartProxyArgs,
  EGRESS_PROXY_IMAGE,
  EGRESS_PROXY_PORT,
  proxyContainerName,
  proxyUrl,
  renderAllowlistEnv,
} from "../../../apps/worker/src/services/egress-proxy";

const here = dirname(fileURLToPath(import.meta.url));
const proxyPath = join(here, "..", "..", "..", "infra", "docker", "egress-proxy", "proxy.mjs");
const { matchesAllowlist, parseAllowlist } = (await import(
  pathToFileURL(proxyPath).href
)) as typeof import("../../../infra/docker/egress-proxy/proxy.mjs");

describe("renderAllowlistEnv", () => {
  it("joins the allowlist into a comma string and trims entries", () => {
    expect(renderAllowlistEnv(["api.example.com:443", " files.example.org "])).toBe(
      "api.example.com:443,files.example.org",
    );
  });

  it("drops empty entries", () => {
    expect(renderAllowlistEnv(["a.com:443", "", "  "])).toBe("a.com:443");
  });

  it("round-trips through the proxy parser/matcher", () => {
    const allowlist = ["api.example.com:443", "files.example.org"];
    const env = renderAllowlistEnv(allowlist);
    const parsed = parseAllowlist(env);

    expect(matchesAllowlist(parsed, "api.example.com", 443)).toBe(true);
    expect(matchesAllowlist(parsed, "api.example.com", 80)).toBe(false);
    expect(matchesAllowlist(parsed, "files.example.org", 80)).toBe(true);
    expect(matchesAllowlist(parsed, "files.example.org", 443)).toBe(true);
    expect(matchesAllowlist(parsed, "evil.example.com", 443)).toBe(false);
  });
});

describe("buildProxyEnvArgs", () => {
  it("renders NOJV_ALLOWLIST and NOJV_PROXY_PORT env flags", () => {
    const args = buildProxyEnvArgs(["a.com:443", "b.com"], 8888);
    const allowIdx = args.indexOf("NOJV_ALLOWLIST=a.com:443,b.com");
    expect(allowIdx).toBeGreaterThan(0);
    expect(args[allowIdx - 1]).toBe("--env");

    const portIdx = args.indexOf("NOJV_PROXY_PORT=8888");
    expect(portIdx).toBeGreaterThan(0);
    expect(args[portIdx - 1]).toBe("--env");
  });
});

describe("buildStartProxyArgs", () => {
  const args = buildStartProxyArgs({
    containerName: "nojv-egress-proxy-sub-1",
    internalName: "nojv-net-internal-sub-1",
    allowlist: ["api.example.com:443"],
    port: EGRESS_PROXY_PORT,
  });

  it("runs the proxy detached on the internal network", () => {
    expect(args[0]).toBe("run");
    expect(args).toContain("-d");
    expect(args).toContain("--rm");

    const netIdx = args.indexOf("--network");
    expect(netIdx).toBeGreaterThan(0);
    expect(args[netIdx + 1]).toBe("nojv-net-internal-sub-1");
  });

  it("does NOT pin a static IP (Docker IPAM assigns; the worker inspects it)", () => {
    expect(args).not.toContain("--ip");
  });

  it("does NOT attach the egress network at start (egress is added via network connect)", () => {
    expect(args).not.toContain("nojv-net-egress-sub-1");
  });

  it("keeps the proxy hardened and resource-bounded", () => {
    expect(args).toContain("--cap-drop");
    expect(args).toContain("ALL");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("--read-only");
    expect(args).toContain("--memory");
    expect(args.at(-1)).toBe(EGRESS_PROXY_IMAGE);
  });
});

describe("buildInspectNetworkIpArgs", () => {
  it("inspects the container's IP on a specific network via a Go template", () => {
    const args = buildInspectNetworkIpArgs(
      "nojv-egress-proxy-sub-1",
      "nojv-net-internal-sub-1",
    );
    expect(args[0]).toBe("inspect");
    expect(args[1]).toBe("-f");
    expect(args[2]).toBe(
      '{{(index .NetworkSettings.Networks "nojv-net-internal-sub-1").IPAddress}}',
    );
    expect(args.at(-1)).toBe("nojv-egress-proxy-sub-1");
  });
});

describe("proxyUrl / proxyContainerName", () => {
  it("builds an http proxy URL from the inspected IP", () => {
    expect(proxyUrl("172.20.0.2", 8888)).toBe("http://172.20.0.2:8888");
  });

  it("derives a sanitized, length-bounded container name", () => {
    const name = proxyContainerName("sub/with:weird@chars");
    expect(name.startsWith("nojv-egress-proxy-")).toBe(true);
    expect(name).not.toMatch(/[/:@]/);
  });
});
