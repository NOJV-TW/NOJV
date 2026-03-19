# Production Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the NOJV deployment infrastructure production-ready by fixing broken configs, adding missing RBAC, optimizing Docker images, and automating CI/CD.

**Architecture:** GCP Cloud Run (web + migrator), GKE (worker + sandbox jobs), GitHub Actions CI. Worker creates K8s Jobs in `nojv-sandbox` namespace via `@kubernetes/client-node`. Sandbox pods are fully isolated (seccomp, drop ALL caps, read-only rootfs).

**Tech Stack:** Docker, Kubernetes, KEDA, GitHub Actions, GCP Cloud Build/Run/GKE, pnpm monorepo, SvelteKit (adapter-node), BullMQ worker (tsx → Node)

---

### Task 1: Fix sandbox network policy

The current `network-policy.yaml` has `deny-all` for both ingress and egress but zero allow rules. This means sandbox pods can't even resolve DNS or pull images properly in some CNI setups.

Sandbox pods should have **no ingress** (nothing talks to them) and **no egress** (they must not reach the internet). The deny-all is actually correct for this use case — sandbox jobs receive input via ConfigMap volume mounts and write output to stdout. They don't need any network access.

However, the policy currently matches `app: nojv-sandbox` but doesn't explicitly deny with empty ingress/egress arrays. In K8s NetworkPolicy, listing policyTypes without any rules means "deny all of those types" — which IS the correct behavior here. But it's ambiguous and some CNI plugins handle this differently.

**Files:**
- Modify: `infra/k8s/sandbox/network-policy.yaml`

**Step 1: Make the deny-all explicit**

Replace the current network policy with explicit empty arrays for clarity and CNI compatibility:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-sandbox
  namespace: nojv-sandbox
spec:
  podSelector:
    matchLabels:
      app: nojv-sandbox
  policyTypes:
    - Ingress
    - Egress
  ingress: []   # No inbound traffic allowed
  egress: []    # No outbound traffic allowed (no DNS, no internet)
```

**Step 2: Verify with dry-run**

Run: `kubectl apply --dry-run=client -f infra/k8s/sandbox/network-policy.yaml`
Expected: `networkpolicy.networking.k8s.io/deny-all-sandbox configured (dry run)`

**Step 3: Commit**

```bash
git add infra/k8s/sandbox/network-policy.yaml
git commit -m "fix: make sandbox deny-all network policy explicit for CNI compatibility"
```

---

### Task 2: Add worker RBAC for sandbox namespace

The worker pod runs in `nojv` namespace and needs to create/read/delete Jobs, ConfigMaps, and Pods in `nojv-sandbox` namespace. Without RBAC, the worker will get 403 errors from the K8s API.

K8s executor uses (from `apps/worker/src/services/k8s-executor.ts`):
- `batchApi.createNamespacedJob` — create Jobs
- `batchApi.readNamespacedJob` — poll Job status
- `batchApi.deleteNamespacedJob` — cleanup
- `coreApi.createNamespacedConfigMap` — submit input data
- `coreApi.deleteNamespacedConfigMap` — cleanup
- `coreApi.listNamespacedPod` — find pod for logs
- `coreApi.readNamespacedPodLog` — get runner output

**Files:**
- Create: `infra/gcp/gke/worker-rbac.yaml`
- Modify: `infra/gcp/gke/worker.deployment.yaml` (add serviceAccountName)
- Modify: `infra/gcp/gke/kustomization.yaml` (add rbac resource)

**Step 1: Create the RBAC manifest**

Create `infra/gcp/gke/worker-rbac.yaml`:

```yaml
# ServiceAccount for the worker deployment
apiVersion: v1
kind: ServiceAccount
metadata:
  name: nojv-worker
  namespace: nojv
