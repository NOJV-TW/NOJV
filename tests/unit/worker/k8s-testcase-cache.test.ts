import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { materializePayload } from "../../../apps/sandbox-runner/src/payload-materializer";
import {
  buildPayloadConfigMaps,
  encodeShard,
  sha256Hex,
} from "../../../apps/worker/src/sandbox/kubernetes/payload";
import {
  KubernetesTestcaseCache,
  planTestcaseSet,
  testcaseEntry,
  testcaseManifestFile,
  TESTCASE_LAST_USED_ANNOTATION,
  TESTCASE_TAKEOVER_MS,
  testcaseShardNames,
  type TestcaseRole,
  type TestcaseSet,
} from "../../../apps/worker/src/sandbox/kubernetes/testcase-cache";
import {
  collectOrphanRunPayloads,
  collectTestcaseCache,
  ORPHAN_PAYLOAD_MIN_AGE_MS,
  TESTCASE_CACHE_IDLE_TTL_MS,
} from "../../../apps/worker/src/sandbox/kubernetes/testcase-cache-gc";
import { buildJudgeStage } from "../../../apps/worker/src/sandbox/shared/stage-payload";
import { withTestcaseCache } from "./k8s-testcase-cache-fake";

const NAMESPACE = "nojv-sandbox";

function set(role: TestcaseRole, texts: string[]): TestcaseSet {
  return planTestcaseSet(role, texts.map(testcaseEntry));
}

function stored(content: string) {
  const body = Buffer.from(content, "utf8");
  return {
    key: `testcases/${sha256Hex(body)}`,
    sha256: sha256Hex(body),
    size: body.byteLength,
  };
}

function encodeAll(target: TestcaseSet) {
  return target.shards.map((shard) =>
    encodeShard(shard, ({ item }) => Buffer.from(item.text as string, "utf8")),
  );
}

function fakeCache() {
  return withTestcaseCache({
    createNamespacedConfigMap: vi.fn(async () => undefined),
  } as Record<string, any>);
}

