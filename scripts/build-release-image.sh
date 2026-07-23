#!/usr/bin/env bash

set -euo pipefail

: "${RELEASE_IMAGE_NAME:?RELEASE_IMAGE_NAME is required}"
: "${RELEASE_DOCKERFILE:?RELEASE_DOCKERFILE is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"
: "${TAG:?TAG is required}"
: "${PREFIX:?PREFIX is required}"
: "${EXISTING_IMAGES:?EXISTING_IMAGES is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

case "${RELEASE_IMAGE_NAME}:${RELEASE_DOCKERFILE}" in
  nojv-web:infra/docker/web.Dockerfile | \
    nojv-worker:infra/docker/worker.Dockerfile | \
    nojv-migrator:infra/docker/migrator.Dockerfile | \
    nojv-sandbox:infra/docker/sandbox-runner.Dockerfile) ;;
  *)
    echo "Unsupported release image mapping." >&2
    exit 1
    ;;
esac

node -e '
  const existing = JSON.parse(process.env.EXISTING_IMAGES);
  const allowed = ["nojv-web", "nojv-worker", "nojv-migrator", "nojv-sandbox"];
  if (!Array.isArray(existing) || existing.some((name) => !allowed.includes(name))) {
    throw new Error("invalid existing image publication state");
  }
'

ref="${PREFIX}/${RELEASE_IMAGE_NAME}"
metadata="${RUNNER_TEMP}/${RELEASE_IMAGE_NAME}.json"
if node -e '
  const existing = JSON.parse(process.env.EXISTING_IMAGES);
  process.exit(existing.includes(process.argv[1]) ? 0 : 1);
' "$RELEASE_IMAGE_NAME"; then
  docker pull "${ref}:${TAG}"
  inspect="$(docker image inspect "${ref}:${TAG}")"
  digest="$(
    IMAGE_INSPECT_JSON="$inspect" \
      IMAGE_REF="$ref" \
      IMAGE_TAG="$TAG" \
      RELEASE_SHA="$RELEASE_SHA" \
      node scripts/validate-release-run.mjs published-image
  )"
  gh attestation verify "oci://${ref}@${digest}" \
    --repo "$GITHUB_REPOSITORY" \
    --signer-workflow "$GITHUB_REPOSITORY/.github/workflows/build-images.yml" \
    --source-ref "refs/tags/${TAG}" \
    --source-digest "$RELEASE_SHA" \
    --deny-self-hosted-runners
  printf 'Reusing attested partial publication %s:%s@%s\n' "$ref" "$TAG" "$digest"
  requires_promotion=false
else
  candidate_tag="${TAG}-candidate-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  docker buildx build \
    --file "$RELEASE_DOCKERFILE" \
    --tag "${ref}:${candidate_tag}" \
    --label "org.opencontainers.image.revision=${RELEASE_SHA}" \
    --label "org.opencontainers.image.version=${TAG}" \
    --cache-from "type=registry,ref=${ref}:buildcache" \
    --cache-to "type=registry,ref=${ref}:buildcache,mode=max" \
    --metadata-file "$metadata" \
    --push \
    .
  digest="$(node -e '
    const metadata = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const digest = metadata["containerimage.digest"];
    if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? "")) process.exit(1);
    process.stdout.write(digest);
  ' "$metadata")"
  requires_promotion=true
fi

printf 'digest=%s\n' "$digest" >> "$GITHUB_OUTPUT"
printf 'requires_promotion=%s\n' "$requires_promotion" >> "$GITHUB_OUTPUT"
