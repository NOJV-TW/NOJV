# Replace in-cluster MinIO

**Status:** Proposal for owner decision, no implementation · **Date:** 2026-09-27 · **Touches:** OPS-06, OPS-07, OPS-10, OPS-18, DAT-06, PRB-04, PRB-05

## Problem

Single-machine production runs `quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z@sha256:a1ea29…` for application objects and as the `registry:2` backend. The one-shot `quay.io/minio/mc` image also runs the registry bucket hook on every upgrade and the (disabled) mirror CronJob. Upstream has stopped:

| Date       | Event                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-10    | Community edition becomes source-only. No new binaries or images on Docker Hub or Quay ([GIGAZINE, 2025-10-23](https://gigazine.net/gsc_news/en/20251023-minio-stops-distributing-free-docker-images/); README: "distributed as source code only", [minio/minio](https://github.com/minio/minio))                                                                                                                 |
| 2025-12-04 | Repository moved to maintenance mode ([minio/minio#21714](https://github.com/minio/minio/issues/21714))                                                                                                                                                                                                                                                                                                           |
| 2026-02    | README changed to "THIS REPOSITORY IS NO LONGER MAINTAINED" ([minio/minio](https://github.com/minio/minio); timeline in [glukhov.org](https://www.glukhov.org/data-infrastructure/object-storage/minio-dead/))                                                                                                                                                                                                    |
| 2026-04-25 | Repository archived, read-only ([minio/minio](https://github.com/minio/minio))                                                                                                                                                                                                                                                                                                                                    |
| 2026-09-11 | `minio/minio` and `minio/mc` deleted from Docker Hub ([Vonng, 2026-09](https://vonng.com/en/db/silo-is-coming/)). Checked 2026-09-26: `hub.docker.com/v2/repositories/minio/minio` returns 404                                                                                                                                                                                                                    |
| 2026-09-26 | Checked 16:59 UTC: `quay.io/minio/minio` and `quay.io/minio/mc` refuse anonymous pulls. `tags/list` and the pinned manifest digest both return 401 with an anonymous token, while `quay.io/prometheus/prometheus` returns 200. **Renovate cannot see new digests, and nodes cannot re-pull the pinned ones.** The same digest `a1ea29…` is still pullable from a third-party re-push, `docker.io/dextercai/minio` |

Consequences for NOJV:

1. **Availability.** The MinIO pod and the `registry-bucket-init` post-upgrade hook work only while the images stay in the node's containerd cache (`imagePullPolicy: IfNotPresent`). If kubelet image GC runs under disk pressure (about 35 GB free), or the node is rebuilt, MinIO cannot start. That takes down judging, uploads and the registry. Every Flux release can then fail at the hook.
2. **Security.** No more fixes. The pinned release predates the fix for CVE-2025-62506 (IAM session-policy bypass, CVSS 8.1, fixed in `RELEASE.2025-10-15`, [NVD via cvefeed](https://cvefeed.io/vuln/detail/CVE-2025-62506)). NOJV uses only root credentials, with no service accounts, STS or OIDC, and MinIO is reachable only in-cluster (THREAT_MODEL §2), so exposure today is low. It will not stay patched, though.
3. **Local dev.** A fresh clone breaks: `docker-compose.yml` pins `quay.io/minio/minio:latest@sha256:14ce…` and `quay.io/minio/mc:latest@sha256:a7fe…`.
4. **CI.** `browser-smoke` (`.github/workflows/ci.yml`) already pulls `docker.io/dextercai/minio`. The content is identical by digest, but its availability depends on an unknown third party.

**GKE does not depend on MinIO.** `values-gke.yaml` sets `storage.inCluster: false`, so `minio.yaml`, `minio-storageclass.yaml`, the mirror CronJob and the bucket hook do not render. The registry uses `registry.s3.regionendpoint: https://storage.googleapis.com`. GKE is affected only through dev and CI.

## Current usage inventory

| Consumer                                                                                                                                                                                        | S3 calls (verified in source)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nojv/storage` (`packages/storage/src/{object,blobs,images,avatar,submission}.ts`), used by web, worker-judge, worker-platform and the seed Job                                                | `PutObject` with **`IfNoneMatch: "*"`**, `ChecksumAlgorithm: SHA256` + `ChecksumSHA256`, `ContentLength` and `ContentType` (`putObjectIfAbsent`). `GetObject` (length and SHA-256 verified client-side). `ListObjectsV2` (prefix + continuation). `DeleteObject`. `DeleteObjects` (batched, `Quiet`). Client: `forcePathStyle: true`, region `S3_REGION` (default `auto`), `@aws-sdk/client-s3` ^3.1126 (`client.ts`). **Not used:** multipart, presigned URLs, CopyObject, HeadObject, versioning, ACLs or public buckets. Images are proxied through `/api/storage/…` |
| `registry:2.8.3` s3-aws driver ([source at v2.8.3](https://github.com/distribution/distribution/blob/v2.8.3/registry/storage/driver/s3-aws/s3.go)), `infra/charts/nojv/templates/registry.yaml` | `PutObject`, `GetObject` (range), `ListObjects` v1 (delimiter/marker) and `ListObjectsV2`, `CopyObject`, `CreateMultipartUpload`/`UploadPart`/**`UploadPartCopy`**/`CompleteMultipartUpload`, `ListMultipartUploads`, `ListParts`, `DeleteObjects`. Presign only for redirects, which are disabled (`redirect.disable: true`). Config: `region: us-east-1`, `forcepathstyle: true`, `secure: false` in-cluster, bucket `nojv-registry`                                                                                                                                  |
| Registry GC Job (`apps/worker/src/activities/registry.ts`)                                                                                                                                      | Same driver, same ConfigMap and runtime Secret                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Chart                                                                                                                                                                                           | `templates/minio.yaml` (Deployment `Recreate`, PVC `keep`, UID 1000, `/minio/health/*`), `minio-storageclass.yaml` (`Retain`, `rancher.io/local-path`), `minio-backup.cronjob.yaml` (`mc mirror --overwrite`, **mirrors only the `nojv` bucket, not `nojv-registry`**), `registry.yaml` bucket-init hook (`mc mb`), `NOTES.txt`, `secret.example.yaml`, `values.yaml` / `values-single-machine.yaml` `storage.minio.*`, `infra/flux/README.md` production-values shape                                                                                                  |
| Dev / CI / tests                                                                                                                                                                                | `docker-compose.yml` (`minio`, `minio-init`), `.env.example`, `ci.yml` browser-smoke, `tests/setup/playwright-environment.ts`. `tests/setup/integration-setup.ts` **mocks `@nojv/storage` in memory**, so no automated test checks a real server's `If-None-Match` or checksum behaviour. Infra unit tests: `minio-retention`, `backup-fail-closed`, `env-manifest-parity`, `renovate-coverage`                                                                                                                                                                         |

## Requirements

- **R1 Atomic create-if-absent.** `PutObject` with `If-None-Match: *` must return 412 on an existing key, atomically. `putImmutableObject` relies on this for first-writer-wins on immutable keys (PRB-04): a retried activity must not replace the object whose SHA-256 the DB already holds. A backend that ignores the header silently turns this into last-writer-wins. Reads then fail with `StorageIntegrityError` (judge SE) or return the wrong body. **Hard requirement.**
- **R2 Checksums.** Accept `x-amz-checksum-sha256` on `PutObject`, and ideally reject a mismatch. Tolerate SDK v3 default flexible checksums (CRC32 on `DeleteObjects`), or set `requestChecksumCalculation: "WHEN_REQUIRED"` in `client.ts`.
- **R3 Registry driver set** as listed above, including `UploadPartCopy`, v1 listing with delimiter, and path-style addressing.
- **R4 Single node:** one PVC, non-root, `drop: ALL`, `RuntimeDefault` seccomp, a footprint within today's MinIO budget (256Mi request / 512Mi limit), and upgrades by image bump only.
- **R5 Supply chain:** an actively published image from an official source, digest-pinnable and tracked by the Renovate values regex (OPS-18), under an OSI license.
- **R6 No WAN on the judge path.** The 2026-09 availability audit found the uplink to be the dominant outage cause.
- **R7 Backup-friendly:** mirrorable with a maintained tool to any S3 target (OPS-06).
- **Not required:** versioning, object lock, lifecycle, presigned URLs, IAM beyond one key pair, erasure coding or multi-node.

## Options

| Option                                                                                    | License / latest image (checked 2026-09-26)                                                                                                                                                   | R1 `If-None-Match`                                                                                                                                                                              | R2 / R3                                                                                                                                                                                                                                                                                          | Ops on one node                                                                                                                                                                                                                                        | Verdict                                                  |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **[Versity S3 Gateway](https://github.com/versity/versitygw)**, posix backend             | Apache-2.0. `v1.8.0` on `ghcr.io/versity/versitygw` and Docker Hub; releases roughly monthly (v1.5.0 June → v1.8.0 September 2026, [releases](https://github.com/versity/versitygw/releases)) | Yes. v1.8.0: "make conditional PUT evaluation and publication atomic per key" ([v1.8.0](https://github.com/versity/versitygw/releases/tag/v1.8.0))                                              | Multi-checksum support since v1.5.0. Built on aws-sdk-go-v2 types. Multipart staged under `.sgwtmp` ([POSIX backend](https://github.com/versity/versitygw/wiki/POSIX-Backend)). Registry and `UploadPartCopy` **to verify in the spike**                                                         | Single Go binary. Buckets are directories and objects are plain files, with metadata in xattrs (`--sidecar` if the FS lacks them). Root keys via `ROOT_ACCESS_KEY`/`ROOT_SECRET_KEY`, `VGW_HEALTH` endpoint. Files can be backed up with any file tool | **Recommended**                                          |
| **[SeaweedFS](https://github.com/seaweedfs/seaweedfs)** (`weed server -s3` / `weed mini`) | Apache-2.0. `chrislusf/seaweedfs` 4.47 (2026-09)                                                                                                                                              | Yes for non-versioned buckets, since 4.07 (January 2026). Broken with versioning + locking ([#8073](https://github.com/seaweedfs/seaweedfs/issues/8073)). Earlier releases ignored it           | Checksums, multipart with `UploadPartCopy`, v1/v2 listing listed as supported ([S3 API wiki](https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API))                                                                                                                                         | Master, volume, filer and S3 in one process. Data in volume files plus filer metadata (LevelDB), so backup works only through S3. More knobs (volume size, filer store)                                                                                | **Fallback**                                             |
| **[Garage](https://garagehq.deuxfleurs.fr/)**                                             | AGPL-3.0. `dxflrs/garage` v2.4.1                                                                                                                                                              | **No.** "structurally impossible to implement in Garage due to the lack of a consensus algorithm" ([known issues](https://garagehq.deuxfleurs.fr/documentation/reference-manual/known-issues/)) | Multipart incl. `UploadPartCopy`, v1/v2 listing implemented ([compat](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/))                                                                                                                                          | Light, but the docs warn against `replication_factor = 1`                                                                                                                                                                                              | Rejected (fails R1)                                      |
| **[RustFS](https://rustfs.com/blog/announcing-rustfs-1-0-0-ga/)**                         | Apache-2.0. `rustfs/rustfs:1.0.0`, GA 2026-09-16                                                                                                                                              | Unverified. Open conditional-request issues in 2025–26 ([#1458](https://github.com/rustfs/rustfs/issues/1458))                                                                                  | Claims a broad S3 surface                                                                                                                                                                                                                                                                        | GA is 10 days old. A critical hardcoded gRPC token (CVE-2025-68926, CVSS 9.8, fixed in alpha.78, [GHSA-h956-rh7x-ppgj](https://github.com/advisories/GHSA-h956-rh7x-ppgj)) points to young security practice                                           | Re-evaluate in 2027                                      |
| **Ceph RGW** (Rook)                                                                       | LGPL                                                                                                                                                                                          | Yes                                                                                                                                                                                             | Most complete                                                                                                                                                                                                                                                                                    | OSD ≥ 4 GB and mon ≥ 5 GB per daemon ([hardware recommendations](https://docs.ceph.com/en/latest/start/hardware-recommendations/)), about 9+ GiB of a 24 GiB node that also carries the sandbox quota                                                  | Rejected (R4)                                            |
| **MinIO fork** ([SILO, `pgsty/silo`](https://vonng.com/en/db/silo-is-coming/))            | AGPL-3.0 (inherited). `RELEASE.2026-09-03T13-18-01Z`                                                                                                                                          | Yes (same code)                                                                                                                                                                                 | Same as today                                                                                                                                                                                                                                                                                    | Drop-in: same on-disk format, no data copy. A single-maintainer fork a few months old that backports CVE fixes                                                                                                                                         | Emergency bridge only                                    |
| **Cloudflare R2** as primary                                                              | Managed. Free tier: 10 GB-month, 1M Class A and 10M Class B ops, free egress ([pricing](https://developers.cloudflare.com/r2/pricing/)); a payment method is reportedly needed to enable it   | Yes, since 2022-05-27 ([release notes](https://developers.cloudflare.com/r2/platform/release-notes/))                                                                                           | SHA-256 put checksums since 2023-06-16. Versioning not implemented ([S3 compat](https://developers.cloudflare.com/r2/api/s3/api/)). `registry:2` multipart fails with "InvalidPart" unless chunk sizes are tuned ([distribution#3873](https://github.com/distribution/distribution/issues/3873)) | No ops, but every judge read and every image pull crosses the uplink (R6). A 10 GB cap with growth billed                                                                                                                                              | Rejected as primary. **Use as the OPS-06 backup target** |
| **Backblaze B2**                                                                          | Managed. First 10 GB free ([pricing](https://www.backblaze.com/cloud-storage/pricing))                                                                                                        | Not documented ([S3 API docs](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api))                                                                                                  | n/a                                                                                                                                                                                                                                                                                              | WAN                                                                                                                                                                                                                                                    | Backup-target alternative only                           |

## Recommendation

1. **Now, independent of the choice:** copy the two pinned digests (`minio@sha256:a1ea29…` and `mc@sha256:aead63…`) into `ghcr.io/nojv-tw/…` with `crane copy`, or `ctr export`/`import` from the node cache, and point `values.yaml` at them. This removes the re-pull outage risk at no cost and changes no bytes. The same applies to CI, which then stops depending on `dextercai`.
2. **Replace MinIO with Versity S3 Gateway (posix backend) on its own PVC**, for both buckets. It meets R1 atomically (as documented), is Apache-2.0, ships releases roughly monthly (no image signature found on GHCR as of 2026-09-26; pin by digest), and has the simplest operational model: files on a directory. Backup is a file copy or `rclone`, and an upgrade is an image bump over the same directory.
3. **Fallback: SeaweedFS**, if the spike finds Versity failing R1–R3 (registry multipart copy, key/directory collisions or xattrs on the node FS). **Bridge: SILO** if the migration must wait more than one term.
4. **Replace `mc` with `rclone`** (MIT, `rclone/rclone:1.75.1`) in the bucket hook and the mirror CronJob. The mirror covers both buckets. Point it at **R2's free tier** to finally satisfy OPS-06 at zero cost, provided the data stays under 10 GB.

## Design

- Chart: `templates/objstore.yaml` replaces `minio.yaml`. It has a Deployment (`Recreate`), `args: [posix, /data]`, `VGW_PORT=:9000` so only the host changes in `S3_ENDPOINT`, `VGW_HEALTH=/health` for probes, `ROOT_ACCESS_KEY`/`ROOT_SECRET_KEY` from `S3_ACCESS_KEY`/`S3_SECRET_KEY`, and the same pod security context. It gets a new PVC `<release>-objstore` with `helm.sh/resource-policy: keep` on the existing `nojv-minio-retain` StorageClass. Renaming the class would recreate a `Retain` object for no gain (OPS-07).
- Values: `storage.minio.*` → `storage.objectStore.{image,storageSize,resources,backup.*}`. The chart `fail`s if `storage.minio` is still set, so a stale private values Secret cannot silently drop backup settings.
- The registry ConfigMap points `regionendpoint` at `<release>-objstore`. The bucket-init hook becomes `rclone mkdir`. The mirror CronJob becomes `rclone copy --metadata` for `nojv` and `nojv-registry`, without `sync`, so deletions are kept as today.
- `@nojv/storage`: no functional change is expected. Add `requestChecksumCalculation: "WHEN_REQUIRED"` only if the conformance test shows the SDK default CRC32 is rejected.
- New `tests/integration/storage/s3-conformance.test.ts`, run against a real endpoint and unmocked. It checks `If-None-Match` 412 on a second put, rejection of a wrong `ChecksumSHA256`, `ContentType` round-trip, `ListObjectsV2` over 1,000 keys, and `DeleteObjects`. It runs in CI against the compose backend. Any future backend, R2 and GCS included, must pass it.

## Migration plan

**Spike (PR 1, no production):** run the conformance test against MinIO (baseline), Versity and SeaweedFS in compose. Push, pull and GC a multi-layer image of at least 150 MB through `registry:2.8.3`, which exercises multipart and `UploadPartCopy`. Record idle and peak RSS. Replay NOJV's key shapes and the registry layout to check for key-vs-directory collisions on the posix backend. Check that the node FS keeps `user.*` xattrs.

**Chart PR 2:** render `objstore` alongside the untouched MinIO. The app still points at MinIO.

Landed in [#PR](https://github.com/NOJV-TW/NOJV/pull/PR), with these differences from the Design section:

- The values are **not** renamed yet. New keys: `storage.objectStore.{enabled,image,storageSize,storageClass.*,resources}` (enabled in the single-machine overlay), `storage.rclone.image` and `storage.minio.backup.destinationProvider` (default `Cloudflare`). The rename and the `storage.minio` guard move to the cut-over PR.
- The PVC uses a new chart-created class `nojv-objstore-retain` (`Retain`, `keep`), not `nojv-minio-retain`: production mounts MinIO through `storage.minio.existingClaim`, which skips rendering `nojv-minio-retain`, so that class may not exist on the node, and a `Pending` PVC would stall the Flux release.
- `storage.active` (`minio` | `objstore`, default `minio`) selects the store for the registry endpoint, the registry bucket hook and the mirror source. The MinIO registry hook keeps `mc` and renders only while `storage.active=minio`; `objstore.yaml` has its own `rclone mkdir` hook for `nojv` and `nojv-registry`.
- The mirror is already `rclone copy --metadata` of both buckets from the active store into `<destinationBucket>/<bucket>/`, with `no_check_bucket` so a bucket-scoped R2 token works. It stays disabled in production until R2 is enabled.
- CI gains the `storage-conformance` job (Versity profile, no secrets), required by `Verify Repository`.
- Verified on a disposable k3d cluster: the gateway runs under `RuntimeDefault` seccomp as UID 1000 with a read-only root, the bucket hook completes, and the conformance test passes 18/18 through the Service on local-path. The production node's xattr check is still open.

The cut-over PR still has to: switch the registry hook to `rclone` and drop `mc`; rename `storage.minio.*` → `storage.objectStore.*` (with the private values Secret in the same release) and set `storage.active=objstore`; point `S3_ENDPOINT` at `nojv-objstore`; update compose, `.env.example`, browser-smoke and `tests/setup/playwright-environment.ts`; land OPS-19 and the OPS-10/PRB-05 wording; then remove the MinIO templates after the 14-day rollback window.

**Cut-over (owner-run):**

1. Inventory: `rclone size` of both buckets (object count and bytes) and `df` of the local-path volume. Free space must be at least the data size plus 5 GB.
2. Pre-copy while live: `rclone copy --metadata minio:nojv objstore:nojv`, and the same for `nojv-registry`.
3. Window: show the release-window maintenance page and scale web, both workers and the registry to 0. Temporal keeps in-flight workflows (DAT-13).
4. Delta copy: repeat step 2. Then `rclone check` for `nojv`: single-part ETags are MD5 on both sides. For `nojv-registry` run `rclone check --download`, because multipart ETags differ.
5. Point `S3_ENDPOINT` in `nojv-runtime-secrets` at `http://<release>-objstore.nojv.svc.cluster.local:9000`, release, and scale back up.
6. Verify: a one-off script walks every DB pointer (`sourceStorage`, `verdictDetailStorage`, testcase `inputStorage`/`outputStorage`, workspace `contentStorage`, `checkerStorage`/`interactorStorage`, judge snapshots) through `getVerifiedObject`. It must report 0 missing and 0 mismatched. Then run a submission end to end, open a problem image and an avatar, `docker pull` a teacher image as `judge-pull` and a `demo/**` image anonymously, and run registry GC with `--dry-run` to compare the blob count.

**Downtime:** steps 3–6. At local-disk speed, the delta copy plus checksumming is dominated by per-object overhead. For fewer than about 100k objects and a few GB, expect **15–30 minutes of full downtime**. Step 1 gives the exact figure.

**Rollback:** until MinIO is decommissioned, `rclone copy` objstore → MinIO first, because objects written after the cut-over are referenced by the DB. Then restore `S3_ENDPOINT` and the registry endpoint and release. Keep MinIO scaled to 0 with its PVC for 14 days. The follow-up PR removes the MinIO templates, and the retained PVC is deleted by hand only after an off-host copy exists.

## Changes

- **Code/tests:** `packages/storage/src/client.ts` (conditional), the new conformance test, `tests/setup/playwright-environment.ts`, and renames in `tests/unit/infra/{minio-retention,backup-fail-closed,env-manifest-parity,renovate-coverage}.test.ts` and `tests/fixtures/helm/production-external-backups.yaml`.
- **Chart:** `minio*.yaml` → `objstore*.yaml`, `registry.yaml` (endpoint, hook), `NOTES.txt`, `secret.example.yaml`, `values*.yaml`, `infra/charts/nojv/README.md`, `infra/flux/README.md`.
- **Dev/CI:** `docker-compose.yml` (`objstore` plus an `objstore-init` bucket step), `.env.example` (drop the dead `S3_PUBLIC_URL`), `ci.yml` browser-smoke and a conformance step.
- **Docs:** AGENTS.md quick reference, ARCHITECTURE §Object storage, DEPLOYMENT (§Object storage, §Self-hosted registry, §Backups), backup-restore, k8s-single-machine, getting-started, testing, incident-recovery, THREAT_MODEL (the residual "default MinIO credentials" line), QUALITY_SCORE (the OPS-06 item) and `packages/storage/README.md`.

## Decision entries

- **Add OPS-19 "In-cluster object storage is Versity S3 Gateway on a local PVC".** Rejected: MinIO CE (archived, images withdrawn); Garage (no conditional writes); RustFS (too new); Ceph RGW (footprint); R2 as primary (WAN on the judge path, 10 GB cap).
- **PRB-04:** add a rule that every object-storage backend must pass the conformance test (atomic `If-None-Match`, SHA-256 checksum).
- **OPS-06:** mirror both buckets with `rclone` instead of `mc mirror`. Replace "MinIO" with "object store".
- **OPS-07 and OPS-10:** replace "MinIO resources" and "MinIO-backed" with the object store.
- **PRB-05:** replace "MinIO locally" with the object store.

## Owner decisions (2026-09-27)

- **Primary store: Versity S3 Gateway**, confirmed by the spike PR before cut-over. **RustFS is the intended later target** once it matures (conditional writes verified, a longer security track record); the conformance test is the gate for that move too. SeaweedFS stays the fallback if the spike fails.
- **Step 0 done:** the node cache still held both pinned images; their linux/amd64 manifests were pushed unchanged to `ghcr.io/nojv-tw/minio@sha256:3f97c565…` and `ghcr.io/nojv-tw/mc@sha256:2582c2f4…` (public, anonymous pull verified), and chart, CI and compose point at them ([#538](https://github.com/NOJV-TW/NOJV/pull/538)).
- **Sizes (question 1):** `nojv` is about 2.0 GB and `nojv-registry` about 43 MB; the node has 34 GB free (72% used). Downtime should sit at the low end of the estimate, and both buckets fit R2's free 10 GB.
- **Off-host backup: yes, R2's free tier** for the `rclone` mirror of both buckets (and later the CNPG backups).
- **Downtime window:** decided after the spike PR.

## Spike results (2026-09-27)

Local run on an arm64 Mac (OrbStack, kernel 7.0.14, Docker volumes on btrfs) with `infra/docker/s3-conformance/compose.yml` and `tests/integration/storage/s3-conformance.test.ts`. No production system was touched.

| Backend            | Image (pinned by digest)                             | Notes                                                                                          |
| ------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| MinIO (baseline)   | `ghcr.io/nojv-tw/minio:RELEASE.2025-04-22T22-12-26Z` | linux/amd64 only, so it ran under emulation. Its RSS and timings are inflated                  |
| Versity S3 Gateway | `ghcr.io/versity/versitygw:v1.8.0`                   | `posix /data`, UID 1000, read-only root, `cap_drop: ALL`, `no-new-privileges`, default seccomp |
| SeaweedFS          | `chrislusf/seaweedfs:4.47`                           | `weed mini`, same hardening, credentials from `-s3.config`                                     |

All three used the chart's registry settings unchanged (`registry:2.8.3`, `region: us-east-1`, `forcepathstyle: true`, `secure: false`, `redirect.disable: true`, default `chunksize` 10 MiB and `multipartcopythresholdsize` 32 MiB). Buckets were created with `rclone/rclone:1.75.1` (`rclone mkdir`), which worked on all three.

### Conformance test

| Check                                                                                                     | MinIO    | Versity | SeaweedFS |
| --------------------------------------------------------------------------------------------------------- | -------- | ------- | --------- |
| R1: second `If-None-Match: *` put returns 412, first object unchanged                                     | pass     | pass    | pass      |
| R1: 16 parallel puts on one key, 5 rounds: exactly one winner, stored body is the winner's                | pass     | pass    | pass      |
| R1: identical `putImmutableObject` retry succeeds                                                         | pass     | pass    | pass      |
| R2: wrong `ChecksumSHA256` rejected with 400, nothing stored                                              | pass     | pass    | pass      |
| R2: SDK v3 default checksums on `PutObject` and `DeleteObjects` accepted                                  | pass     | pass    | pass      |
| `ContentType` round-trip                                                                                  | pass     | pass    | pass      |
| `ListObjectsV2` over 1,070 keys: truncation at 1,000, continuation                                        | pass     | pass    | pass      |
| `ListObjectsV2` delimiter `/` returns only `CommonPrefixes`                                               | pass     | pass    | pass      |
| `ListObjects` v1 pagination with `Marker`                                                                 | pass     | pass    | pass      |
| `DeleteObjects` (`deleteBlobsByPrefix`, 1,070 keys)                                                       | pass     | pass    | pass      |
| R3: `CopyObject` keeps body and `ContentType`                                                             | pass     | pass    | pass      |
| R3: multipart with `UploadPart` + `UploadPartCopy` (range), `ListMultipartUploads`, `ListParts`, complete | pass     | pass    | pass      |
| R3: `AbortMultipartUpload`                                                                                | pass     | pass    | pass      |
| Every `@nojv/storage` key family (testcase, files, workspace, validators, images)                         | pass     | pass    | pass      |
| Submission sources (nested paths), manifest and verdict detail                                            | pass     | pass    | pass      |
| Key `a` then `a/child`: second write rejected loudly, or both stored and listed                           | **fail** | pass    | pass      |
| Key `a/child` then `a`: same                                                                              | **fail** | pass    | **fail**  |
| 255-character key segment                                                                                 | pass     | pass    | pass      |
| Total                                                                                                     | 16/18    | 18/18   | 17/18     |

`requestChecksumCalculation: "WHEN_REQUIRED"` is not needed for any of the three, so `client.ts` stays unchanged.

The two collision rows are the only failures, and they differ by backend:

- **MinIO (today's production):** accepts both writes and both keys are readable by `GetObject`, but `ListObjectsV2` returns only the shorter key. `deleteBlobsByPrefix` would therefore leave the other object behind.
- **Versity:** rejects the second write with 409 (`ObjectParentIsFile` or `ExistingObjectIsDirectory`) and keeps the first object. The test accepts this, because the failure is loud and nothing is misreported.
- **SeaweedFS:** fine without a condition, but with `If-None-Match: *`, writing `a` while `a/child` exists returns **412 for a key that does not exist**. `putObjectIfAbsent` then reports `created: false`, and `putImmutableObject` fails with `NoSuchKey`. That is a false R1 precondition failure.

NOJV can produce this shape. `normalizeSubmissionSources` and `planSubmissionSources` accept `sourceFiles` paths `a` and `a/b` in one submission, and neither a sandbox nor a posix backend can hold both.

Segments longer than 255 bytes are rejected by all three (MinIO `XMinioInvalidObjectName`, Versity and SeaweedFS `KeyTooLongError` at 256; Versity returned 409 `ExistingObjectIsDirectory` for 300). `parseRelativePath` allows one 300-character segment, so that gap already exists with MinIO today.

### Registry

Each backend got the same throwaway image: `alpine:3.22` plus 64 + 64 + 48 + 1 MiB of random data, 5 layers, 194 MB. The 64 MiB layers are above the 32 MiB copy threshold, so the driver's `Move` goes through `UploadPartCopy`.

| Step                                                                 | MinIO                                    | Versity                                        | SeaweedFS                                                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `docker push` (one run, indicative only)                             | pass, 6.7 s                              | pass, 9.5 s                                    | pass, 36.6 s                                                                                                  |
| Pull: every blob fetched over `/v2/…/blobs` matches its digest (6/6) | pass                                     | pass                                           | pass                                                                                                          |
| Ranged blob GET (206, bytes match)                                   | pass                                     | pass                                           | pass                                                                                                          |
| Nested repositories `demo/nested` and `demo/nested/child`            | pass                                     | pass                                           | pass                                                                                                          |
| `DELETE` manifest                                                    | 202                                      | 202                                            | 202                                                                                                           |
| `registry garbage-collect --dry-run`                                 | pass, 7 blobs eligible                   | pass, 7 blobs eligible                         | pass, 7 blobs eligible                                                                                        |
| `registry garbage-collect`, then blob GET                            | pass, 404                                | pass, 404                                      | pass, 404                                                                                                     |
| Left in `nojv-registry` after GC                                     | 6 layer links, no open multipart uploads | same; empty directories pruned, 24 KiB on disk | same, but the 388 MB volume file had not been reclaimed a few minutes later (SeaweedFS vacuums on a schedule) |

No driver setting beyond the current chart was needed.

### Memory

Memory from `docker stats`, sampled about once a second across the conformance runs, registry push/pull/GC and idle, plus `VmHWM`/`VmRSS` of the server process from `/proc`. `docker stats` includes page cache.

| Backend                 | Idle (`docker stats`) | Peak (`docker stats`) | Process peak RSS (`VmHWM`) | RSS afterwards |
| ----------------------- | --------------------- | --------------------- | -------------------------- | -------------- |
| MinIO (emulated amd64)  | 277 MiB               | 541 MiB               | 497 MiB                    | 334 MiB        |
| Versity                 | 26 MiB                | 88 MiB                | 80 MiB                     | 30 MiB         |
| SeaweedFS `mini`        | 100 MiB               | 1,074 MiB             | 1,063 MiB                  | 364 MiB        |
| `registry:2.8.3` (each) | 4–8 MiB               | 161–176 MiB           | n/a                        | 14–21 MiB      |

SeaweedFS `mini` with defaults went over today's 512 Mi limit. No tuning was tried.

### Versity posix behaviour

- Object metadata lives in `user.*` xattrs (`user.etag`, `user.content-type`, `user.checksums`), which the btrfs volume kept. The production node's local-path filesystem **was not checked**: no SSH in this spike.
- Staging goes to `<bucket>/.sgwtmp/`. Conditional-write locks are `/data/.vgwlocks/<bucket-hash>/<shard>`: at most 256 empty files per bucket, never unlinked. No NOJV key starts with `.sgwtmp/`.
- A file-level backup must keep xattrs (`rsync -X`, `cp --preserve=xattr`), or content types and stored checksums are lost. The planned `rclone` S3 mirror is unaffected.
- Upgrade by image bump: objects written by v1.7.0 (`sha256:c4cbd9d9…`) read back under v1.8.0 on the same directory with the same body, `ContentType` and ETag, and a new `If-None-Match: *` put still returned 412.

### Verdict

**Versity meets R1–R4 in this spike.**

- R1: 412 on existing keys, and a single winner under a 16-way race.
- R2: SHA-256 mismatch rejected, SDK default checksums accepted.
- R3: every registry operation listed above, plus a 194 MB push, pull and GC with the chart's driver config.
- R4: runs as UID 1000 with a read-only root, `drop: ALL`, default seccomp and an 80 MiB peak RSS, and upgrades by image bump.

What remains open:

- **Node filesystem xattrs.** Run on the node: `setfattr -n user.t -v 1 <file> && getfattr -d <file>` in the local-path directory, and `findmnt -T <dir>`.
- **Kubernetes `RuntimeDefault` seccomp.** Only Docker's default profile was used here.

The one behavioural difference from MinIO is the directory collision, and there Versity fails loudly where MinIO silently drops listings. SeaweedFS does not replace Versity as the fallback without caveats: it falsely returns 412 on directory-prefix keys and went over the memory limit.

Owner decisions raised by the spike:

1. Reject submission `sourceFiles` whose paths collide as file and directory (`a` with `a/b`), and segments over 255 bytes, in `normalizeSubmissionSources` / `parseRelativePath` before the cut-over. With Versity such a submission otherwise fails at upload with an S3 409. It cannot run in a sandbox either way.
2. Add the CI conformance step now (against Versity in compose) or with the chart PR. Against today's MinIO the two collision rows fail.

## Open questions for the owner

1. What are the bucket sizes and object counts in production (`nojv`, `nojv-registry`), and the free space on the local-path disk? They set the downtime estimate and whether R2's free 10 GB can hold the off-host copy.
2. Are the pinned `minio` and `mc` images still in the node's containerd cache? May they be copied into `ghcr.io/nojv-tw` now (Recommendation 1)?
3. Is Versity acceptable as primary, with SeaweedFS as fallback and a spike PR first? Or should production bridge on the SILO fork and migrate later?
4. Is a 15–30 minute full-downtime window outside exam and contest hours acceptable?
5. Values rename: `storage.minio.*` → `storage.objectStore.*` requires updating the private `nojv-production-values` Secret in the same release. Is that acceptable, or should the old key names stay?
6. Should R2's free tier (Cloudflare is already in use; enabling it may require a payment method on the account) become the off-host target for this mirror and CNPG backups, unblocking OPS-06 at $0?
7. GKE: third-party reports say the GCS XML API ignores S3 `If-None-Match` ([ClickHouse#115266](https://github.com/ClickHouse/ClickHouse/issues/115266)), which would break R1 there. Should this be recorded in the Quality Ledger until GKE is used?
8. Should the `registry:2.8.3` → distribution v3 upgrade be kept separate? Recommendation: yes, after the cut-over.
