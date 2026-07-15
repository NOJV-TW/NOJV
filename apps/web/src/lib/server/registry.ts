import type { registryDomain } from "@nojv/application";

import { getWebEnv } from "./env";
import { isRegistryTokenConfigured, signRegistryToken } from "./registry-token";

// Index/manifest-list types must come first so a multi-arch tag resolves to the
// index digest (the tag's real target). Without them the registry's legacy
// fallback returns a platform child manifest, and deleting that child digest
// leaves the tag pointing at a now-broken index.
const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

const CATALOG_ACCESS: registryDomain.RegistryAccessEntry[] = [
  { type: "registry", name: "catalog", actions: ["*"] },
  { type: "repository", name: "*", actions: ["*"] },
];

function repoAccess(repo: string): registryDomain.RegistryAccessEntry[] {
  return [{ type: "repository", name: repo, actions: ["pull", "delete"] }];
}

export function isRegistryConfigured(): boolean {
  return isRegistryTokenConfigured() && getWebEnv().REGISTRY_INTERNAL_URL !== "";
}

function baseUrl(): string {
  return getWebEnv().REGISTRY_INTERNAL_URL.replace(/\/+$/, "");
}

async function mintToken(access: registryDomain.RegistryAccessEntry[]): Promise<string> {
  const { token } = await signRegistryToken("admin", getWebEnv().REGISTRY_PUBLIC_HOST, access);
  return token;
}

async function registryFetch(
  path: string,
  access: registryDomain.RegistryAccessEntry[],
  init: RequestInit = {},
): Promise<Response> {
  if (!isRegistryConfigured()) throw new Error("Registry is not configured.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await mintToken(access)}`);
  return fetch(`${baseUrl()}${path}`, { ...init, headers });
}

export async function listRepositories(): Promise<string[]> {
  const res = await registryFetch("/v2/_catalog?n=1000", CATALOG_ACCESS);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`registry catalog request failed: ${String(res.status)}`);
  const body = (await res.json()) as { repositories?: string[] };
  return body.repositories ?? [];
}

export async function listTags(repo: string): Promise<string[]> {
  const res = await registryFetch(`/v2/${repo}/tags/list?n=1000`, repoAccess(repo));
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`registry tags request failed: ${String(res.status)}`);
  const body = (await res.json()) as { tags?: string[] | null };
  return body.tags ?? [];
}

export interface ManifestInfo {
  digest: string | null;
  size: number | null;
}

export async function getManifestDigestAndSize(
  repo: string,
  reference: string,
): Promise<ManifestInfo> {
  const access = repoAccess(repo);
  const head = await registryFetch(`/v2/${repo}/manifests/${reference}`, access, {
    method: "HEAD",
    headers: { Accept: MANIFEST_ACCEPT },
  });
  if (head.status === 404) return { digest: null, size: null };
  if (!head.ok) throw new Error(`registry manifest head failed: ${String(head.status)}`);
  const digest = head.headers.get("docker-content-digest");

  const get = await registryFetch(`/v2/${repo}/manifests/${reference}`, access, {
    method: "GET",
    headers: { Accept: MANIFEST_ACCEPT },
  });
  let size: number | null = null;
  if (get.ok) {
    const manifest = (await get.json()) as {
      config?: { size?: number };
      layers?: { size?: number }[];
    };
    if (manifest.config !== undefined || manifest.layers !== undefined) {
      const configSize = manifest.config?.size ?? 0;
      const layersSize = (manifest.layers ?? []).reduce(
        (sum, layer) => sum + (layer.size ?? 0),
        0,
      );
      size = configSize + layersSize;
    }
  }
  return { digest, size };
}

export async function deleteManifest(repo: string, digest: string): Promise<void> {
  const res = await registryFetch(`/v2/${repo}/manifests/${digest}`, repoAccess(repo), {
    method: "DELETE",
  });
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`registry manifest delete failed: ${String(res.status)}`);
}
