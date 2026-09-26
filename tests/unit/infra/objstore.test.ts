import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const chart = "infra/charts/nojv";
const local = [
  "--set",
  "image.allowUnpinnedLocalBuilds=true",
  "--set-string",
  "image.registry=",
  "--set-string",
  "image.repositoryPrefix=",
  "--set-string",
  "image.tag=local",
];
const enabled = ["--set", "storage.objectStore.enabled=true"];
const production = [
  "-f",
  `${chart}/values-single-machine.yaml`,
  "-f",
  "tests/fixtures/helm/immutable-image-digests.yaml",
  "-f",
  "tests/fixtures/helm/production-external-backups.yaml",
];
const gke = [
  "-f",
  `${chart}/values-gke.yaml`,
  "-f",
  "tests/fixtures/helm/immutable-image-digests.yaml",
  "-f",
  "tests/fixtures/helm/gke-production-config.yaml",
  "-f",
  "tests/fixtures/helm/production-external-backups.yaml",
];

function render(args: string[]): string {
  return execFileSync("helm", ["template", "nojv", chart, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function documents(rendered: string): string[] {
  return rendered.split(/^---$/mu);
}

function documentWith(rendered: string, pattern: RegExp): string {
  const document = documents(rendered).find((candidate) => pattern.test(candidate));
  if (!document) throw new Error(`Rendered manifest missing ${pattern}`);
  return document;
}

const objstoreDeployment = /kind: Deployment\nmetadata:\n {2}name: nojv-objstore\n/u;
const objstoreHook = /name: nojv-objstore-bucket-init\n/u;
const minioHook = /name: nojv-registry-bucket-init\n/u;

describe("Versity object store alongside MinIO", () => {
  it("is off by default and never renders without in-cluster storage", () => {
    expect(render(local)).not.toContain("nojv-objstore");
    expect(render([...gke, ...enabled])).not.toContain("nojv-objstore");
  });

  it("renders a hardened, digest-pinned gateway on the MinIO S3 port", () => {
    const deployment = documentWith(render([...local, ...enabled]), objstoreDeployment);
    const values = readFileSync(join(repoRoot, chart, "values.yaml"), "utf8");
    const image = /image: (ghcr\.io\/versity\/versitygw:\S+)/u.exec(values)?.[1];

    expect(image).toMatch(/^ghcr\.io\/versity\/versitygw:v\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/u);
    expect(deployment).toContain(`image: ${image}`);
    expect(deployment).toContain("type: Recreate");
    expect(deployment).toContain('args: ["posix", "/data"]');
    expect(deployment).toMatch(/name: VGW_PORT\n\s+value: ":9000"/u);
    expect(deployment).toMatch(/name: VGW_HEALTH\n\s+value: \/health/u);
    expect(deployment).toMatch(/name: ROOT_ACCESS_KEY\n[\s\S]*?key: S3_ACCESS_KEY/u);
    expect(deployment).toMatch(/name: ROOT_SECRET_KEY\n[\s\S]*?key: S3_SECRET_KEY/u);
    expect(deployment).toContain("runAsNonRoot: true");
    expect(deployment).toContain("runAsUser: 1000");
    expect(deployment).toContain("type: RuntimeDefault");
    expect(deployment).toContain("allowPrivilegeEscalation: false");
    expect(deployment).toContain("readOnlyRootFilesystem: true");
    expect(deployment).toContain('drop: ["ALL"]');
    expect(deployment.match(/path: \/health/gu)).toHaveLength(2);
    expect(deployment).toContain("claimName: nojv-objstore");
    expect(deployment).toMatch(/limits:\n\s+cpu: 500m\n\s+memory: 256Mi/u);
  });

  it("keeps its own PVC on a retained class and exposes only a ClusterIP Service", () => {
    const rendered = render([...local, ...enabled]);
    const pvc = documentWith(
      rendered,
      /kind: PersistentVolumeClaim\nmetadata:\n {2}name: nojv-objstore\n/u,
    );
    const storageClass = documentWith(
      rendered,
      /kind: StorageClass\nmetadata:\n {2}name: nojv-objstore-retain\n/u,
    );
    const service = documentWith(
      rendered,
      /kind: Service\nmetadata:\n {2}name: nojv-objstore\n/u,
    );

    expect(pvc).toContain('"helm.sh/resource-policy": keep');
    expect(pvc).toContain("storageClassName: nojv-objstore-retain");
    expect(storageClass).toContain('"helm.sh/resource-policy": keep');
    expect(storageClass).toContain("reclaimPolicy: Retain");
    expect(storageClass).toContain("provisioner: rancher.io/local-path");
    expect(service).toContain("type: ClusterIP");
    expect(service).toMatch(/port: 9000\n\s+targetPort: s3/u);
    expect(service).not.toMatch(/nodePort|LoadBalancer/u);
  });

  it("uses a pre-provisioned class without creating one", () => {
    const rendered = render([
      ...local,
      ...enabled,
      "--set",
      "storage.objectStore.storageClass.create=false",
      "--set-string",
      "storage.objectStore.storageClass.name=platform-retain",
    ]);

    expect(rendered).not.toContain("name: nojv-objstore-retain");
    expect(rendered).toContain("storageClassName: platform-retain");
  });

  it("creates both buckets on the gateway with a pinned rclone hook", () => {
    const hook = documentWith(render([...local, ...enabled]), objstoreHook);

    expect(hook).toContain('"helm.sh/hook": post-install,post-upgrade');
    expect(hook).toMatch(/image: ghcr\.io\/rclone\/rclone:\S+@sha256:[a-f0-9]{64}/u);
    expect(hook).toContain('rclone mkdir "objstore:$bucket"');
    expect(hook).toMatch(/name: BUCKETS\n\s+value: "nojv nojv-registry"/u);
    expect(hook).toContain('value: "http://nojv-objstore.nojv.svc:9000"');
    expect(hook).toContain("readOnlyRootFilesystem: true");
  });

  it("deploys in production next to MinIO while everything still uses MinIO", () => {
    const rendered = render(production);
    const registryConfig = documentWith(rendered, /name: nojv-registry-config\n/u);
    const mirror = documentWith(rendered, /kind: CronJob\n/u);

    expect(rendered).toMatch(objstoreDeployment);
    expect(rendered).toMatch(/kind: Deployment\nmetadata:\n {2}name: nojv-minio\n/u);
    expect(registryConfig).toContain(
      'regionendpoint: "http://nojv-minio.nojv.svc.cluster.local:9000"',
    );
    expect(documentWith(rendered, minioHook)).toContain(
      'value: "http://nojv-minio.nojv.svc:9000"',
    );
    expect(mirror).toContain('value: "http://nojv-minio.nojv.svc:9000"');
  });

  it("moves the registry, its bucket hook and the mirror source together on cut-over", () => {
    const rendered = render([...production, "--set-string", "storage.active=objstore"]);

    expect(documentWith(rendered, /name: nojv-registry-config\n/u)).toContain(
      'regionendpoint: "http://nojv-objstore.nojv.svc.cluster.local:9000"',
    );
    expect(rendered).not.toMatch(minioHook);
    expect(documentWith(rendered, /kind: CronJob\n/u)).toMatch(
      /RCLONE_CONFIG_SRC_PROVIDER\n\s+value: Other\n\s+- name: RCLONE_CONFIG_SRC_ENDPOINT\n\s+value: "http:\/\/nojv-objstore\.nojv\.svc:9000"/u,
    );
  });

  it.each([
    [
      ["--set-string", "storage.active=objstore"],
      /requires storage\.objectStore\.enabled=true/u,
    ],
    [["--set-string", "storage.active=s3"], /storage\.active must be minio or objstore/u],
  ])("refuses an unusable active store %j", (args, message) => {
    const result = spawnSync("helm", ["template", "nojv", chart, ...local, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(message);
  });
});
