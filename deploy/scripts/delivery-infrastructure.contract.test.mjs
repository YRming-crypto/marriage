import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("Prisma maps the avatar message idempotency constraint to PostgreSQL's existing truncated index name", () => {
  const schema = read("prisma/schema.prisma");
  const appliedMigration = read("prisma/migrations/20260814170000_avatar_reply_failure_recovery/migration.sql");

  assert.match(
    schema,
    /@@unique\(\[conversationId, clientMessageId, senderType\],\s*map:\s*"avatar_messages_conversation_id_client_message_id_sender_type_k"\)/,
  );
  assert.match(
    appliedMigration,
    /CREATE UNIQUE INDEX "avatar_messages_conversation_id_client_message_id_sender_type_key"/,
    "the already-applied migration must remain immutable",
  );
});

test("the self-contained Demo exposes loopback-only MinIO S3 and reusable recovery commands", () => {
  const compose = read("compose.demo.yml");
  const packageJson = JSON.parse(read("package.json"));
  const powershellBackup = read("deploy/scripts/backup.ps1");
  const powershellRestore = read("deploy/scripts/restore.ps1");
  const shellBackup = read("deploy/scripts/backup.sh");
  const shellRestore = read("deploy/scripts/restore.sh");

  assert.match(compose, /"127\.0\.0\.1:\$\{DEMO_MINIO_API_PORT:-9000\}:9000"/);
  assert.match(compose, /"127\.0\.0\.1:\$\{DEMO_POSTGRES_PORT:-5432\}:5432"/);
  assert.match(packageJson.scripts["demo:backup"], /backup\.ps1.*ComposeFile\s+compose\.demo\.yml.*S3ClientEndpoint/);
  assert.match(packageJson.scripts["demo:restore"], /restore\.ps1.*ComposeFile\s+compose\.demo\.yml.*S3ClientEndpoint/);

  for (const script of [powershellBackup, powershellRestore]) {
    assert.match(script, /\[string\]\$ComposeFile/);
    assert.match(script, /\[string\]\$S3ClientEndpoint/);
  }
  for (const script of [shellBackup, shellRestore]) {
    assert.match(script, /COMPOSE_FILE/);
    assert.match(script, /S3_CLIENT_ENDPOINT/);
  }
});

test("README waits for MinIO bucket initialization before seeding host-run data", () => {
  const readme = read("README.md");
  const startup = readme.slice(readme.indexOf("docker compose up -d postgres minio minio-init"));
  const waitAt = startup.indexOf("docker compose wait minio-init");
  const seedAt = startup.indexOf("npm.cmd run db:seed");

  assert.ok(waitAt >= 0, "README must wait for the one-shot MinIO initializer");
  assert.ok(seedAt > waitAt, "seeding must happen only after the bucket initializer succeeds");
});

test("the gateway accepts signed stable cursors without the default request-line limit", () => {
  const nginx = read("deploy/gateway/nginx.conf");
  assert.match(nginx, /client_header_buffer_size\s+16k;/);
  assert.match(nginx, /large_client_header_buffers\s+4\s+128k;/);
});

test("CI runs real PostgreSQL and MinIO migration, drift, and persistence verification", () => {
  const workflow = read(".github/workflows/verify.yml");
  const smoke = read("deploy/scripts/persistence-smoke.local.ps1");
  const packageJson = JSON.parse(read("package.json"));

  assert.match(workflow, /docker compose -f compose\.demo\.yml up/);
  assert.match(workflow, /minio-init/);
  assert.match(workflow, /prisma(?:\s+--)?\s+migrate deploy/);
  assert.match(workflow, /prisma(?:\s+--)?\s+migrate diff[\s\S]*--exit-code/);
  assert.match(workflow, /verify:integration:ci/);
  assert.match(workflow, /if:\s*always\(\)[\s\S]*docker compose -f compose\.demo\.yml down -v/);

  const localIntegration = packageJson.scripts["verify:integration"];
  assert.match(localIntegration, /prisma(?:\s+--)?\s+migrate deploy/);
  assert.ok(
    localIntegration.indexOf("migrate deploy") < localIntegration.indexOf("persistence-smoke.local.ps1"),
    "local integration verification must deploy migrations before the API smoke test starts",
  );

  assert.doesNotMatch(smoke, /Get-NetTCPConnection|node\.exe|WindowStyle|Start-Process/);
  assert.match(smoke, /System\.Diagnostics\.ProcessStartInfo/);
  assert.match(smoke, /Invoke-WebRequest[^\r\n]*-UseBasicParsing/);
  assert.match(smoke, /PERSISTENCE_DATABASE_URL/);
  assert.match(smoke, /PERSISTENCE_S3_ENDPOINT/);
});

test("critical runtime image tags are patch-pinned and the update policy is documented", () => {
  const dockerfile = read("Dockerfile");
  const localCompose = read("docker-compose.yml");
  const demoCompose = read("compose.demo.yml");
  const deployment = read("docs/operations/deployment.md");

  assert.match(dockerfile, /ARG NODE_VERSION=22\.12\.0-bookworm-slim/);
  assert.match(dockerfile, /ARG NGINX_VERSION=1\.27\.4-alpine/);
  assert.match(localCompose, /image:\s*postgres:16\.4-alpine/);
  assert.match(demoCompose, /image:\s*postgres:16\.4-alpine/);
  assert.match(deployment, /镜像可复现|镜像版本策略/);
  assert.match(deployment, /digest|摘要/);
});

test("operations docs describe actual photo backup, S3 health probing, and executable Demo recovery", () => {
  const maintenance = read("docs/operations/maintenance.md");
  const localInfrastructure = read("docs/local-infrastructure.md");
  const backupRestore = read("docs/operations/backup-restore.md");

  assert.doesNotMatch(maintenance, /不备份照片/);
  assert.match(maintenance, /\/api\/health[\s\S]{0,240}(S3|对象存储)/);
  assert.match(localInfrastructure, /\$env:DATABASE_URL\s*=.*recovery-set-manifest\.mjs env \.env DATABASE_URL/);
  assert.match(localInfrastructure, /npm\.cmd run demo:backup/);
  assert.match(localInfrastructure, /npm\.cmd run demo:restore/);
  assert.match(backupRestore, /compose\.demo\.yml/);
  assert.match(backupRestore, /尚未.*真实.*恢复|未.*真实.*恢复/);
});
