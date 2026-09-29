import { createRequire } from "node:module";
import { setTimeout as wait } from "node:timers/promises";

import type * as k8s from "@kubernetes/client-node";
import type { SandboxText } from "@nojv/core";

import type { StageTestcaseFile } from "../shared/stage-payload";
import type { TestcaseReader } from "../shared/testcase-text";

import { rethrowSandboxQuotaError } from "./admission";
import { k8sErrorCode } from "./cleanup-call";
import { SandboxInfrastructureError, SandboxTransientInfrastructureError } from "./errors";
import {
  CONFIGMAP_SHARD_MAX_BYTES,
  encodeShard,
  packChunks,
  sha256Hex,
  type ChunkRange,
  type SandboxPayloadManifestFile,
} from "./payload";

const require = createRequire(import.meta.url);

export const TESTCASE_CACHE_LABEL = "nojv-testcase-cache";
export const TESTCASE_KEY_LABEL = "nojv-testcase-key";
export const TESTCASE_ROLE_LABEL = "nojv-testcase-role";
export const TESTCASE_STATE_ANNOTATION = "nojv-testcase-state";
export const TESTCASE_LAST_USED_ANNOTATION = "nojv-testcase-last-used";
export const TESTCASE_CACHE_PREFIX = "tc-";
export const TESTCASE_INDEX_NAME_LENGTH = TESTCASE_CACHE_PREFIX.length + 32;
export const TESTCASE_LAYOUT_KEY = "layout.json";
export const TESTCASE_TOUCH_INTERVAL_MS = 10 * 60_000;
export const TESTCASE_TAKEOVER_MS = 120_000;
const POLL_MS = 1_000;
const ENSURE_TIMEOUT_MS = 5 * 60_000;
const SHARD_UPLOAD_CONCURRENCY = 4;

export type TestcaseRole = StageTestcaseFile["role"];

export interface TestcaseEntry {
  sha256: string;
  size: number;
  text: SandboxText;
}

export interface TestcaseSet {
  role: TestcaseRole;
  key: string;
  indexName: string;
  layout: string;
  shardCount: number;
  files: Map<string, { size: number; chunks: string[] }>;
  shards: ChunkRange<TestcaseEntry>[][];
}

export function testcaseEntry(text: SandboxText): TestcaseEntry {
  if (typeof text !== "string") return { sha256: text.sha256, size: text.size, text };
  const body = Buffer.from(text, "utf8");
  return { sha256: sha256Hex(body), size: body.byteLength, text };
}

export function planTestcaseSet(role: TestcaseRole, entries: TestcaseEntry[]): TestcaseSet {
  const unique = [...new Map(entries.map((entry) => [entry.sha256, entry])).values()].sort(
    (a, b) => a.sha256.localeCompare(b.sha256),
  );
  const digest = sha256Hex(
    [
      "nojv-testcase-set/v1",
      role,
      String(CONFIGMAP_SHARD_MAX_BYTES),
      ...unique.map(({ sha256, size }) => `${sha256}:${String(size)}`),
    ].join("\n"),
  );
  const key = digest.slice(0, 32);
  const chunkPrefix = BigInt(`0x${digest.slice(32, 44)}`)
    .toString()
    .padStart(15, "0");
  const packed = packChunks(
    unique,
    (index) => `chunk-${chunkPrefix}${String(index).padStart(6, "0")}`,
  );
  const files = packed.files.map(({ sha256, size, chunks }) => ({ sha256, size, chunks }));
  return {
    role,
    key,
    indexName: `${TESTCASE_CACHE_PREFIX}${key}`,
    layout: JSON.stringify({ version: 1, role, files }),
    shardCount: packed.shards.length,
    files: new Map(files.map(({ sha256, size, chunks }) => [sha256, { size, chunks }])),
    shards: packed.shards,
  };
}

function testcaseShardName(set: TestcaseSet, indexUid: string, shard: number): string {
  return `${set.indexName}-${indexUid.replaceAll("-", "").slice(0, 16)}-${String(shard)}`;
}

