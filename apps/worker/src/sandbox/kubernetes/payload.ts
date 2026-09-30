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

export interface ChunkRange<T> {
  key: string;
  item: T;
  start: number;
  end: number;
}

export interface PackedChunks<T> {
  files: (T & { chunks: string[] })[];
  shards: ChunkRange<T>[][];
}

export function sha256Hex(body: Buffer | string): string {
  return createHash("sha256").update(body).digest("hex");
}

function assertPayloadPath(path: string): void {
  if (path.length === 0 || path === "." || path === ".." || !CONFIGMAP_KEY_PATTERN.test(path)) {
    throw new Error(`Invalid sandbox payload path: ${JSON.stringify(path)}`);
  }
}

function trimTrailingNonAlphanumeric(value: string): string {
  let end = value.length;
  while (end > 0 && !/[a-z0-9]/i.test(value.charAt(end - 1))) end--;
  return value.slice(0, end);
}

function resourceName(baseName: string, suffix: string): string {
  const direct = `${baseName}-${suffix}`;
  if (direct.length <= K8S_NAME_MAX_CHARS) return direct;

  const digest = createHash("sha256").update(baseName).digest("hex").slice(0, 8);
  const prefixLength = K8S_NAME_MAX_CHARS - suffix.length - digest.length - 2;
  const prefix = trimTrailingNonAlphanumeric(baseName.slice(0, prefixLength));
  return `${prefix}-${digest}-${suffix}`;
}

export function packChunks<T extends { size: number }>(
  items: T[],
  chunkKey: (index: number) => string,
): PackedChunks<T> {
  const shards: ChunkRange<T>[][] = [];
  let current: ChunkRange<T>[] = [];
  let currentBytes = 0;
  let chunkIndex = 0;

  const flushShard = () => {
    if (current.length === 0) return;
    shards.push(current);
    current = [];
    currentBytes = 0;
  };

  const files = items.map((item) => {
    const chunks: string[] = [];
    let offset = 0;
    while (offset < item.size) {
      const key = chunkKey(chunkIndex);
      const keyBytes = Buffer.byteLength(key);
      let available = CONFIGMAP_SHARD_MAX_BYTES - currentBytes - keyBytes;
      if (available <= 0) {
        flushShard();
        available = CONFIGMAP_SHARD_MAX_BYTES - keyBytes;
      }
      const end = Math.min(item.size, offset + available);
      current.push({ key, item, start: offset, end });
      currentBytes += keyBytes + end - offset;
      chunks.push(key);
      chunkIndex += 1;
      offset = end;
      if (currentBytes === CONFIGMAP_SHARD_MAX_BYTES) flushShard();
    }
    return { ...item, chunks };
  });
  flushShard();
  return { files, shards };
}

export function encodeShard<C extends ChunkRange<unknown>>(
  shard: C[],
  body: (chunk: C) => Buffer,
): Record<string, string> {
  return Object.fromEntries(
    shard.map((chunk) => [
      chunk.key,
      body(chunk).subarray(chunk.start, chunk.end).toString("base64"),
    ]),
  );
}

export function buildPayloadConfigMaps(
  baseName: string,
  namespace: string,
  data: Record<string, string>,
  externalFiles: SandboxPayloadManifestFile[] = [],
): k8s.V1ConfigMap[] {
  const packed = packChunks(
    Object.entries(data)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => {
        assertPayloadPath(path);
        const body = Buffer.from(content, "utf8");
        return { path, body, size: body.byteLength };
      }),
    (index) => `chunk-${String(index).padStart(6, "0")}`,
  );
  const files: SandboxPayloadManifestFile[] = packed.files.map(({ path, body, chunks }) => ({
    path,
    chunks,
    size: body.byteLength,
    sha256: sha256Hex(body),
  }));
  const paths = new Set(files.map((file) => file.path));
  const chunkOwners = new Map<string, string>();
  for (const file of [...files, ...externalFiles]) {
    if (externalFiles.includes(file)) {
      assertPayloadPath(file.path);
      if (paths.has(file.path)) throw new Error(`Duplicate sandbox payload path: ${file.path}`);
      paths.add(file.path);
    }
    for (const chunk of file.chunks) {
      if ((chunkOwners.get(chunk) ?? file.sha256) !== file.sha256)
        throw new Error(`Sandbox payload chunk collision at ${chunk}.`);
      chunkOwners.set(chunk, file.sha256);
    }
  }
  const manifest: SandboxPayloadManifest = {
    version: 1,
    files: [...files, ...externalFiles].sort((a, b) => a.path.localeCompare(b.path)),
  };

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
      immutable: true,
      data: { [PAYLOAD_MANIFEST_FILE]: manifestBody },
    },
    ...packed.shards.map((shard, index): k8s.V1ConfigMap => ({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: resourceName(baseName, `p${String(index)}`), namespace },
      immutable: true,
      binaryData: encodeShard(shard, ({ item }) => item.body),
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
