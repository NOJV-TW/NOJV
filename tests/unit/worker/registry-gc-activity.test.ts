import { describe, expect, it, vi } from "vitest";

vi.mock("@temporalio/activity", () => ({
  heartbeat: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  buildRegistryGcJobManifest,
  resolveRegistryGcConfig,
  runRegistryGarbageCollect,
  type RegistryGcClients,
  type RegistryGcConfig,
} from "../../../apps/worker/src/activities/registry";

const config: RegistryGcConfig = {
  namespace: "nojv",
  image: "registry:2.8.3",
  configMapName: "nojv-registry-config",
  runtimeSecretName: "nojv-runtime-secrets",
};

describe("buildRegistryGcJobManifest", () => {
  const job = buildRegistryGcJobManifest("registry-gc-test", config);
  const container = job.spec?.template.spec?.containers[0];

  it("targets the configured namespace and registry image", () => {
    expect(job.metadata?.namespace).toBe("nojv");
    expect(container?.image).toBe("registry:2.8.3");
  });

  it("runs the non-destructive garbage-collect command against the mounted config", () => {
    expect(container?.command).toBeUndefined();
    expect(container?.args).toEqual([
      "garbage-collect",
      "--delete-untagged=false",
      "/etc/distribution/config.yml",
    ]);
    const configMount = container?.volumeMounts?.find((m) => m.name === "config");
    expect(configMount?.mountPath).toBe("/etc/distribution/config.yml");
    expect(configMount?.subPath).toBe("config.yml");
    const configVolume = job.spec?.template.spec?.volumes?.find((v) => v.name === "config");
    expect(configVolume?.configMap?.name).toBe("nojv-registry-config");
  });

  it("injects the S3 credentials from the runtime secret", () => {
    const access = container?.env?.find((e) => e.name === "REGISTRY_STORAGE_S3_ACCESSKEY");
    const secret = container?.env?.find((e) => e.name === "REGISTRY_STORAGE_S3_SECRETKEY");
    expect(access?.valueFrom?.secretKeyRef).toEqual({
      name: "nojv-runtime-secrets",
      key: "S3_ACCESS_KEY",
    });
    expect(secret?.valueFrom?.secretKeyRef).toEqual({
      name: "nojv-runtime-secrets",
      key: "S3_SECRET_KEY",
    });
  });

  it("does not retry pods (backoffLimit 0, restartPolicy Never)", () => {
    expect(job.spec?.backoffLimit).toBe(0);
    expect(job.spec?.template.spec?.restartPolicy).toBe("Never");
  });
});

describe("resolveRegistryGcConfig", () => {
  it("reads overrides from env and falls back to chart defaults", () => {
    expect(resolveRegistryGcConfig({ REGISTRY_GC_NAMESPACE: "custom-ns" }).namespace).toBe(
      "custom-ns",
    );
    const defaults = resolveRegistryGcConfig({});
    expect(defaults.namespace).toBe("nojv");
    expect(defaults.image).toBe(
      "registry:2.8.3@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373",
    );
    expect(defaults.configMapName).toBe("nojv-registry-config");
    expect(defaults.runtimeSecretName).toBe("nojv-runtime-secrets");
  });
});

function fakeClients(jobStatus: Record<string, unknown>): {
  clients: RegistryGcClients;
  createNamespacedJob: ReturnType<typeof vi.fn>;
  deleteNamespacedJob: ReturnType<typeof vi.fn>;
} {
  const createNamespacedJob = vi.fn(async () => {});
  const deleteNamespacedJob = vi.fn(async () => {});
  const clients = {
    batchApi: {
      createNamespacedJob,
      readNamespacedJob: vi.fn(async () => ({ status: jobStatus })),
      deleteNamespacedJob,
    },
    coreApi: {
      listNamespacedPod: vi.fn(async () => ({
        items: [{ metadata: { name: "registry-gc-pod" } }],
      })),
      readNamespacedPodLog: vi.fn(async () => "0 blobs eligible for deletion"),
    },
  } as unknown as RegistryGcClients;
  return { clients, createNamespacedJob, deleteNamespacedJob };
}

describe("runRegistryGarbageCollect", () => {
  it("creates the Job, returns the pod log tail, and cleans up on success", async () => {
    const { clients, createNamespacedJob, deleteNamespacedJob } = fakeClients({ succeeded: 1 });

    const logs = await runRegistryGarbageCollect(
      { triggeredByUserId: "usr_admin" },
      clients,
      config,
    );

    expect(logs).toBe("0 blobs eligible for deletion");
    expect(createNamespacedJob).toHaveBeenCalledTimes(1);
    expect(deleteNamespacedJob).toHaveBeenCalledTimes(1);
  });

  it("throws when the Job fails and still cleans up", async () => {
    const { clients, deleteNamespacedJob } = fakeClients({ failed: 1 });

    await expect(
      runRegistryGarbageCollect({ triggeredByUserId: "usr_admin" }, clients, config),
    ).rejects.toThrow(/failed/);
    expect(deleteNamespacedJob).toHaveBeenCalledTimes(1);
  });
});
