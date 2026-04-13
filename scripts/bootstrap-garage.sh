#!/usr/bin/env bash
# Bootstrap the local Garage S3-compatible store for NOJV development.
#
# What this does (idempotently):
#   1. Wait for the `garage` docker-compose service to become healthy
#   2. Assign + apply a single-node layout if one isn't already applied
#   3. Create the `nojv` bucket if it doesn't exist
#   4. Create the `nojv-dev` access key if it doesn't exist
#   5. Authorize the key on the bucket
#   6. Print S3_ACCESS_KEY / S3_SECRET_KEY for the user to paste into .env
#
# Re-running is safe — every step short-circuits when the resource exists.
#
# Reference docs:
#   https://garagehq.deuxfleurs.fr/documentation/quick-start/
#   https://garagehq.deuxfleurs.fr/documentation/reference-manual/cli/

set -euo pipefail

CONTAINER="${GARAGE_CONTAINER:-garage}"
BUCKET="${GARAGE_BUCKET:-nojv}"
KEY_NAME="${GARAGE_KEY_NAME:-nojv-dev}"
ZONE="${GARAGE_ZONE:-dc1}"
CAPACITY="${GARAGE_CAPACITY:-1G}"
NODE_TAG="${GARAGE_NODE_TAG:-garage-dev}"

log() { printf '[bootstrap-garage] %s\n' "$*"; }
err() { printf '[bootstrap-garage] ERROR: %s\n' "$*" >&2; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "required command not found: $1"
    exit 1
  fi
}

require_cmd docker

garage_cli() {
  docker exec "$CONTAINER" /garage "$@"
}

wait_for_healthy() {
  log "waiting for container '$CONTAINER' to be healthy..."
  local tries=0
  local max_tries=30
  while (( tries < max_tries )); do
    local status
    status="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "missing")"
    case "$status" in
      healthy)
        log "container healthy"
        return 0
        ;;
      missing)
        err "container '$CONTAINER' not found. Run: docker compose up -d garage"
        exit 1
        ;;
      *)
        sleep 2
        tries=$((tries + 1))
        ;;
    esac
  done
  err "container did not become healthy after $((max_tries * 2))s (last status: ${status:-unknown})"
  exit 1
}

ensure_layout() {
  # If the cluster layout already has a non-zero version, skip.
  if garage_cli layout show 2>/dev/null | grep -qE '^Current cluster layout version:[[:space:]]*[1-9]'; then
    log "layout already applied, skipping"
    return 0
  fi

  log "fetching node id from 'garage status'..."
  local node_id
  # `garage status` prints a table; the first column of the only "live" row
  # is the full node ID. We grep for a 64-hex prefix and take the first match.
  node_id="$(garage_cli status | awk '/^[0-9a-f]{16,}/ { print $1; exit }')"
  if [[ -z "${node_id:-}" ]]; then
    err "could not parse node id from 'garage status' output"
    garage_cli status >&2 || true
    exit 1
  fi
  log "assigning layout to node $node_id (zone=$ZONE, capacity=$CAPACITY, tag=$NODE_TAG)"
  garage_cli layout assign "$node_id" -z "$ZONE" -c "$CAPACITY" -t "$NODE_TAG"

  log "applying layout (version 1)"
  garage_cli layout apply --version 1
}

ensure_bucket() {
  if garage_cli bucket list 2>/dev/null | grep -qE "[[:space:]]${BUCKET}([[:space:]]|$)"; then
    log "bucket '$BUCKET' already exists, skipping"
    return 0
  fi
  log "creating bucket '$BUCKET'"
  garage_cli bucket create "$BUCKET"
}

ensure_key() {
  # Two cases:
  #  - key already exists → print its ID + secret via `garage key info`
  #  - doesn't exist     → `garage key create` and capture stdout
  local key_output
  if garage_cli key list 2>/dev/null | grep -qE "[[:space:]]${KEY_NAME}([[:space:]]|$)"; then
    log "key '$KEY_NAME' already exists, fetching credentials"
    key_output="$(garage_cli key info --show-secret "$KEY_NAME")"
  else
    log "creating key '$KEY_NAME'"
    garage_cli key create "$KEY_NAME" >/dev/null
    # `key create` only prints the access key, not the secret, on some
    # Garage versions. Use `key info --show-secret` for a uniform output.
    key_output="$(garage_cli key info --show-secret "$KEY_NAME")"
  fi

  ACCESS_KEY="$(printf '%s\n' "$key_output" | awk -F': *' '/^Key ID:/ { print $2; exit }')"
  SECRET_KEY="$(printf '%s\n' "$key_output" | awk -F': *' '/^Secret key:/ { print $2; exit }')"

  if [[ -z "${ACCESS_KEY:-}" || -z "${SECRET_KEY:-}" ]]; then
    err "could not parse key id / secret from 'garage key info' output"
    printf '%s\n' "$key_output" >&2
    exit 1
  fi
}

ensure_grant() {
  log "granting read+write+owner on '$BUCKET' to '$KEY_NAME'"
  # `bucket allow` is idempotent — re-granting the same permission is a no-op.
  garage_cli bucket allow --read --write --owner "$BUCKET" --key "$KEY_NAME"
}

main() {
  wait_for_healthy
  ensure_layout
  ensure_bucket
  ensure_key
  ensure_grant

  cat <<EOF

================================================================
Garage is ready. Paste these into your .env file:

  S3_ENDPOINT=http://localhost:3900
  S3_REGION=garage
  S3_BUCKET=$BUCKET
  S3_ACCESS_KEY=$ACCESS_KEY
  S3_SECRET_KEY=$SECRET_KEY

================================================================
EOF
}

main "$@"
