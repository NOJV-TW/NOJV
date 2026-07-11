# special_env: image-ref authoring + hardening

Status: in progress
Branch: `feat/special-env-image-ref`

## Context

Problem #15 (Advanced Demo) exposed that teacher-authored special_env problems are
effectively unsupported on prod: the ZIP-upload-and-build path requires docker on the
web pod (absent on k8s), and any email-verified account can reach it. Direction agreed
with the owner: teachers build images themselves and reference them by registry link;
creation is gated behind an admin-granted per-user permission.

## Scope

### A — independent hardening

- **A1** kubelet image GC config for the prod k3s node (image store at 42G;
  imageMaximumGCAge + high/low thresholds). Committed under `infra/`, applied manually
  on the prod VM, documented in the deployment doc.
- **A2** `ImagePullBackOff` / `ErrImagePull` currently maps to
  `SandboxBackpressureError` (retryable) → infinite retry. Make it terminal so the
  submission resolves to `system_error` immediately.
- **A3** Grade container egress: k8s `buildGradeEgressPolicy` currently allows all
  egress; close it (grade holds answers — exfiltration channel). Docker backend: ensure
  grade always runs `--network none` (mode `none`) and non-root. Service-mode grading
  must keep working (verify grade↔service needs first).

### B — the feature

- **B4** `User.canCreateAdvancedProblems Boolean @default(false)` + migration +
  server-side enforcement wherever `problem.type` can be set/changed to `special_env` +
  admin toggle UI + contact-admin hint on the creation/edit toggle.
- **B5** Image-ref config form (run image, grade image, network mode) on the problem
  edit page. ZIP-upload/docker-build section demoted to dev-only (docker backend only),
  not deleted.
- **B6** Digest pinning (`@sha256:...` required) + registry allowlist, enforced at the
  INPUT layer only (`problemCreateSchema`/draft refinement + import route), never in the
  base `advancedConfigSchema` — stored legacy configs (`:main` tag on #15) must keep
  parsing on the judge read path.
- **B7** Publish gate for special_env: require at least one successful judged run
  before `canPublish` (reuse the existing no-testcase gate precedent).
- **B8** Authoring guide: how to structure run/grade images, contract (runner.py,
  result.json, /workspace layout), digest pinning, allowed registries.

## Non-goals

- No image build service on our infra (ZIP build stays dev-only).
- No human review queue (test-judge gate instead).
- No cosign/signature verification, no Kyverno (over-engineering for trusted authors).

## Verification

- `pnpm test:unit`, `pnpm test:integration`, `pnpm --filter @nojv/web check`, lint,
  format; `pnpm db:docs` after schema change.
- Prod after merge+deploy: rejudge #15 → 6/6 AC; permission flag toggle via admin UI;
  image-ref form UX; publish gate behavior.

## Cleanup

- Remove stale debug screenshots at repo root.
- Sync living docs (JUDGE_PIPELINE, SECURITY, DATABASE generated docs).
