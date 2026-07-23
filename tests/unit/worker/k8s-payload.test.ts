import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildPayloadConfigMaps,
  CONFIGMAP_SHARD_MAX_BYTES,
  PAYLOAD_MANIFEST_FILE,
  type SandboxPayloadManifest,
} from "../../../apps/worker/src/services/k8s-payload";

function decodePayload(configMaps: ReturnType<typeof buildPayloadConfigMaps>) {
  const projected = new Map<string, Buffer>();
  for (const configMap of configMaps) {
    for (const [name, value] of Object.entries(configMap.data ?? {})) {
      projected.set(name, Buffer.from(value));
    }
    for (const [name, value] of Object.entries(configMap.binaryData ?? {})) {
      projected.set(name, Buffer.from(value, "base64"));
    }
  }

  const manifest = JSON.parse(
    projected.get(PAYLOAD_MANIFEST_FILE)?.toString("utf8") ?? "null",
  ) as SandboxPayloadManifest;
  const files = new Map<string, Buffer>();
  for (const file of manifest.files) {
    const body = Buffer.concat(
      file.chunks.map((chunk) => {
        const value = projected.get(chunk);
        if (!value) throw new Error(`missing ${chunk}`);
        return value;
      }),
    );
    files.set(file.path, body);
  }
  return { files, manifest };
}

describe("buildPayloadConfigMaps", () => {
  it("builds a deterministic manifest for a small payload", () => {
    const input = { "config.json": "{}", "testcase-0-input.txt": "1 2\n" };
    const first = buildPayloadConfigMaps("judge-run", "nojv-sandbox", input);
    const second = buildPayloadConfigMaps("judge-run", "nojv-sandbox", input);
    const decoded = decodePayload(first);

    expect(first).toEqual(second);
    expect(decoded.files.get("config.json")?.toString("utf8")).toBe("{}");
    expect(decoded.files.get("testcase-0-input.txt")?.toString("utf8")).toBe("1 2\n");
    expect(decoded.manifest.version).toBe(1);
  });

  it("shards and preserves an exact 10 MiB file", () => {
    const body = Buffer.from("x".repeat(10 * 1024 * 1024), "utf8");
    const configMaps = buildPayloadConfigMaps("judge-large", "nojv-sandbox", {
      "testcase-0-input.txt": body.toString("utf8"),
    });

    for (const configMap of configMaps.slice(1)) {
      const decodedBytes = Object.entries(configMap.binaryData ?? {}).reduce(
        (sum, [key, value]) =>
          sum + Buffer.byteLength(key) + Buffer.from(value, "base64").length,
        0,
      );
      expect(decodedBytes).toBeLessThanOrEqual(CONFIGMAP_SHARD_MAX_BYTES);
    }

    const decoded = decodePayload(configMaps);
    const restored = decoded.files.get("testcase-0-input.txt");
    expect(restored?.byteLength).toBe(body.byteLength);
    expect(
      createHash("sha256")
        .update(restored ?? Buffer.alloc(0))
        .digest("hex"),
    ).toBe(createHash("sha256").update(body).digest("hex"));
    expect(decoded.manifest.files[0]?.sha256).toBe(
      createHash("sha256")
        .update(restored ?? Buffer.alloc(0))
        .digest("hex"),
    );
    expect(configMaps.length).toBeGreaterThan(2);
  });

  it("preserves Unicode at chunk boundaries", () => {
    const content = "界".repeat(Math.ceil(CONFIGMAP_SHARD_MAX_BYTES / 3) + 1);
    const decoded = decodePayload(
      buildPayloadConfigMaps("judge-unicode", "nojv-sandbox", { "input.txt": content }),
    );

    expect(decoded.files.get("input.txt")?.toString("utf8")).toBe(content);
  });

  it.each(["../secret", "nested/input.txt", "", "bad\0name"])(
    "rejects unsafe payload path %j",
    (path) => {
      expect(() =>
        buildPayloadConfigMaps("judge-run", "nojv-sandbox", { [path]: "x" }),
      ).toThrow(/payload path/i);
    },
  );
});