describe("testcase set naming", () => {
  it("is stable across order and duplicates, and changes with content or role", () => {
    const a = set("input", ["1\n", "2\n"]);
    const b = set("input", ["2\n", "1\n", "1\n"]);
    expect(b.key).toBe(a.key);
    expect(b.layout).toBe(a.layout);
    expect(set("input", ["3\n"]).key).not.toBe(a.key);
    expect(set("answer", ["1\n", "2\n"]).key).not.toBe(a.key);
    expect(set("input", ["1\n", "2\n"]).key).toBe(a.key);
    expect(a.indexName).toMatch(/^tc-[0-9a-f]{32}$/);
    const [shard] = testcaseShardNames(a, "0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(shard).toBe(`${a.indexName}-0f8fad5bd9cb469f-0`);
    expect(shard!.length).toBeLessThanOrEqual(63);
  });

  it("derives the same set from pinned pointers without their contents", () => {
    const contents = ["x".repeat(900_000), "y\n"];
    const fromText = set("answer", contents);
    const fromPointers = planTestcaseSet(
      "answer",
      contents.map((content) => testcaseEntry(stored(content))),
    );
    expect(fromPointers.key).toBe(fromText.key);
    expect(fromPointers.layout).toBe(fromText.layout);
  });

  it("uses chunk keys the existing runner accepts and that never collide with stage chunks", () => {
    const inputs = set("input", ["x".repeat(1_600_000)]);
    const answers = set("answer", ["y".repeat(10)]);
    const chunks = [...inputs.files.values(), ...answers.files.values()].flatMap(
      ({ chunks }) => chunks,
    );
    for (const chunk of chunks) expect(chunk).toMatch(/^chunk-\d{21}$/);
    expect(new Set(chunks).size).toBe(chunks.length);
    expect(inputs.shardCount).toBe(3);
  });

  it("assigns checker inputs and answers to separate roles outside the stage payload", () => {
    const judge = buildJudgeStage({
      submissionId: "s",
      sourceCode: "",
      language: "python",
      problemType: "full_source",
      testcases: [{ index: 3, input: "in", output: "out", weight: 1, isSample: false }],
      judgeType: "checker",
      judgeConfig: { checkerScript: "accept()", checkerLanguage: "python" },
      limits: { timeoutMs: 1_000, memoryMb: 128 },
    });
    expect(Object.keys(judge.stage).sort()).toEqual(["config.json", "validator.py"]);
    expect(judge.testcases.map(({ path, role }) => [path, role])).toEqual([
      ["case-3-input.txt", "input"],
      ["case-3-answer.txt", "answer"],
    ]);
  });
});

describe("stage manifest over cached shards", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("materializes testcase files from cached shards and stage files from the stage payload", async () => {
    const stageData = { "config.json": '{"mode":"judge"}' };
    const testcases = [
      { path: "case-0-input.txt", role: "input" as const, text: "界".repeat(400_000) },
      { path: "case-1-input.txt", role: "input" as const, text: "2 3\n" },
      { path: "case-0-answer.txt", role: "answer" as const, text: "ok\n" },
      { path: "case-1-answer.txt", role: "answer" as const, text: "ok\n" },
    ];
    const sets = new Map<TestcaseRole, TestcaseSet>(
      (["input", "answer"] as const).map((role) => [
        role,
        set(
          role,
          testcases.filter((file) => file.role === role).map(({ text }) => text),
        ),
      ]),
    );
    const stage = buildPayloadConfigMaps(
      "judge-x-judge",
      NAMESPACE,
      stageData,
      testcases.map(({ path, role, text }) =>
        testcaseManifestFile(path, testcaseEntry(text), sets.get(role)),
      ),
    );
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nojv-cache-"));
    directories.push(root);
    const payloadDir = path.join(root, "payload");
    const submissionDir = path.join(root, "submission");
    await fs.mkdir(payloadDir);
    await fs.mkdir(submissionDir);
    const projected = [
      ...stage.map((configMap) => ({ ...configMap.data, ...configMap.binaryData })),
      ...[...sets.values()].flatMap(encodeAll),
    ];
    for (const source of projected)
      for (const [key, value] of Object.entries(source)) {
        await expect(fs.access(path.join(payloadDir, key))).rejects.toThrow();
        await fs.writeFile(
          path.join(payloadDir, key),
          key === "payload-manifest.json" ? value : Buffer.from(value, "base64"),
        );
      }

    await materializePayload({ payloadDir, submissionDir });

    for (const [name, content] of [
      ...Object.entries(stageData),
      ...testcases.map(({ path: file, text }) => [file, text] as const),
    ])
      expect(await fs.readFile(path.join(submissionDir, name), "utf8")).toBe(content);
  });
});

