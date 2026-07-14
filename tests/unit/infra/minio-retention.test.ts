import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const chart = "infra/charts/nojv";

function render(extraArgs: string[] = []): string {
  return execFileSync(
    "helm",
    [
      "template",
      "nojv",
      chart,
      "--set",
      "image.allowUnpinnedLocalBuilds=true",
      "--set-string",
      "image.registry=",
      "--set-string",
      "image.repositoryPrefix=",
      "--set-string",
      "image.tag=local",
      ...extraArgs,
    ],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function documentWith(rendered: string, marker: string): string {
  const document = rendered.split(/^---$/mu).find((candidate) => candidate.includes(marker));
  if (!document) throw new Error(`Rendered manifest missing ${marker}`);
  return document;
}

describe("MinIO persistent storage retention", () => {
  it("creates a retained StorageClass and keeps the PVC across Helm uninstall", () => {
    const rendered = render();
    const storageClass = documentWith(rendered, "kind: StorageClass");
    const pvc = documentWith(rendered, "kind: PersistentVolumeClaim");

    expect(storageClass).toContain('"helm.sh/resource-policy": keep');
    expect(storageClass).toContain("name: nojv-minio-retain");
    expect(storageClass).toContain("provisioner: rancher.io/local-path");
    expect(storageClass).toContain("reclaimPolicy: Retain");
    expect(storageClass).toContain("volumeBindingMode: WaitForFirstConsumer");
    expect(pvc).toContain('"helm.sh/resource-policy": keep');
    expect(pvc).toContain("storageClassName: nojv-minio-retain");
  });

  it("supports an explicitly named pre-provisioned retained class without creating one", () => {
    const rendered = render([
      "--set",
      "storage.minio.storageClass.create=false",
      "--set-string",
      "storage.minio.storageClass.name=platform-retain",
    ]);

    expect(rendered).not.toContain("kind: StorageClass");
    expect(documentWith(rendered, "kind: PersistentVolumeClaim")).toContain(
      "storageClassName: platform-retain",
    );
  });

  it("refuses in-cluster MinIO without an explicit retained class name", () => {
    expect(() =>
      render([
        "--set",
        "storage.minio.storageClass.create=false",
        "--set-string",
        "storage.minio.storageClass.name=",
      ]),
    ).toThrow(/storage\.minio\.storageClass\.name is required/u);
  });
});