export function testcaseShardNames(set: TestcaseSet, indexUid: string): string[] {
  return Array.from({ length: set.shardCount }, (_, shard) =>
    testcaseShardName(set, indexUid, shard),
  );
}

export function testcaseManifestFile(
  path: string,
  entry: TestcaseEntry,
  set: TestcaseSet | undefined,
): SandboxPayloadManifestFile {
  const layout = set?.files.get(entry.sha256);
  if (!layout) throw new Error(`Testcase cache has no entry for ${path}.`);
  return { path, chunks: layout.chunks, size: layout.size, sha256: entry.sha256 };
}

export function testcaseLastUsedAt(configMap: k8s.V1ConfigMap): number {
  const touched = Date.parse(
    configMap.metadata?.annotations?.[TESTCASE_LAST_USED_ANNOTATION] ?? "",
  );
  if (Number.isFinite(touched)) return touched;
  const created = configMap.metadata?.creationTimestamp;
  return created ? new Date(created).getTime() : 0;
}

export class KubernetesTestcaseCache {
  private readonly readObject: TestcaseReader | undefined;
  private readonly now: () => number;

  constructor(
    private readonly coreApi: k8s.CoreV1Api,
    options: { read?: TestcaseReader; now?: () => number } = {},
  ) {
    this.readObject = options.read;
    this.now = options.now ?? Date.now;
  }

  private async body({ text, size }: TestcaseEntry): Promise<Buffer> {
    if (typeof text === "string") return Buffer.from(text, "utf8");
    if (!this.readObject) throw new Error(`No testcase reader is configured for ${text.key}.`);
    const body = await this.readObject(text);
    if (body.byteLength !== size)
      throw new SandboxInfrastructureError(`Testcase ${text.key} does not match its pointer.`);
    return body;
  }

  private labels(set: TestcaseSet, kind: "index" | "shard"): Record<string, string> {
    return {
      [TESTCASE_CACHE_LABEL]: kind,
      [TESTCASE_KEY_LABEL]: set.key,
      [TESTCASE_ROLE_LABEL]: set.role,
    };
  }

  private async read(name: string, namespace: string): Promise<k8s.V1ConfigMap | null> {
    try {
      return await this.coreApi.readNamespacedConfigMap({ name, namespace });
    } catch (error) {
      if (k8sErrorCode(error) === 404) return null;
      throw error;
    }
  }

  private async createIndex(
    set: TestcaseSet,
    namespace: string,
  ): Promise<k8s.V1ConfigMap | null> {
    try {
      return await this.coreApi
        .createNamespacedConfigMap({
          namespace,
          body: {
            apiVersion: "v1",
            kind: "ConfigMap",
            metadata: {
              name: set.indexName,
              namespace,
              labels: this.labels(set, "index"),
              annotations: {
                [TESTCASE_STATE_ANNOTATION]: "pending",
                [TESTCASE_LAST_USED_ANNOTATION]: new Date(this.now()).toISOString(),
              },
            },
            immutable: true,
            data: { [TESTCASE_LAYOUT_KEY]: set.layout },
          },
        })
        .catch(rethrowSandboxQuotaError);
    } catch (error) {
      if (k8sErrorCode(error) === 409) return null;
      throw error;
    }
  }

  private async annotate(
    name: string,
    resourceVersion: string | undefined,
    namespace: string,
    annotations: Record<string, string>,
  ): Promise<boolean> {
    const k8sLib = require("@kubernetes/client-node") as typeof k8s;
    try {
      await this.coreApi.patchNamespacedConfigMap(
        {
          name,
          namespace,
          body: { metadata: { resourceVersion, annotations } },
        },
        k8sLib.setHeaderOptions("Content-Type", k8sLib.PatchStrategy.MergePatch),
      );
      return true;
    } catch (error) {
      const code = k8sErrorCode(error);
      if (code === 404 || code === 409) return false;
      throw error;
    }
  }

