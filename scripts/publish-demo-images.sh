#!/usr/bin/env bash

set -euo pipefail

: "${DEMO_IMAGE_REGISTRY:?Set DEMO_IMAGE_REGISTRY to an authenticated registry namespace}"
: "${DEMO_IMAGE_TAG:?Set DEMO_IMAGE_TAG to a literal release tag}"

if [[ ! "$DEMO_IMAGE_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
  echo "DEMO_IMAGE_TAG is not a valid OCI tag: $DEMO_IMAGE_TAG" >&2
  exit 1
fi
case "$DEMO_IMAGE_TAG" in
  latest | main | master | local)
    echo "DEMO_IMAGE_TAG must be an immutable release label, not $DEMO_IMAGE_TAG" >&2
    exit 1
    ;;
esac

publish() {
  local name="$1"
  local context="$2"
  local ref="${DEMO_IMAGE_REGISTRY%/}/${name}:${DEMO_IMAGE_TAG}"
  docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --push \
    --tag "$ref" \
    "$context" >&2

  local digest
  digest="$(docker buildx imagetools inspect "$ref" --format '{{.Manifest.Digest}}')"
  if [[ ! "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo "Registry returned an invalid digest for $ref: $digest" >&2
    exit 1
  fi
  printf '%s@%s\n' "$ref" "$digest"
}

run_ref="$(publish nojv-demo-advanced-run infra/docker/demo-advanced-run)"
grade_ref="$(publish nojv-demo-advanced-grade infra/docker/demo-advanced-grade)"
service_ref="$(
  publish nojv-demo-advanced-service apps/web/src/lib/server/advanced-scaffold/files/service
)"

printf 'SEED_ADVANCED_RUN_IMAGE=%s\n' "$run_ref"
printf 'SEED_ADVANCED_GRADE_IMAGE=%s\n' "$grade_ref"
printf 'Published service image: %s\n' "$service_ref"
