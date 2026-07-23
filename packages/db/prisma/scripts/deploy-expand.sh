#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

contract=20260716000012_versioned_blob_pointers_contract
package_root="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)"
stage="$(mktemp -d "${TMPDIR:-/tmp}/nojv-expand-migrations.XXXXXX")"
trap 'rm -rf "$stage"' EXIT INT TERM

cd "$package_root"
PATH="$PATH:$package_root/node_modules/.bin"
export PATH
cp prisma/migrations/migration_lock.toml "$stage/migration_lock.toml"

found_contract=false
for migration in prisma/migrations/*; do
  [ -d "$migration" ] || continue
  name="${migration##*/}"
  if [ "$name" = "$contract" ]; then
    found_contract=true
    break
  fi
  cp -R "$migration" "$stage/$name"
done

[ "$found_contract" = true ] || {
  echo "Storage contract migration $contract is missing" >&2
  exit 1
}
[ -d "$stage/20260716000011_versioned_blob_pointers_expand" ] || {
  echo "Storage expand migration is missing from the staged migration history" >&2
  exit 1
}
[ ! -e "$stage/$contract" ] || {
  echo "Storage contract migration leaked into the expand stage" >&2
  exit 1
}

PRISMA_MIGRATIONS_PATH="$stage" prisma migrate deploy