describe("KubernetesTestcaseCache.ensure", () => {
  it("creates each object once for concurrent callers and reuses it afterwards", async () => {
    const fake = fakeCache();
    const cache = new KubernetesTestcaseCache(fake.coreApi as never);
    const target = set("input", ["x".repeat(1_600_000)]);
    const signal = new AbortController().signal;

    const names = await Promise.all([
      cache.ensure(target, NAMESPACE, signal),
      cache.ensure(target, NAMESPACE, signal),
      cache.ensure(target, NAMESPACE, signal),
    ]);
    expect(new Set(names.map((list) => list.join()))).toHaveProperty("size", 1);
    expect(fake.createdNames.sort()).toEqual([target.indexName, ...names[0]!].sort());

    const creates = fake.coreApi.createNamespacedConfigMap.mock.calls.length;
    expect(await cache.ensure(target, NAMESPACE, signal)).toEqual(names[0]);
    expect(fake.coreApi.createNamespacedConfigMap.mock.calls.length).toBe(creates);
    const index = fake.cached.get(target.indexName)!;
    expect(index.metadata.annotations?.["nojv-testcase-state"]).toBe("ready");
    for (const name of names[0]!)
      expect(fake.cached.get(name)?.metadata.ownerReferences).toEqual([
        expect.objectContaining({ name: target.indexName, uid: index.metadata.uid }),
      ]);
  });

  it("refuses an existing object whose content does not match its name", async () => {
    const fake = fakeCache();
    const cache = new KubernetesTestcaseCache(fake.coreApi as never);
    const target = set("answer", ["42\n"]);
    const forged = set("answer", ["41\n"]);
    await fake.coreApi.createNamespacedConfigMap({
      namespace: NAMESPACE,
      body: {
        metadata: {
          name: target.indexName,
          labels: {
            "nojv-testcase-cache": "index",
            "nojv-testcase-key": target.key,
            "nojv-testcase-role": "answer",
          },
          annotations: { "nojv-testcase-state": "ready" },
        },
        data: { "layout.json": forged.layout },
      },
    });

    await expect(
      cache.ensure(target, NAMESPACE, new AbortController().signal),
    ).rejects.toMatchObject({ name: "SandboxInfrastructureError" });
    expect(fake.createdNames).toEqual([target.indexName]);
  });

  it("takes over a pending set whose creator stopped", async () => {
    const fake = fakeCache();
    let now = Date.now();
    const target = set("input", ["abc"]);
    const stalled = new KubernetesTestcaseCache(
      {
        ...fake.coreApi,
        createNamespacedConfigMap: async (args: any) => {
          if (args.body.metadata.name !== target.indexName) throw new Error("creator crashed");
          return fake.coreApi.createNamespacedConfigMap(args);
        },
      } as never,
      { now: () => now },
    );
    await expect(
      stalled.ensure(target, NAMESPACE, new AbortController().signal),
    ).rejects.toThrow("creator crashed");

    now += TESTCASE_TAKEOVER_MS + 1;
    const names = await new KubernetesTestcaseCache(fake.coreApi as never, {
      now: () => now,
    }).ensure(target, NAMESPACE, new AbortController().signal);
    expect(names).toHaveLength(1);
    expect(fake.cached.get(target.indexName)?.metadata.annotations).toMatchObject({
      "nojv-testcase-state": "ready",
    });
  });

  it("touches a stale ready set before using it", async () => {
    const fake = fakeCache();
    let now = Date.now();
    const cache = new KubernetesTestcaseCache(fake.coreApi as never, { now: () => now });
    const target = set("input", ["abc"]);
    await cache.ensure(target, NAMESPACE, new AbortController().signal);
    const before = fake.cached.get(target.indexName)!.metadata.resourceVersion;
    now += 60 * 60_000;
    await cache.ensure(target, NAMESPACE, new AbortController().signal);
    const index = fake.cached.get(target.indexName)!;
    expect(index.metadata.resourceVersion).not.toBe(before);
    expect(index.metadata.annotations?.[TESTCASE_LAST_USED_ANNOTATION]).toBe(
      new Date(now).toISOString(),
    );
  });
});

describe("KubernetesTestcaseCache memory", () => {
  it("reads each pinned object once on a miss, with bounded concurrency, and never on a hit", async () => {
    const contents = Array.from({ length: 24 }, (_, index) =>
      String(index % 10).repeat(400_000 + index),
    );
    const objects = contents.map(stored);
    const bodies = new Map(objects.map((object, index) => [object.key, contents[index]!]));
    const reads: string[] = [];
    let active = 0;
    let peak = 0;
    const read = vi.fn(async ({ key }: { key: string }) => {
      reads.push(key);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return Buffer.from(bodies.get(key)!, "utf8");
    });
    const fake = fakeCache();
    const cache = new KubernetesTestcaseCache(fake.coreApi as never, { read });
    const target = planTestcaseSet("input", objects.map(testcaseEntry));
    const signal = new AbortController().signal;

    const [names] = await Promise.all([
      cache.ensure(target, NAMESPACE, signal),
      cache.ensure(target, NAMESPACE, signal),
    ]);
    expect(reads.sort()).toEqual(objects.map(({ key }) => key).sort());
    expect(peak).toBeLessThanOrEqual(12);

    reads.length = 0;
    expect(
      await new KubernetesTestcaseCache(fake.coreApi as never, { read }).ensure(
        target,
        NAMESPACE,
        signal,
      ),
    ).toEqual(names);
    expect(reads).toEqual([]);

    const restored = target.shards.flatMap((shard, index) => {
      const binaryData = fake.cached.get(names![index]!)!.binaryData!;
      return shard.map(({ key }) => Buffer.from(binaryData[key]!, "base64"));
    });
    expect(Buffer.concat(restored).toString("utf8")).toBe(
      [...contents].sort((a, b) => stored(a).sha256.localeCompare(stored(b).sha256)).join(""),
    );
  });

  it("rejects a pinned object whose bytes do not match its pointer", async () => {
    const fake = fakeCache();
    const cache = new KubernetesTestcaseCache(fake.coreApi as never, {
      read: async () => Buffer.from("abcd"),
    });
    await expect(
      cache.ensure(
        planTestcaseSet("answer", [testcaseEntry(stored("abc"))]),
        NAMESPACE,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ name: "SandboxInfrastructureError" });
  });
});

