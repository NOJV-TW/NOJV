#!/usr/bin/env bash

set -euo pipefail

: "${RELEASE_IMAGE_NAME:?RELEASE_IMAGE_NAME is required}"
: "${IMAGE_DIGEST:?IMAGE_DIGEST is required}"
: "${TAG:?TAG is required}"
: "${PREFIX:?PREFIX is required}"

case "$RELEASE_IMAGE_NAME" in
  nojv-web | nojv-worker | nojv-migrator | nojv-sandbox) ;;
  *)
    echo "Unsupported release image." >&2
    exit 1
    ;;
esac
if [[ ! "$IMAGE_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo "IMAGE_DIGEST must be an immutable sha256 digest." >&2
  exit 1
fi

ref="${PREFIX}/${RELEASE_IMAGE_NAME}"
docker buildx imagetools create --tag "${ref}:${TAG}" "${ref}@${IMAGE_DIGEST}"
docker pull "${ref}:${TAG}"
inspect="$(docker image inspect "${ref}:${TAG}")"
published_digest="$(
  IMAGE_INSPECT_JSON="$inspect" \
    IMAGE_REF="$ref" \
    RELEASE_SHA="$TAG" \
    node scripts/validate-release-run.mjs published-image
)"
if [[ "$published_digest" != "$IMAGE_DIGEST" ]]; then
  echo "Promoted release tag does not resolve to the attested digest." >&2
  exit 1
fi
