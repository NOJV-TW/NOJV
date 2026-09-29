import { vi } from "vitest";

export interface CachedConfigMap {
  apiVersion?: string;
  kind?: string;
  metadata: {
    name: string;
    uid: string;
    resourceVersion: string;
    creationTimestamp: Date;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: { name: string; uid: string }[];
    deletionTimestamp?: Date;
  };
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
}

export function withTestcaseCache<T extends Record<string, any>>(coreApi: T) {
  const cached = new Map<string, CachedConfigMap>();
  const createdNames: string[] = [];
  let serial = 0;
  const createStage = coreApi.createNamespacedConfigMap as (args: any) => Promise<unknown>;
  const api = coreApi as Record<string, unknown>;
  api.createNamespacedConfigMap = vi.fn(async (args: any) => {
    const name = String(args.body.metadata.name);
    if (!name.startsWith("tc-")) return createStage(args);
    if (cached.has(name)) throw Object.assign(new Error("AlreadyExists"), { code: 409 });
    serial += 1;
    const body: CachedConfigMap = {
      ...args.body,
      metadata: {
        ...args.body.metadata,
        uid: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
        resourceVersion: String(serial),
        creationTimestamp: new Date(),
      },
    };
    cached.set(name, body);
    createdNames.push(name);
    return structuredClone(body);
  });
  api.readNamespacedConfigMap = vi.fn(async ({ name }: { name: string }) => {
    const body = cached.get(name);
    if (!body) throw Object.assign(new Error("NotFound"), { code: 404 });
    return structuredClone(body);
  });
  api.patchNamespacedConfigMap = vi.fn(async ({ name, body }: any) => {
    const current = cached.get(name);
    if (!current) throw Object.assign(new Error("NotFound"), { code: 404 });
    if (
      body.metadata.resourceVersion &&
      body.metadata.resourceVersion !== current.metadata.resourceVersion
    )
      throw Object.assign(new Error("Conflict"), { code: 409 });
    serial += 1;
    current.metadata = {
      ...current.metadata,
      annotations: { ...current.metadata.annotations, ...body.metadata.annotations },
      resourceVersion: String(serial),
    };
    return structuredClone(current);
  });
  return { coreApi, cached, createdNames };
}
