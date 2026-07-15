import { createHash } from "node:crypto";

import type * as k8s from "@kubernetes/client-node";

export const CONFIGMAP_SHARD_MAX_BYTES = 750_000;
export const PAYLOAD_MANIFEST_FILE = "payload-manifest.json";

const CONFIGMAP_KEY_PATTERN = /^[-._A-Za-z0-9]+$/;
const K8S_NAME_MAX_CHARS = 63;

export interface SandboxPayloadManifestFile {
  path: string;
  chunks: string[];
  size: number;
  sha256: string;
}

export interface SandboxPayloadManifest {
  version: 1;
  files: SandboxPayloadManifestFile[];
}

function assertPayloadPath(path: string): void {
  if (path.length === 0 || path === "." || path === ".." || !CONFIGMAP_KEY_PATTERN.test(path)) {
    throw new Error(`Invalid sandbox payload path: ${JSON.stringify(path)}`);
  }
}

function resourceName(baseName: string, suffix: string): string {
  const direct = `${baseName}-${suffix}`;
  if (direct.length <= K8S_NAME_MAX_CHARS) return direct;

  const digest = createHash("sha256").update(baseName).digest("hex").slice(0, 8);
  const prefixLength = K8S_NAME_MAX_CHARS - suffix.length - digest.length - 2;
  const prefix = baseName.slice(0, prefixLength).replace(/[^a-z0-9]+$/i, "");
  return `${prefix}-${digest}-${suffix}`;
}

export function buildPayloadConfigMaps(
  baseName: string,
  namespace: string,
  data: Record<string, string>,
): k8s.V1ConfigMap[] {
  const manifest: SandboxPayloadManifest = { version: 1, files: [] };
  const shardData: Record<string, string>[] = [];
  let currentShard: Record<string, string> = {};
  let currentShardBytes = 0;
  let chunkIndex = 0;

  const flushShard = () => {
    if (Object.keys(currentShard).length === 0) return;
    shardData.push(currentShard);
    currentShard = {};
    currentShardBytes = 0;
  };

  for (const [path, content] of Object.entries(data).sort(([a], [b]) => a.localeCompare(b))) {
    assertPayloadPath(path);
    const body = Buffer.from(content, "utf8");
    const chunks: string[] = [];
    let offset = 0;

    while (offset < body.length) {
      const chunkKey = `chunk-${String(chunkIndex).padStart(6, "0")}`;
      const keyBytes = Buffer.byteLength(chunkKey);
      let available = CONFIGMAP_SHARD_MAX_BYTES - currentShardBytes - keyBytes;
      if (available <= 0) {
        flushShard();
        available = CONFIGMAP_SHARD_MAX_BYTES - keyBytes;
      }
      const end = Math.min(body.length, offset + available);
      const chunk = body.subarray(offset, end);
      currentShard[chunkKey] = chunk.toString("base64");
      currentShardBytes += keyBytes + chunk.byteLength;
      chunks.push(chunkKey);
      chunkIndex += 1;
      offset = end;
      if (currentShardBytes === CONFIGMAP_SHARD_MAX_BYTES) flushShard();
    }

    manifest.files.push({
      path,
      chunks,
      size: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
  }
  flushShard();

  const manifestBody = JSON.stringify(manifest);
  if (
    Buffer.byteLength(PAYLOAD_MANIFEST_FILE) + Buffer.byteLength(manifestBody) >
    CONFIGMAP_SHARD_MAX_BYTES
  ) {
    throw new Error("Sandbox payload manifest exceeds the ConfigMap shard limit.");
  }

  return [
    {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: resourceName(baseName, "pm"), namespace },
      data: { [PAYLOAD_MANIFEST_FILE]: manifestBody },
    },
    ...shardData.map((binaryData, index): k8s.V1ConfigMap => ({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: resourceName(baseName, `p${String(index)}`), namespace },
      binaryData,
    })),
  ];
}

export function payloadConfigMapNames(configMaps: k8s.V1ConfigMap[]): string[] {
  return configMaps.map((configMap) => {
    const name = configMap.metadata?.name;
    if (!name) throw new Error("Sandbox payload ConfigMap is missing metadata.name.");
    return name;
  });
}
