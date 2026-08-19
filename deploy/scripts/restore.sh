#!/bin/sh
set -eu

usage() {
  echo "Usage: $0 RECOVERY_SET_DIRECTORY CONFIRM_DATABASE_NAME CONFIRM_BUCKET_NAME" >&2
  exit 2
}

[ "$#" -eq 3 ] || usage
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
env_file=${ENV_FILE:-$repo_root/.env.deploy}
compose_file=${COMPOSE_FILE:-$repo_root/deploy/docker-compose.yml}
s3_client_endpoint=${S3_CLIENT_ENDPOINT:-}
manifest_tool=$repo_root/deploy/scripts/recovery-set-manifest.mjs
[ -L "$1" ] && { echo "Recovery-set root must not be a symbolic link: $1" >&2; exit 1; }
[ -d "$1" ] || { echo "Recovery-set directory not found: $1" >&2; exit 1; }
recovery_set=$(CDPATH= cd -- "$1" && pwd)
confirm_database=$2
confirm_bucket=$3
database_path="$recovery_set/database.dump"
objects_path="$recovery_set/objects"
container_path="/tmp/restore-$(basename -- "$recovery_set").dump"

[ -f "$env_file" ] || { echo "Environment file not found: $env_file" >&2; exit 1; }
[ -f "$compose_file" ] || { echo "Compose file not found: $compose_file" >&2; exit 1; }
[ -f "$manifest_tool" ] || { echo "Manifest tool not found: $manifest_tool" >&2; exit 1; }
for command_name in node docker aws; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Required command not found: $command_name" >&2; exit 1; }
done

node "$manifest_tool" verify "$recovery_set"
recovery_database=$(node "$manifest_tool" metadata "$recovery_set" database.name)
recovery_bucket=$(node "$manifest_tool" metadata "$recovery_set" objectStorage.bucket)
[ "$confirm_database" = "$recovery_database" ] || { echo "Recovery set database '$recovery_database' does not match confirmed target '$confirm_database'." >&2; exit 1; }
[ "$confirm_bucket" = "$recovery_bucket" ] || { echo "Recovery set bucket '$recovery_bucket' does not match confirmed target '$confirm_bucket'." >&2; exit 1; }

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
[ "$confirm_bucket" = "$s3_bucket" ] || { echo "Confirmation does not match target bucket '$s3_bucket'." >&2; exit 1; }

export AWS_ACCESS_KEY_ID="$s3_access_key"
export AWS_SECRET_ACCESS_KEY="$s3_secret_key"
export AWS_DEFAULT_REGION="$s3_region"
export AWS_EC2_METADATA_DISABLED=true

services_stopped=false
restore_ok=false
remote_verification_root=
cleanup() {
  status=$?
  trap - EXIT INT TERM
  set +e
  compose exec -T postgres rm -f "$container_path" >/dev/null 2>&1
  if [ "$services_stopped" = true ] && [ "$restore_ok" != true ]; then
    if ! compose stop gateway api >/dev/null 2>&1; then
      echo "Could not confirm that gateway and API are stopped after the restore failure." >&2
      status=1
    fi
    echo "Restore did not complete. API and gateway remain stopped for inspection." >&2
  fi
  if [ -n "$remote_verification_root" ] && [ -d "$remote_verification_root" ]; then
    rm -rf -- "$remote_verification_root"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$repo_root"
database_name=$(compose exec -T postgres sh -ceu 'printf %s "$POSTGRES_DB"')
[ -n "$database_name" ] || { echo "Could not read the target database name" >&2; exit 1; }
[ "$confirm_database" = "$database_name" ] || { echo "Confirmation does not match target database '$database_name'." >&2; exit 1; }

compose cp "$database_path" "postgres:$container_path"
compose exec -T postgres pg_restore --list "$container_path" >/dev/null
services_stopped=true
compose stop gateway api

if [ -n "$s3_transfer_endpoint" ]; then
  aws s3 rm "s3://$s3_bucket" --recursive --only-show-errors --endpoint-url "$s3_transfer_endpoint"
  aws s3 cp "$objects_path" "s3://$s3_bucket" --recursive --only-show-errors --no-progress --endpoint-url "$s3_transfer_endpoint"
else
  aws s3 rm "s3://$s3_bucket" --recursive --only-show-errors --no-progress
  aws s3 cp "$objects_path" "s3://$s3_bucket" --recursive --only-show-errors --no-progress
fi

remote_verification_root=$(mktemp -d "${TMPDIR:-/tmp}/ai-marriage-remote-verify.XXXXXX")
remote_verification_objects=$remote_verification_root/objects
mkdir -p "$remote_verification_objects"
if [ -n "$s3_transfer_endpoint" ]; then
  aws s3 sync "s3://$s3_bucket" "$remote_verification_objects" --only-show-errors --no-progress --endpoint-url "$s3_transfer_endpoint"
else
  aws s3 sync "s3://$s3_bucket" "$remote_verification_objects" --only-show-errors --no-progress
fi
node "$manifest_tool" verify-objects "$recovery_set" "$remote_verification_objects"
compose exec -T postgres sh -ceu 'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=on --command "$1"' -- 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
compose exec -T postgres sh -ceu 'pg_restore --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error "$1"' -- "$container_path"
compose run --rm migrate
if ! compose up -d api web gateway; then
  compose stop gateway api >/dev/null 2>&1 || true
  exit 1
fi
restore_ok=true
services_stopped=false
echo "Complete recovery set restored to database '$database_name' and bucket '$s3_bucket'."