describe("collectTestcaseCache", () => {
  function index(name: string, lastUsed: number) {
    return {
      metadata: {
        name,
        uid: `${name}-uid`,
        resourceVersion: "7",
        annotations: { [TESTCASE_LAST_USED_ANNOTATION]: new Date(lastUsed).toISOString() },
      },
    };
  }

  it("deletes idle sets with preconditions and keeps fresh or mounted ones", async () => {
    const now = Date.now();
    const idle = now - TESTCASE_CACHE_IDLE_TTL_MS - 1;
    const stale = `tc-${"a".repeat(32)}`;
    const mounted = `tc-${"b".repeat(32)}`;
    const fresh = `tc-${"c".repeat(32)}`;
    const coreApi = {
      listNamespacedConfigMap: vi.fn(async () => ({
        items: [index(stale, idle), index(mounted, idle), index(fresh, now - 60_000)],
      })),
      listNamespacedPod: vi.fn(async () => ({
        items: [
          {
            spec: {
              volumes: [
                {
                  name: "run-payload",
                  projected: {
                    sources: [
                      { configMap: { name: "judge-x-run-pm" } },
                      { configMap: { name: `${mounted}-0f8fad5bd9cb469f-3` } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      })),
      deleteNamespacedConfigMap: vi.fn(async () => undefined),
    };

    const result = await collectTestcaseCache(coreApi as never, NAMESPACE, now);

    expect(result).toEqual({ deleted: [stale], inUse: [mounted] });
    expect(coreApi.listNamespacedConfigMap).toHaveBeenCalledWith({
      namespace: NAMESPACE,
      labelSelector: "nojv-testcase-cache=index",
    });
    expect(coreApi.deleteNamespacedConfigMap).toHaveBeenCalledExactlyOnceWith({
      name: stale,
      namespace: NAMESPACE,
      body: {
        propagationPolicy: "Background",
        preconditions: { uid: `${stale}-uid`, resourceVersion: "7" },
      },
    });
  });

  it("skips a set that a stage touched after it was listed", async () => {
    const now = Date.now();
    const name = `tc-${"d".repeat(32)}`;
    const coreApi = {
      listNamespacedConfigMap: vi.fn(async () => ({
        items: [index(name, now - TESTCASE_CACHE_IDLE_TTL_MS - 1)],
      })),
      listNamespacedPod: vi.fn(async () => ({ items: [] })),
      deleteNamespacedConfigMap: vi.fn(async () => {
        throw Object.assign(new Error("Conflict"), { code: 409 });
      }),
    };
    expect(await collectTestcaseCache(coreApi as never, NAMESPACE, now)).toEqual({
      deleted: [],
      inUse: [],
    });
  });
});

describe("collectOrphanRunPayloads", () => {
  const orphanRun = "11111111-1111-4111-8111-111111111111";
  const jobRun = "22222222-2222-4222-8222-222222222222";
  const podRun = "33333333-3333-4333-8333-333333333333";

  function object(name: string, createdAt: number, runId?: string) {
    return {
      metadata: {
        name,
        uid: `${name}-uid`,
        creationTimestamp: new Date(createdAt),
        ...(runId ? { labels: { "nojv-run-id": runId } } : {}),
      },
    };
  }

  function selected<T extends { metadata: { labels?: Record<string, string> } }>(
    items: T[],
    { labelSelector }: { labelSelector?: string },
  ) {
    return {
      items: items.filter((item) => labelSelector && item.metadata.labels?.[labelSelector]),
    };
  }

  function fakeApis(now: number) {
    const old = now - ORPHAN_PAYLOAD_MIN_AGE_MS - 1;
    const configMaps = [
      object(`judge-${orphanRun}-run-pm`, old, orphanRun),
      object(`judge-${orphanRun}-judge-pm`, old, orphanRun),
      object(`judge-${orphanRun}-judge-0`, now - ORPHAN_PAYLOAD_MIN_AGE_MS + 60_000, orphanRun),
      object(`judge-${jobRun}-run-pm`, old, jobRun),
      object(`judge-${podRun}-sol-pm`, old, podRun),
      object(`tc-${"a".repeat(32)}`, old),
      object(`tc-${"b".repeat(32)}`, old, orphanRun),
      object("kube-root-ca.crt", old),
    ];
    const coreApi = {
      listNamespacedConfigMap: vi.fn(
        async (request: { labelSelector?: string }, _options?: unknown) =>
          selected(configMaps, request),
      ),
      listNamespacedPod: vi.fn(
        async (request: { labelSelector?: string }, _options?: unknown) =>
          selected([object(`judge-${podRun}-abcde`, old, podRun)], request),
      ),
      deleteNamespacedConfigMap: vi.fn(async (_request: unknown) => undefined),
    };
    const batchApi = {
      listNamespacedJob: vi.fn(
        async (request: { labelSelector?: string }, _options?: unknown) =>
          selected([object(`judge-${jobRun}`, old, jobRun)], request),
      ),
    };
    return { coreApi, batchApi };
  }

  it("deletes old payloads of runs without a Job or Pod, with uid preconditions", async () => {
    const now = Date.now();
    const { coreApi, batchApi } = fakeApis(now);

    const deleted = await collectOrphanRunPayloads(
      coreApi as never,
      batchApi as never,
      NAMESPACE,
      now,
    );

    expect(deleted).toEqual([`judge-${orphanRun}-run-pm`, `judge-${orphanRun}-judge-pm`]);
    expect(coreApi.deleteNamespacedConfigMap.mock.calls).toEqual(
      deleted.map((name) => [
        { name, namespace: NAMESPACE, body: { preconditions: { uid: `${name}-uid` } } },
      ]),
    );
  });

  it("lists only run-labelled metadata, never ConfigMap data", async () => {
    const { coreApi, batchApi } = fakeApis(Date.now());
    await collectOrphanRunPayloads(coreApi as never, batchApi as never, NAMESPACE);

    const lists = [
      ...coreApi.listNamespacedConfigMap.mock.calls,
      ...coreApi.listNamespacedPod.mock.calls,
      ...batchApi.listNamespacedJob.mock.calls,
    ];
    expect(lists).toHaveLength(3);
    for (const [request, options] of lists) {
      expect(request).toEqual({ namespace: NAMESPACE, labelSelector: "nojv-run-id" });
      const headers = new Map<string, string>();
      for (const middleware of (options as { middleware: { pre: (r: unknown) => unknown }[] })
        .middleware)
        middleware.pre({
          setHeaderParam: (key: string, value: string) => headers.set(key, value),
        });
      expect(headers.get("Accept")).toBe(
        "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1",
      );
    }
  });

  it("treats a payload that was replaced or already deleted as handled", async () => {
    const now = Date.now();
    const { coreApi, batchApi } = fakeApis(now);
    coreApi.deleteNamespacedConfigMap
      .mockRejectedValueOnce(Object.assign(new Error("Conflict"), { code: 409 }))
      .mockRejectedValueOnce(Object.assign(new Error("Not Found"), { code: 404 }));

    expect(
      await collectOrphanRunPayloads(coreApi as never, batchApi as never, NAMESPACE, now),
    ).toEqual([]);
  });

  it("reads an empty metadata list, which the API server returns as null items", async () => {
    const now = Date.now();
    const { coreApi, batchApi } = fakeApis(now);
    coreApi.listNamespacedPod.mockResolvedValueOnce({ items: null } as never);

    expect(
      await collectOrphanRunPayloads(coreApi as never, batchApi as never, NAMESPACE, now),
    ).toEqual([
      `judge-${orphanRun}-run-pm`,
      `judge-${orphanRun}-judge-pm`,
      `judge-${podRun}-sol-pm`,
    ]);
  });
});
