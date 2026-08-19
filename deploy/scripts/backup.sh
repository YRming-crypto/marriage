#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
env_file=${ENV_FILE:-$repo_root/.env.deploy}
compose_file=${COMPOSE_FILE:-$repo_root/deploy/docker-compose.yml}
s3_client_endpoint=${S3_CLIENT_ENDPOINT:-}
backup_root=${BACKUP_DIR:-$repo_root/../ai-marriage-backups}
manifest_tool=$repo_root/deploy/scripts/recovery-set-manifest.mjs
stamp=$(date -u +%Y%m%dT%H%M%SZ)
set_id="ai-marriage-$stamp"
recovery_set="$backup_root/$set_id"
partial_root="$recovery_set.partial"
database_path="$partial_root/database.dump"
partial_database_path="$database_path.partial"
objects_path="$partial_root/objects"
container_path="/tmp/$set_id.dump"

[ -f "$env_file" ] || { echo "Environment file not found: $env_file" >&2; exit 1; }
[ -f "$compose_file" ] || { echo "Compose file not found: $compose_file" >&2; exit 1; }
[ -f "$manifest_tool" ] || { echo "Manifest tool not found: $manifest_tool" >&2; exit 1; }
for command_name in node docker aws; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Required command not found: $command_name" >&2; exit 1; }
done

require_value() {
  [ -n "$2" ] || { echo "Required deployment value is empty: $1" >&2; exit 1; }
}
compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}
read_resolved_compose_value() {
  printf '%s' "$compose_config" | node "$manifest_tool" compose-env api "$1"
}

compose_config=$(compose config --format json)
s3_bucket=$(read_resolved_compose_value S3_BUCKET)
s3_region=$(read_resolved_compose_value S3_REGION)
s3_endpoint=$(read_resolved_compose_value S3_ENDPOINT)
s3_access_key=$(read_resolved_compose_value S3_ACCESS_KEY)
s3_secret_key=$(read_resolved_compose_value S3_SECRET_KEY)
s3_transfer_endpoint=${s3_client_endpoint:-$s3_endpoint}
require_value S3_BUCKET "$s3_bucket"
require_value S3_REGION "$s3_region"
require_value S3_ACCESS_KEY "$s3_access_key"
require_value S3_SECRET_KEY "$s3_secret_key"

[ ! -e "$recovery_set" ] || { echo "Recovery set already exists: $recovery_set" >&2; exit 1; }
[ ! -e "$partial_root" ] || { echo "Partial recovery set already exists: $partial_root" >&2; exit 1; }
mkdir -p "$objects_path"

export AWS_ACCESS_KEY_ID="$s3_access_key"
export AWS_SECRET_ACCESS_KEY="$s3_secret_key"
export AWS_DEFAULT_REGION="$s3_region"
export AWS_EC2_METADATA_DISABLED=true

services_stopped=false
backup_complete=false
cleanup() {
  status=$?
  trap - EXIT INT TERM
  set +e
  compose exec -T postgres rm -f "$container_path" >/dev/null 2>&1
  if [ "$services_stopped" = true ]; then
    if ! compose up -d api web gateway >/dev/null; then
      compose stop gateway api >/dev/null 2>&1 || true
      status=1
    fi
  fi
  if [ "$backup_complete" != true ] && [ -e "$partial_root" ]; then
    case "$partial_root" in
      "$backup_root"/ai-marriage-*.partial) rm -rf -- "$partial_root" ;;
      *) echo "Refusing to remove unexpected partial path: $partial_root" >&2; status=1 ;;
    esac
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$repo_root"
database_name=$(compose exec -T postgres sh -ceu 'printf %s "$POSTGRES_DB"')
[ -n "$database_name" ] || { echo "Could not read the source database name" >&2; exit 1; }

services_stopped=true
compose stop gateway api
compose exec -T postgres sh -ceu 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --compress=9 --file "$1"' -- "$container_path"
compose cp "postgres:$container_path" "$partial_database_path"
compose exec -T postgres pg_restore --list "$container_path" >/dev/null
mv "$partial_database_path" "$database_path"

if [ -n "$s3_transfer_endpoint" ]; then
  aws s3 sync "s3://$s3_bucket" "$objects_path" --only-show-errors --no-progress --endpoint-url "$s3_transfer_endpoint"
else
  aws s3 sync "s3://$s3_bucket" "$objects_path" --only-show-errors --no-progress
fi

revision=unknown
if command -v git >/dev/null 2>&1; then
  revision=$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || printf unknown)
fi
node -e '
  const fs = require("node:fs");
  const [file, id, database, bucket, region, endpoint, revision] = process.argv.slice(1);
  const metadata = {
    formatVersion: 1,
    recoverySetId: id,
    createdAt: new Date().toISOString(),
    applicationRevision: revision,
    database: { file: "database.dump", name: database, format: "postgresql-custom" },
    objectStorage: { directory: "objects", bucket, region, endpoint },
  };
  fs.writeFileSync(file, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
' "$partial_root/recovery-set.json" "$set_id" "$database_name" "$s3_bucket" "$s3_region" "$s3_endpoint" "$revision"

node "$manifest_tool" create "$partial_root"
node "$manifest_tool" verify "$partial_root"
mv "$partial_root" "$recovery_set"
backup_complete=true

if ! compose up -d api web gateway; then
  services_stopped=false
  compose stop gateway api >/dev/null 2>&1 || true
  exit 1
fi
services_stopped=false
echo "Complete recovery set created and verified: $recovery_set"