---
# Role scoped to nojv-sandbox namespace
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: sandbox-job-manager
  namespace: nojv-sandbox
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "get", "delete"]
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["create", "delete"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["list"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
---
# Bind the role to the worker's service account
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: worker-sandbox-access
  namespace: nojv-sandbox
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: sandbox-job-manager
subjects:
  - kind: ServiceAccount
    name: nojv-worker
    namespace: nojv
```

**Step 2: Add serviceAccountName to worker deployment**

In `infra/gcp/gke/worker.deployment.yaml`, add `serviceAccountName: nojv-worker` under `spec.template.spec`:

```yaml
    spec:
      serviceAccountName: nojv-worker
      containers:
```

**Step 3: Add rbac to kustomization**

In `infra/gcp/gke/kustomization.yaml`, add the new resource:

```yaml
resources:
  - namespace.yaml
  - worker-rbac.yaml
  - worker.deployment.yaml
  - worker.scaledobject.yaml
```

**Step 4: Validate with dry-run**

Run: `kubectl apply --dry-run=client -k infra/gcp/gke/`
Expected: All resources created (dry run) without errors

**Step 5: Commit**

```bash
git add infra/gcp/gke/worker-rbac.yaml infra/gcp/gke/worker.deployment.yaml infra/gcp/gke/kustomization.yaml
git commit -m "feat: add RBAC for worker to manage sandbox jobs in nojv-sandbox namespace"
```

---

### Task 3: Add missing env vars to Cloud Run web service

The `web.cloudrun.yaml` only has `DATABASE_URL` and `REDIS_URL`. The web app also needs auth secrets and OAuth config. The `deploy.sh` script passes secrets via `--set-secrets` flag, but the yaml manifest should be the source of truth.

**Files:**
- Modify: `infra/gcp/web.cloudrun.yaml`
- Modify: `infra/gcp/deploy.sh` (upsert new secrets + pass them to deploy command)

**Step 1: Update the Cloud Run manifest**

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: nojv-web
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "1"
        autoscaling.knative.dev/maxScale: "5"
    spec:
      containerConcurrency: 80
      timeoutSeconds: 60
      containers:
        - image: REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/web:latest
          ports:
            - containerPort: 3000
          resources:
            limits:
              cpu: "1"
              memory: 512Mi
          env:
            - name: NODE_ENV
              value: production
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  key: latest
                  name: nojv-database-url
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  key: latest
                  name: nojv-redis-url
            - name: BETTER_AUTH_SECRET
              valueFrom:
                secretKeyRef:
                  key: latest
                  name: nojv-auth-secret
            - name: BETTER_AUTH_URL
              valueFrom:
                secretKeyRef:
                  key: latest
                  name: nojv-auth-url
            - name: GITHUB_CLIENT_ID
              valueFrom:
                secretKeyRef:
                  key: latest
                  name: nojv-github-client-id
            - name: GITHUB_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  key: latest
                  name: nojv-github-client-secret
            - name: GOOGLE_CLIENT_ID
              valueFrom:
                secretKeyRef:
                  key: latest
                  name: nojv-google-client-id
            - name: GOOGLE_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  key: latest
                  name: nojv-google-client-secret
```

**Step 2: Update deploy.sh to upsert new secrets and pass them**

Add after the existing `upsert_secret` calls (line 94):

```bash
require_env BETTER_AUTH_SECRET
require_env BETTER_AUTH_URL

upsert_secret nojv-database-url "$DATABASE_URL"
upsert_secret nojv-redis-url "$REDIS_URL"
upsert_secret nojv-auth-secret "$BETTER_AUTH_SECRET"
upsert_secret nojv-auth-url "$BETTER_AUTH_URL"

# Optional OAuth — only upsert if set
[[ -n "${GITHUB_CLIENT_ID:-}" ]] && upsert_secret nojv-github-client-id "$GITHUB_CLIENT_ID"
[[ -n "${GITHUB_CLIENT_SECRET:-}" ]] && upsert_secret nojv-github-client-secret "$GITHUB_CLIENT_SECRET"
[[ -n "${GOOGLE_CLIENT_ID:-}" ]] && upsert_secret nojv-google-client-id "$GOOGLE_CLIENT_ID"
[[ -n "${GOOGLE_CLIENT_SECRET:-}" ]] && upsert_secret nojv-google-client-secret "$GOOGLE_CLIENT_SECRET"
```

Update the `gcloud run deploy` command to include all secrets:

```bash
gcloud run deploy "${SERVICE_PREFIX}-web" \
  --allow-unauthenticated \
  --image "${IMAGE_BASE}/web:${IMAGE_TAG}" \
  --port 3000 \
  --region "$REGION" \
  --set-secrets "\
DATABASE_URL=nojv-database-url:latest,\
REDIS_URL=nojv-redis-url:latest,\
BETTER_AUTH_SECRET=nojv-auth-secret:latest,\
BETTER_AUTH_URL=nojv-auth-url:latest,\
GITHUB_CLIENT_ID=nojv-github-client-id:latest,\
GITHUB_CLIENT_SECRET=nojv-github-client-secret:latest,\
GOOGLE_CLIENT_ID=nojv-google-client-id:latest,\
GOOGLE_CLIENT_SECRET=nojv-google-client-secret:latest"
```

**Step 3: Verify deploy.sh syntax**

Run: `bash -n infra/gcp/deploy.sh`
Expected: No output (syntax OK)

**Step 4: Commit**

```bash
git add infra/gcp/web.cloudrun.yaml infra/gcp/deploy.sh
git commit -m "feat: add auth and OAuth secrets to Cloud Run web service config"
```

---

### Task 4: Optimize web Dockerfile (multi-stage, selective copy)

Currently copies entire monorepo. Follow the pattern from `sandbox-runner.Dockerfile`: copy package.json files first for dependency caching, then copy source.

**Files:**
- Modify: `infra/docker/web.Dockerfile`

**Step 1: Rewrite web.Dockerfile**

```dockerfile
FROM node:24-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /build

# 1. Copy dependency manifests for cache-friendly install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tooling/typescript/base.json tooling/typescript/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/queue/package.json packages/queue/

RUN pnpm install --frozen-lockfile --filter @nojv/web...

# 2. Copy source and build
COPY packages/core/ packages/core/
COPY packages/db/ packages/db/
COPY packages/queue/ packages/queue/
COPY apps/web/ apps/web/

RUN pnpm --filter @nojv/db db:generate
RUN pnpm --filter @nojv/core build
RUN pnpm --filter @nojv/web build

# 3. Production image — only the SvelteKit build output
FROM node:24-alpine

WORKDIR /app

COPY --from=builder /build/apps/web/build ./build
COPY --from=builder /build/apps/web/package.json .

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "build"]
```

**Step 2: Test local build**

Run: `docker build -f infra/docker/web.Dockerfile -t nojv-web:test .`
Expected: Build succeeds, final image is significantly smaller

**Step 3: Verify the image runs**

Run: `docker run --rm -e DATABASE_URL=postgresql://x -e REDIS_URL=redis://x -p 3000:3000 nojv-web:test`
Expected: SvelteKit starts (will error on DB connect, but proves the image works)

**Step 4: Commit**

```bash
git add infra/docker/web.Dockerfile
git commit -m "perf: optimize web Dockerfile with selective copy and health check"
```

---

### Task 5: Optimize worker Dockerfile (multi-stage + build step)

Worker currently copies entire monorepo and runs via `tsx` (TypeScript execution at runtime). Add a proper build step with `tsup` or `esbuild`, similar to sandbox-runner.

The worker's `tsconfig.json` has `noEmit: true` and uses `moduleResolution: Bundler`, so we can't just use `tsc --outDir`. Instead, add an esbuild-based build script like sandbox-runner uses.

**Files:**
- Modify: `apps/worker/package.json` (add build:bundle script + esbuild dep)
- Create: `apps/worker/build.mjs` (esbuild config)
- Modify: `infra/docker/worker.Dockerfile`

**Step 1: Add esbuild config for worker**

Create `apps/worker/build.mjs`:

```js
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: "dist/index.js",
  packages: "external",
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
  }
});
```

**Step 2: Update worker package.json**

Add `build:bundle` script and esbuild devDependency:

In `apps/worker/package.json`, change the `build` script and add esbuild:

```json
{
  "scripts": {
    "build": "node build.mjs",
    "build:check": "tsc -p tsconfig.json --noEmit",
    "dev": "node --env-file=../../.env --import tsx --watch src/index.ts",
    "lint": "eslint .",
    "start": "node dist/index.js",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@types/express": "^5.0.6",
    "esbuild": "^0.25.0"
  }
}
```

**Step 3: Test the build locally**

Run: `cd apps/worker && pnpm install && pnpm build && ls -la dist/`
Expected: `dist/index.js` exists

**Step 4: Rewrite worker Dockerfile**

```dockerfile
FROM node:24-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /build

# 1. Copy dependency manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tooling/typescript/base.json tooling/typescript/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/queue/package.json packages/queue/
COPY packages/sandbox/package.json packages/sandbox/

RUN pnpm install --frozen-lockfile --filter @nojv/worker...

# 2. Copy source and build
COPY packages/core/ packages/core/
COPY packages/db/ packages/db/
COPY packages/queue/ packages/queue/
COPY packages/sandbox/ packages/sandbox/
COPY apps/worker/ apps/worker/

RUN pnpm --filter @nojv/db db:generate
RUN pnpm --filter @nojv/core build
RUN pnpm --filter @nojv/sandbox build
RUN pnpm --filter @nojv/worker build

# 3. Production image
FROM node:24-alpine

RUN apk add --no-cache docker-cli

WORKDIR /app

COPY --from=builder /build/apps/worker/dist/ ./dist/
COPY --from=builder /build/apps/worker/package.json .
COPY --from=builder /build/apps/worker/node_modules/ ./node_modules/
COPY --from=builder /build/packages/db/node_modules/.prisma/ ./node_modules/.prisma/

ENV NODE_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/healthz').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
```

**Step 5: Test local build**

Run: `docker build -f infra/docker/worker.Dockerfile -t nojv-worker:test .`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add apps/worker/build.mjs apps/worker/package.json infra/docker/worker.Dockerfile
git commit -m "perf: optimize worker with esbuild bundle and multi-stage Dockerfile"
```

---

### Task 6: Optimize migrator Dockerfile (selective copy)

The migrator only needs Prisma schema and migration files. Currently copies entire monorepo.

**Files:**
- Modify: `infra/docker/migrator.Dockerfile`

**Step 1: Rewrite migrator Dockerfile**

```dockerfile
FROM node:24-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/db/package.json packages/db/

RUN pnpm install --frozen-lockfile --filter @nojv/db
RUN pnpm --filter @nojv/db db:generate

COPY packages/db/prisma/ packages/db/prisma/

CMD ["pnpm", "--filter", "@nojv/db", "db:deploy"]
```

**Step 2: Test local build**

Run: `docker build -f infra/docker/migrator.Dockerfile -t nojv-migrator:test .`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add infra/docker/migrator.Dockerfile
git commit -m "perf: optimize migrator Dockerfile with selective copy"
```

---

### Task 7: Add Docker health checks to docker-compose.yml

Add health checks to web and worker services in docker-compose so `depends_on` can use `condition: service_healthy`.

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add healthcheck to web service**

Under the `web` service, add:

```yaml
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
```

**Step 2: Add healthcheck to worker service**

Under the `worker` service, add:

```yaml
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/healthz').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
```

**Step 3: Add healthcheck to postgres and redis**

Postgres already has health options in CI, add to compose:

```yaml
  postgres:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
```

**Step 4: Update depends_on with conditions**

```yaml
  web:
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  worker:
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
```

**Step 5: Validate compose config**

Run: `docker compose config --quiet`
Expected: No errors

**Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add Docker health checks to all compose services"
```

---

### Task 8: Add CI Docker build & push workflow

Add a GitHub Actions workflow that builds and pushes Docker images to GCP Artifact Registry when pushing to main. This automates what `deploy.sh` does manually for the build step.

**Files:**
- Create: `.github/workflows/docker-build.yml`

**Step 1: Create the workflow**

```yaml
name: Docker Build & Push

on:
  push:
    branches: [main]
    paths:
      - "apps/**"
      - "packages/**"
      - "infra/docker/**"
      - "pnpm-lock.yaml"

concurrency:
  group: docker-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read
  id-token: write

env:
  REGION: asia-east1
  REPOSITORY: nojv

jobs:
  build-and-push:
    name: Build & Push Images
    runs-on: ubuntu-latest
    timeout-minutes: 30
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Configure Docker for Artifact Registry
        run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev --quiet

      - name: Set image tag
        id: tag
        run: echo "tag=$(git rev-parse --short=12 HEAD)" >> "$GITHUB_OUTPUT"

      - name: Build and push web
        uses: docker/build-push-action@v6
        with:
          context: .
          file: infra/docker/web.Dockerfile
          push: true
          tags: |
            ${{ env.REGION }}-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/${{ env.REPOSITORY }}/web:${{ steps.tag.outputs.tag }}
            ${{ env.REGION }}-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/${{ env.REPOSITORY }}/web:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build and push worker
        uses: docker/build-push-action@v6
        with:
          context: .
          file: infra/docker/worker.Dockerfile
          push: true
          tags: |
            ${{ env.REGION }}-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/${{ env.REPOSITORY }}/worker:${{ steps.tag.outputs.tag }}
            ${{ env.REGION }}-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/${{ env.REPOSITORY }}/worker:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build and push sandbox
        uses: docker/build-push-action@v6
        with:
          context: .
          file: infra/docker/sandbox-runner.Dockerfile
          push: true
          tags: |
            ${{ env.REGION }}-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/${{ env.REPOSITORY }}/sandbox:${{ steps.tag.outputs.tag }}
            ${{ env.REGION }}-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/${{ env.REPOSITORY }}/sandbox:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build and push migrator
        uses: docker/build-push-action@v6
        with:
          context: .
          file: infra/docker/migrator.Dockerfile
          push: true
          tags: |
            ${{ env.REGION }}-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/${{ env.REPOSITORY }}/migrator:${{ steps.tag.outputs.tag }}
            ${{ env.REGION }}-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/${{ env.REPOSITORY }}/migrator:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

**Step 2: Commit**

```bash
git add .github/workflows/docker-build.yml
git commit -m "ci: add automated Docker build and push to Artifact Registry on main"
```

**Note:** This workflow requires these GitHub repository secrets:
- `GCP_WORKLOAD_IDENTITY_PROVIDER` — Workload Identity Federation provider
- `GCP_SERVICE_ACCOUNT` — GCP service account email
- `GCP_PROJECT_ID` — GCP project ID

---

### Task 9: Add deploy health check verification to deploy.sh

After deploying web to Cloud Run, verify it's actually serving traffic before declaring success.

**Files:**
- Modify: `infra/gcp/deploy.sh`

**Step 1: Add health check after web deployment**

Add after the `gcloud run deploy` command (before the final echo block):

```bash
# Verify deployment is serving
WEB_URL="$(gcloud run services describe "${SERVICE_PREFIX}-web" --region "$REGION" --format='value(status.url)')"

echo "Verifying deployment health..."
RETRIES=5
for i in $(seq 1 $RETRIES); do
  HTTP_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$WEB_URL" || true)"
  if [[ "$HTTP_STATUS" =~ ^(200|301|302)$ ]]; then
    echo "Health check passed (HTTP $HTTP_STATUS)"
    break
  fi
  if [[ "$i" -eq "$RETRIES" ]]; then
    echo "WARNING: Health check failed after $RETRIES attempts (last HTTP $HTTP_STATUS)" >&2
    echo "The service may still be starting up. Check Cloud Run logs." >&2
  fi
  sleep 5
done
```

**Step 2: Verify script syntax**

Run: `bash -n infra/gcp/deploy.sh`
Expected: No output (syntax OK)

**Step 3: Commit**

```bash
git add infra/gcp/deploy.sh
git commit -m "feat: add post-deploy health check verification to deploy script"
```

---

## Execution Order

Tasks 1-3 are independent (can be parallelized).
Task 4 depends on nothing.
Task 5 depends on nothing (but test after Task 4 to avoid conflicts).
Task 6 depends on nothing.
Task 7 depends on Tasks 4-5 (uses updated Dockerfile health endpoints).
Task 8 depends on Tasks 4-6 (builds optimized images).
Task 9 depends on Task 3 (deploy.sh changes).

Suggested order: 1 → 2 → 3+9 → 4 → 5 → 6 → 7 → 8

## Required GitHub Secrets (for Task 8)

| Secret | Description |
|--------|-------------|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<NUM>/locations/global/workloadIdentityPools/<POOL>/providers/<PROVIDER>` |
| `GCP_SERVICE_ACCOUNT` | `ci-deployer@<PROJECT>.iam.gserviceaccount.com` |
| `GCP_PROJECT_ID` | GCP project ID string |
