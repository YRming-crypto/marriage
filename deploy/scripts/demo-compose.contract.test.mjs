import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("local demo compose contains the complete self-contained website stack", () => {
  const compose = read("compose.demo.yml");

  for (const service of ["postgres", "minio", "minio-init", "migrate", "seed", "api", "web", "gateway"]) {
    assert.match(compose, new RegExp(`^  ${service}:`, "m"), `missing ${service} service`);
  }

  assert.match(compose, /SMS_PROVIDER:\s*console/);
  assert.match(compose, /AVATAR_MODEL_PROVIDER:\s*deterministic/);
  assert.match(compose, /OBJECT_STORAGE_PROVIDER:\s*s3/);
  assert.match(compose, /S3_ENDPOINT:\s*http:\/\/minio:9000/);
  assert.match(compose, /ALLOW_DEV_OTP:\s*"true"/);
  assert.match(compose, /DEV_OTP_CODE:\s*"123456"/);
  assert.match(compose, /"127\.0\.0\.1:\$\{DEMO_MINIO_CONSOLE_PORT:-9001\}:9001"/);
  assert.match(compose, /"127\.0\.0\.1:\$\{DEMO_HTTP_PORT:-8080\}:8080"/);
  assert.match(compose, /condition:\s*service_completed_successfully/);
  assert.doesNotMatch(compose, /SMS_WEBHOOK_URL|AVATAR_MODEL_API_KEY/);
});

test("demo seed image includes the bundled member photos", () => {
  const dockerfile = read("Dockerfile");

  assert.match(dockerfile, /FROM api AS demo-seed/);
  assert.match(dockerfile, /COPY apps\/web\/public\/images \.\/apps\/web\/public\/images/);
  assert.match(dockerfile, /ENTRYPOINT \["node", "apps\/api\/dist\/database-seed-cli\.js"\]/);
});

test("repository exposes repeatable verification and demo commands", () => {
  const packageJson = JSON.parse(read("package.json"));

  assert.equal(packageJson.engines.node, ">=22.12.0");
  assert.match(packageJson.scripts.verify, /backup-restore\.contract\.test\.mjs/);
  assert.match(packageJson.scripts.verify, /demo-compose\.contract\.test\.mjs/);
  assert.match(packageJson.scripts["demo:up"], /compose\.demo\.yml up -d --build/);
  assert.match(packageJson.scripts["demo:down"], /compose\.demo\.yml down/);
});