  private async createShards(
    set: TestcaseSet,
    uid: string,
    namespace: string,
    signal: AbortSignal,
  ): Promise<void> {
    const pending = new Map<TestcaseEntry, number>();
    for (const shard of set.shards)
      for (const item of new Set(shard.map(({ item }) => item)))
        pending.set(item, (pending.get(item) ?? 0) + 1);
    const bodies = new Map<TestcaseEntry, Promise<Buffer>>();
    const load = (item: TestcaseEntry) => {
      const cached = bodies.get(item) ?? this.body(item);
      bodies.set(item, cached);
      return cached;
    };
    const queue = set.shards.entries();
    let failed = false;
    const upload = async () => {
      for (const [index, shard] of queue) {
        if (failed) return;
        signal.throwIfAborted();
        const loaded = await Promise.all(
          shard.map(async (chunk) => ({ ...chunk, body: await load(chunk.item) })),
        );
        await this.coreApi
          .createNamespacedConfigMap({
            namespace,
            body: {
              apiVersion: "v1",
              kind: "ConfigMap",
              metadata: {
                name: testcaseShardName(set, uid, index),
                namespace,
                labels: this.labels(set, "shard"),
                ownerReferences: [
                  { apiVersion: "v1", kind: "ConfigMap", name: set.indexName, uid },
                ],
              },
              immutable: true,
              binaryData: encodeShard(loaded, ({ body }) => body),
            },
          })
          .catch((error: unknown) => {
            if (k8sErrorCode(error) !== 409) rethrowSandboxQuotaError(error);
          });
        for (const item of new Set(shard.map((chunk) => chunk.item))) {
          const left = (pending.get(item) ?? 1) - 1;
          pending.set(item, left);
          if (left === 0) bodies.delete(item);
        }
      }
    };
    await Promise.all(
      Array.from({ length: SHARD_UPLOAD_CONCURRENCY }, () =>
        upload().catch((error: unknown) => {
          failed = true;
          throw error;
        }),
      ),
    );
    signal.throwIfAborted();
  }

  async ensure(set: TestcaseSet, namespace: string, signal: AbortSignal): Promise<string[]> {
    const deadline = this.now() + ENSURE_TIMEOUT_MS;
    let created = false;
    while (this.now() < deadline) {
      signal.throwIfAborted();
      let index = await this.read(set.indexName, namespace);
      if (!index) {
        index = await this.createIndex(set, namespace);
        if (!index) continue;
        created = true;
      }
      const metadata = index.metadata ?? {};
      const labels = metadata.labels ?? {};
      const uid = metadata.uid;
      if (
        !uid ||
        labels[TESTCASE_CACHE_LABEL] !== "index" ||
        labels[TESTCASE_KEY_LABEL] !== set.key ||
        labels[TESTCASE_ROLE_LABEL] !== set.role ||
        index.data?.[TESTCASE_LAYOUT_KEY] !== set.layout
      )
        throw new SandboxInfrastructureError(
          `Testcase cache ${namespace}/${set.indexName} does not match its content hash.`,
        );
      if (metadata.deletionTimestamp) {
        await wait(POLL_MS, undefined, { signal });
        continue;
      }
      const names = testcaseShardNames(set, uid);
      const age = this.now() - testcaseLastUsedAt(index);
      if (metadata.annotations?.[TESTCASE_STATE_ANNOTATION] === "ready") {
        if (
          age < TESTCASE_TOUCH_INTERVAL_MS ||
          (await this.annotate(set.indexName, metadata.resourceVersion, namespace, {
            [TESTCASE_LAST_USED_ANNOTATION]: new Date(this.now()).toISOString(),
          }))
        )
          return names;
        continue;
      }
      if (!created && age < TESTCASE_TAKEOVER_MS) {
        await wait(POLL_MS, undefined, { signal });
        continue;
      }
      await this.createShards(set, uid, namespace, signal);
      if (
        await this.annotate(set.indexName, metadata.resourceVersion, namespace, {
          [TESTCASE_STATE_ANNOTATION]: "ready",
          [TESTCASE_LAST_USED_ANNOTATION]: new Date(this.now()).toISOString(),
        })
      )
        return names;
    }
    throw new SandboxTransientInfrastructureError(
      `Testcase cache ${namespace}/${set.indexName} was not ready within ${String(ENSURE_TIMEOUT_MS / 1000)}s.`,
    );
  }
}
