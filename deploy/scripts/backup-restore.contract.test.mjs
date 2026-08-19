import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../..");
const manifestTool = resolve(import.meta.dirname, "recovery-set-manifest.mjs");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function runManifest(...args) {
  return execFileSync(process.execPath, [manifestTool, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runManifestInput(input, ...args) {
  return execFileSync(process.execPath, [manifestTool, ...args], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function createFixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "ai-marriage-recovery-set-"));
  mkdirSync(resolve(directory, "objects/members"), { recursive: true });
  writeFileSync(resolve(directory, "database.dump"), "postgres archive fixture\n");
  writeFileSync(resolve(directory, "objects/members/photo.jpg"), "photo fixture\n");
  writeRecoveryMetadata(directory);
  return directory;
}

function writeRecoveryMetadata(directory, overrides = {}) {
  const metadata = {
    formatVersion: 1,
    recoverySetId: "ai-marriage-20260814T120000Z",
    createdAt: "2026-08-14T12:00:00.000Z",
    applicationRevision: "0123456789abcdef0123456789abcdef01234567",
    database: {
      file: "database.dump",
      name: overrides.databaseName ?? "ai_marriage",
      format: "postgresql-custom",
    },
    objectStorage: {
      directory: "objects",
      bucket: overrides.bucketName ?? "photo-bucket",
      region: "cn-test-1",
      endpoint: "http://minio.test:9000",
    },
    ...(overrides.extraTopLevel ? { unexpected: true } : {}),
  };
  writeFileSync(resolve(directory, "recovery-set.json"), `${JSON.stringify(metadata, null, 2)}\n`);
}

function createFakeInfrastructure(directory) {
  const bin = resolve(directory, "bin");
  const log = resolve(directory, "operations.log");
  const fakeCli = resolve(directory, "fake-cli.mjs");
  const envFile = resolve(directory, ".env.deploy");
  const s3Root = resolve(directory, "fake-s3");
  const bucketPath = resolve(s3Root, "photo-bucket");
  mkdirSync(bin, { recursive: true });
  mkdirSync(resolve(bucketPath, "members"), { recursive: true });
  writeFileSync(resolve(bucketPath, "members/photo.jpg"), "fake photo object\n");
  writeFileSync(fakeCli, `
    import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
    import { dirname, join } from "node:path";
    const [tool, ...args] = process.argv.slice(2);
    appendFileSync(process.env.FAKE_OPERATIONS_LOG, [tool, ...args].join("|") + "\\n");

    function copyTree(source, destination, skipSameSizeNewer = false) {
      if (!existsSync(source)) return;
      mkdirSync(destination, { recursive: true });
      for (const entry of readdirSync(source, { withFileTypes: true })) {
        const from = join(source, entry.name);
        const to = join(destination, entry.name);
        if (entry.isDirectory()) copyTree(from, to, skipSameSizeNewer);
        else {
          if (skipSameSizeNewer && existsSync(to)) {
            const sourceInfo = statSync(from);
            const targetInfo = statSync(to);
            if (sourceInfo.size === targetInfo.size && targetInfo.mtimeMs >= sourceInfo.mtimeMs) continue;
          }
          mkdirSync(dirname(to), { recursive: true });
          writeFileSync(to, readFileSync(from));
        }
      }
    }

    function deleteExtras(source, destination) {
      if (!existsSync(destination)) return;
      for (const entry of readdirSync(destination, { withFileTypes: true })) {
        const from = join(source, entry.name);
        const to = join(destination, entry.name);
        if (!existsSync(from)) rmSync(to, { recursive: true, force: true });
        else if (entry.isDirectory()) deleteExtras(from, to);
      }
    }

    function s3Path(uri) {
      const [bucket, ...prefix] = uri.slice(5).split("/").filter(Boolean);
      return join(process.env.FAKE_S3_ROOT, bucket, ...prefix);
    }

    function firstFile(directory) {
      if (!existsSync(directory)) return null;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          const nested = firstFile(path);
          if (nested) return nested;
        } else return path;
      }
      return null;
    }

    if (tool === "docker" && args.includes("config") && args.includes("--format") && args.includes("json")) {
      process.stdout.write(JSON.stringify({ services: { api: { environment: {
        S3_BUCKET: process.env.S3_BUCKET,
        S3_REGION: process.env.S3_REGION,
        S3_ENDPOINT: process.env.S3_ENDPOINT,
        S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
        S3_SECRET_KEY: process.env.S3_SECRET_KEY,
      } } } }));
    }

    if (tool === "docker" && args.some((value) => value.includes("POSTGRES_DB"))) {
      process.stdout.write("ai_marriage");
    }
    const copyAt = args.indexOf("cp");
    if (tool === "docker" && copyAt >= 0 && args[copyAt + 1]?.startsWith("postgres:")) {
      const destination = args[copyAt + 2];
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, "fake postgresql custom archive\\n");
    }
    if (tool === "docker" && args.includes("up") && process.env.FAKE_FAIL_UP === "true") {
      process.exit(42);
    }
    if (tool === "aws" && args[0] === "s3") {
      const command = args[1];
      const source = args[2];
      const destination = args[3];
      if (command === "rm") {
        const remote = s3Path(source);
        rmSync(remote, { recursive: true, force: true });
        mkdirSync(remote, { recursive: true });
      } else if (command === "cp" && destination?.startsWith("s3://")) {
        copyTree(source, s3Path(destination), false);
      } else if (command === "sync" && source?.startsWith("s3://")) {
        copyTree(s3Path(source), destination, false);
        if (process.env.FAKE_CORRUPT_REMOTE_DOWNLOAD === "true") {
          const downloaded = firstFile(destination);
          if (downloaded) {
            const size = statSync(downloaded).size;
            writeFileSync(downloaded, Buffer.alloc(size, 88));
          }
        }
      } else if (command === "sync" && destination?.startsWith("s3://")) {
        const remote = s3Path(destination);
        copyTree(source, remote, true);
        if (args.includes("--delete")) deleteExtras(source, remote);
      }
    }
  `);
  const node = process.execPath.replaceAll("%", "%%");
  const fake = fakeCli.replaceAll("%", "%%");
  for (const tool of ["docker", "aws"]) {
    writeFileSync(resolve(bin, `${tool}.cmd`), `@echo off\r\n"${node}" "${fake}" ${tool} %*\r\n`);
  }
  writeFileSync(envFile, [
    "S3_BUCKET=photo-bucket",
    "S3_REGION=cn-test-1",
    "S3_ENDPOINT=http://minio.test:9000",
    "S3_ACCESS_KEY=test-access",
    "S3_SECRET_KEY=test-secret",
    "",
  ].join("\n"));
  return { bin, bucketPath, envFile, log, s3Root };
}

function fakeEnvironment(infrastructure) {
  return {
    ...process.env,
    S3_BUCKET: "photo-bucket",
    S3_REGION: "cn-test-1",
    S3_ENDPOINT: "http://minio.test:9000",
    S3_ACCESS_KEY: "test-access",
    S3_SECRET_KEY: "test-secret",
    PATH: `${infrastructure.bin};${process.env.PATH}`,
    FAKE_OPERATIONS_LOG: infrastructure.log,
    FAKE_S3_ROOT: infrastructure.s3Root,
  };
}

test("SHA-256 manifest covers the complete recovery set and verifies clean data", () => {
  const directory = createFixture();
  try {
    runManifest("create", directory);
    const manifest = readFileSync(resolve(directory, "manifest.sha256"), "ascii");

    assert.match(manifest, /^[a-f0-9]{64}  database\.dump$/m);
    assert.match(manifest, /^[a-f0-9]{64}  objects\/members\/photo\.jpg$/m);
    assert.match(manifest, /^[a-f0-9]{64}  recovery-set\.json$/m);
    assert.doesNotMatch(manifest, /manifest\.sha256/);
    assert.match(runManifest("verify", directory), /verified/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("manifest verification fails on changed, missing, and unexpected files", () => {
  const cases = [
    (directory) => writeFileSync(resolve(directory, "database.dump"), "tampered\n"),
    (directory) => rmSync(resolve(directory, "objects/members/photo.jpg")),
    (directory) => writeFileSync(resolve(directory, "unexpected.txt"), "not declared\n"),
  ];

  for (const mutate of cases) {
    const directory = createFixture();
    try {
      runManifest("create", directory);
      mutate(directory);
      assert.throws(
        () => runManifest("verify", directory),
        (error) => error.status !== 0 && /verification failed/i.test(error.stderr),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("recovery-set metadata has a strict schema and exposes its confirmed identity", () => {
  const valid = createFixture();
  const invalid = createFixture();
  try {
    runManifest("create", valid);
    assert.equal(runManifest("metadata", valid, "database.name"), "ai_marriage");
    assert.equal(runManifest("metadata", valid, "objectStorage.bucket"), "photo-bucket");

    writeRecoveryMetadata(invalid, { extraTopLevel: true });
    assert.throws(
      () => runManifest("create", invalid),
      (error) => error.status !== 0 && /metadata.*schema|unexpected.*metadata/i.test(error.stderr),
    );
  } finally {
    rmSync(valid, { recursive: true, force: true });
    rmSync(invalid, { recursive: true, force: true });
  }
});

test("recovery-set metadata rejects object endpoints that can persist credentials", () => {
  const endpoints = [
    "https://user:password@storage.example.test",
    "https://storage.example.test?token=secret",
    "https://storage.example.test#secret",
  ];

  for (const endpoint of endpoints) {
    const directory = createFixture();
    try {
      const metadataPath = resolve(directory, "recovery-set.json");
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      metadata.objectStorage.endpoint = endpoint;
      writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

      assert.throws(
        () => runManifest("create", directory),
        (error) => error.status !== 0 && /endpoint.*(credential|userinfo|query|fragment|secret)/i.test(error.stderr),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("manifest operations reject a linked recovery-set root and require objects even when empty", () => {
  const missingObjects = createFixture();
  const emptyObjects = createFixture();
  const target = createFixture();
  const linkedRoot = `${target}-link`;
  try {
    rmSync(resolve(missingObjects, "objects"), { recursive: true, force: true });
    assert.throws(
      () => runManifest("create", missingObjects),
      (error) => error.status !== 0 && /objects.*directory/i.test(error.stderr),
    );

    rmSync(resolve(emptyObjects, "objects"), { recursive: true, force: true });
    mkdirSync(resolve(emptyObjects, "objects"));
    assert.match(runManifest("create", emptyObjects), /created/i);
    assert.match(runManifest("verify", emptyObjects), /verified/i);

    symlinkSync(target, linkedRoot, "junction");
    assert.throws(
      () => runManifest("create", linkedRoot),
      (error) => error.status !== 0 && /symbolic link|linked.*root/i.test(error.stderr),
    );
  } finally {
    if (existsSync(linkedRoot)) unlinkSync(linkedRoot);
    rmSync(missingObjects, { recursive: true, force: true });
    rmSync(emptyObjects, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

test("deployment environment values are read without evaluating the file", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "ai-marriage-env-"));
  const envFile = resolve(directory, ".env.deploy");
  try {
    writeFileSync(envFile, [
      "S3_BUCKET=photo-bucket",
      "S3_SECRET_KEY='literal # secret'",
      "S3_ENDPOINT=",
      "",
    ].join("\n"));

    assert.equal(runManifest("env", envFile, "S3_BUCKET"), "photo-bucket");
    assert.equal(runManifest("env", envFile, "S3_SECRET_KEY"), "literal # secret");
    assert.equal(runManifest("env", envFile, "S3_ENDPOINT"), "");
    assert.throws(
      () => runManifest("env", envFile, "MISSING_KEY"),
      (error) => error.status !== 0 && /not defined/i.test(error.stderr),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolved Compose service environment can be read without exposing the full config as arguments", () => {
  const config = JSON.stringify({
    services: {
      api: {
        environment: {
          S3_BUCKET: "host-override-bucket",
          S3_REGION: "cn-resolved-1",
          S3_ENDPOINT: "https://storage.example.test",
        },
      },
    },
  });

  assert.equal(runManifestInput(config, "compose-env", "api", "S3_BUCKET"), "host-override-bucket");
  assert.equal(runManifestInput(config, "compose-env", "api", "S3_ENDPOINT"), "https://storage.example.test");
  assert.throws(
    () => runManifestInput(config, "compose-env", "api", "S3_SECRET_KEY"),
    (error) => error.status !== 0 && /service environment.*S3_SECRET_KEY|not defined/i.test(error.stderr),
  );
});

test("remote object verification compares exact keys and SHA-256 content", () => {
  const directory = createFixture();
  const downloadedObjects = mkdtempSync(resolve(tmpdir(), "ai-marriage-remote-objects-"));
  try {
    runManifest("create", directory);
    cpSync(resolve(directory, "objects"), downloadedObjects, { recursive: true });
    assert.match(runManifest("verify-objects", directory, downloadedObjects), /verified/i);

    const object = resolve(downloadedObjects, "members/photo.jpg");
    const size = statSync(object).size;
    writeFileSync(object, Buffer.alloc(size, 88));
    assert.throws(
      () => runManifest("verify-objects", directory, downloadedObjects),
      (error) => error.status !== 0 && /verification failed|SHA-256 mismatch/i.test(error.stderr),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(downloadedObjects, { recursive: true, force: true });
  }
});

test("backup scripts create and self-verify one PostgreSQL and S3 recovery set", () => {
  for (const path of ["deploy/scripts/backup.ps1", "deploy/scripts/backup.sh"]) {
    const script = read(path);
    assert.match(script, /pg_dump/);
    assert.match(script, /aws\s+s3\s+sync/);
    assert.match(script, /recovery-set\.json/);
    assert.match(script, /recovery-set-manifest\.mjs/);
    assert.match(script, /\bcreate\b/);
    assert.match(script, /\bverify\b/);
    assert.match(script, /config\s+--format\s+json/);
    assert.match(script, /compose-env/);
  }
});

test("restore scripts use the same resolved Compose S3 environment as the API", () => {
  for (const path of ["deploy/scripts/restore.ps1", "deploy/scripts/restore.sh"]) {
    const script = read(path);
    assert.match(script, /config\s+--format\s+json/);
    assert.match(script, /compose-env/);
  }
});

test("backup scripts stop gateway and API when service restart partially fails", () => {
  for (const path of ["deploy/scripts/backup.ps1", "deploy/scripts/backup.sh"]) {
    const script = read(path);
    const startAt = script.lastIndexOf("up -d api web gateway");
    const stopAfterStart = script.indexOf("stop gateway api", startAt);
    assert.ok(startAt >= 0, `${path} must restart application services after backup`);
    assert.ok(stopAfterStart > startAt, `${path} must stop partially restarted services`);
  }
});

test("Shell backup disables EXIT-time restart after an explicit restart failure", () => {
  const script = read("deploy/scripts/backup.sh");
  const explicitRestartFailure = script.match(/if\s+!\s+compose\s+up\s+-d\s+api\s+web\s+gateway;\s+then([\s\S]*?)fi/);
  assert.ok(explicitRestartFailure, "backup.sh must handle an explicit compose restart failure");
  assert.match(explicitRestartFailure[1], /services_stopped=false[\s\S]*compose stop gateway api/);
});

test("PowerShell backup creates a verified complete set against fake infrastructure", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "ai-marriage-backup-script-"));
  const infrastructure = createFakeInfrastructure(resolve(directory, "infra"));
  const output = resolve(directory, "backups");
  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", resolve(root, "deploy/scripts/backup.ps1"),
      "-EnvFile", infrastructure.envFile,
      "-OutputDirectory", output,
    ], {
      cwd: root,
      env: fakeEnvironment(infrastructure),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const entries = readdirSync(output);
    assert.equal(entries.length, 1);
    const recoverySet = resolve(output, entries[0]);
    assert.match(runManifest("verify", recoverySet), /verified/i);
    assert.equal(readFileSync(resolve(recoverySet, "objects/members/photo.jpg"), "utf8"), "fake photo object\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PowerShell backup follows the host-overridden S3 environment resolved by Compose", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "ai-marriage-backup-compose-env-"));
  const infrastructure = createFakeInfrastructure(resolve(directory, "infra"));
  const output = resolve(directory, "backups");
  const overriddenBucket = resolve(infrastructure.s3Root, "host-override-bucket");
  try {
    mkdirSync(resolve(overriddenBucket, "members"), { recursive: true });
    writeFileSync(resolve(overriddenBucket, "members/photo.jpg"), "host override object\n");

    execFileSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", resolve(root, "deploy/scripts/backup.ps1"),
      "-EnvFile", infrastructure.envFile,
      "-OutputDirectory", output,
    ], {
      cwd: root,
      env: { ...fakeEnvironment(infrastructure), S3_BUCKET: "host-override-bucket" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const [entry] = readdirSync(output);
    const recoverySet = resolve(output, entry);
    assert.equal(runManifest("metadata", recoverySet, "objectStorage.bucket"), "host-override-bucket");
    assert.equal(readFileSync(resolve(recoverySet, "objects/members/photo.jpg"), "utf8"), "host override object\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PowerShell backup stops partial service startup before returning failure", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "ai-marriage-backup-script-"));
  const infrastructure = createFakeInfrastructure(resolve(directory, "infra"));
  const output = resolve(directory, "backups");
  try {
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", resolve(root, "deploy/scripts/backup.ps1"),
      "-EnvFile", infrastructure.envFile,
      "-OutputDirectory", output,
    ], {
      cwd: root,
      env: { ...fakeEnvironment(infrastructure), FAKE_FAIL_UP: "true" },
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    const operations = readFileSync(infrastructure.log, "utf8").split(/\r?\n/).filter(Boolean);
    const startAt = operations.findIndex((line) => line.includes("|up|-d|api|web|gateway"));
    const stopAfterStart = operations.findIndex((line, index) => index > startAt && line.includes("|stop|gateway|api"));
    assert.ok(startAt >= 0);
    assert.ok(stopAfterStart > startAt);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restore scripts verify the manifest before stopping services or replacing data", () => {
  for (const path of ["deploy/scripts/restore.ps1", "deploy/scripts/restore.sh"]) {
    const script = read(path);
    const verifyAt = script.indexOf(" verify ");
    const stopAt = script.indexOf("stop gateway api");
    const objectDeleteAt = script.indexOf("aws s3 rm");
    const objectRestoreAt = script.indexOf("aws s3 cp");
    const remoteVerifyAt = script.indexOf("verify-objects");
    const databaseRestoreAt = script.indexOf("pg_restore --username");

    assert.ok(verifyAt >= 0, `${path} must verify manifest.sha256`);
    assert.ok(stopAt > verifyAt, `${path} must verify before stopping write traffic`);
    assert.ok(objectDeleteAt > stopAt, `${path} must clear the confirmed target after write traffic stops`);
    assert.ok(objectRestoreAt > objectDeleteAt, `${path} must force-copy every recovery-set object`);
    assert.ok(remoteVerifyAt > objectRestoreAt, `${path} must verify downloaded remote object content`);
    assert.ok(databaseRestoreAt > remoteVerifyAt, `${path} must restore PostgreSQL after remote object verification`);
    assert.match(script, /ConfirmBucketName|CONFIRM_BUCKET_NAME|confirm_bucket/);
    assert.match(script, / metadata /);
  }
});

test("restore scripts reset the target schema before loading the database archive", () => {
  for (const path of ["deploy/scripts/restore.ps1", "deploy/scripts/restore.sh"]) {
    const script = read(path);
    const stopAt = script.indexOf("stop gateway api");
    const resetAt = script.indexOf("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const restoreAt = script.indexOf("pg_restore --username");

    assert.ok(resetAt > stopAt, `${path} must reset the schema only after write traffic stops`);
    assert.ok(restoreAt > resetAt, `${path} must load the archive into the empty schema`);
  }
});

test("restore scripts contain a failure-path stop after a possible partial service start", () => {
  for (const path of ["deploy/scripts/restore.ps1", "deploy/scripts/restore.sh"]) {
    const script = read(path);
    const stops = [...script.matchAll(/stop gateway api/g)].map((match) => match.index);
    const startAt = script.indexOf("up -d api web gateway");
    assert.ok(startAt >= 0, `${path} must start services after a successful restore`);
    assert.ok(stops.some((index) => index < startAt), `${path} must stop write traffic before restore`);
    assert.ok(stops.some((index) => index > startAt), `${path} must stop partially started services on failure`);
  }
});

test("restore entrypoints reject linked recovery-set roots before resolving them", () => {
  const powershell = read("deploy/scripts/restore.ps1");
  const shell = read("deploy/scripts/restore.sh");
  assert.match(powershell, /ReparsePoint/);
  assert.match(shell, /\[\s+-L\s+"\$1"\s+\]/);
});

test("PowerShell restore rejects a damaged set before any Docker or AWS call", () => {
  const directory = createFixture();
  const infrastructureRoot = mkdtempSync(resolve(tmpdir(), "ai-marriage-fake-infra-"));
  const infrastructure = createFakeInfrastructure(infrastructureRoot);
  try {
    runManifest("create", directory);
    writeFileSync(resolve(directory, "database.dump"), "tampered after manifest\n");
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", resolve(root, "deploy/scripts/restore.ps1"),
      "-EnvFile", infrastructure.envFile,
      "-RecoverySetDirectory", directory,
      "-ConfirmDatabaseName", "ai_marriage",
      "-ConfirmBucketName", "photo-bucket",
    ], {
      cwd: root,
      env: fakeEnvironment(infrastructure),
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /verification failed/i);
    assert.equal(existsSync(infrastructure.log), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(infrastructureRoot, { recursive: true, force: true });
  }
});

test("PowerShell restore rejects recovery-set database or bucket identity mismatches before infrastructure calls", () => {
  const cases = [
    { databaseName: "another_database", bucketName: "photo-bucket" },
    { databaseName: "ai_marriage", bucketName: "another-photo-bucket" },
  ];

  for (const identity of cases) {
    const directory = createFixture();
    const infrastructureRoot = mkdtempSync(resolve(tmpdir(), "ai-marriage-fake-infra-"));
    const infrastructure = createFakeInfrastructure(infrastructureRoot);
    try {
      writeRecoveryMetadata(directory, identity);
      runManifest("create", directory);
      const result = spawnSync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", resolve(root, "deploy/scripts/restore.ps1"),
        "-EnvFile", infrastructure.envFile,
        "-RecoverySetDirectory", directory,
        "-ConfirmDatabaseName", "ai_marriage",
        "-ConfirmBucketName", "photo-bucket",
      ], {
        cwd: root,
        env: fakeEnvironment(infrastructure),
        encoding: "utf8",
      });

      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /recovery set|metadata|identity|does not match/i);
      assert.equal(existsSync(infrastructure.log), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
      rmSync(infrastructureRoot, { recursive: true, force: true });
    }
  }
});

test("PowerShell restore force-overwrites a newer same-size remote object before database replacement", () => {
  const directory = createFixture();
  const infrastructureRoot = mkdtempSync(resolve(tmpdir(), "ai-marriage-fake-infra-"));
  const infrastructure = createFakeInfrastructure(infrastructureRoot);
  try {
    runManifest("create", directory);
    const sourceObject = resolve(directory, "objects/members/photo.jpg");
    const remoteObject = resolve(infrastructure.bucketPath, "members/photo.jpg");
    writeFileSync(remoteObject, Buffer.alloc(statSync(sourceObject).size, 88));
    const future = new Date(Date.now() + 60_000);
    utimesSync(remoteObject, future, future);

    execFileSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", resolve(root, "deploy/scripts/restore.ps1"),
      "-EnvFile", infrastructure.envFile,
      "-RecoverySetDirectory", directory,
      "-ConfirmDatabaseName", "ai_marriage",
      "-ConfirmBucketName", "photo-bucket",
    ], {
      cwd: root,
      env: fakeEnvironment(infrastructure),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.equal(readFileSync(remoteObject, "utf8"), readFileSync(sourceObject, "utf8"));
    const operations = readFileSync(infrastructure.log, "utf8").split(/\r?\n/).filter(Boolean);
    const stopAt = operations.findIndex((line) => line.includes("|stop|gateway|api"));
    const deleteAt = operations.findIndex((line) => line.startsWith("aws|s3|rm|"));
    const objectsAt = operations.findIndex((line) => line.startsWith("aws|s3|cp|"));
    const remoteDownloadAt = operations.findIndex((line) => line.startsWith("aws|s3|sync|s3://"));
    const databaseAt = operations.findIndex((line) => line.includes("pg_restore --username"));
    assert.ok(stopAt >= 0);
    assert.ok(deleteAt > stopAt);
    assert.ok(objectsAt > deleteAt);
    assert.ok(remoteDownloadAt > objectsAt);
    assert.ok(databaseAt > remoteDownloadAt);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(infrastructureRoot, { recursive: true, force: true });
  }
});

test("remote object verification failure blocks database restore and service startup", () => {
  const directory = createFixture();
  const infrastructureRoot = mkdtempSync(resolve(tmpdir(), "ai-marriage-fake-infra-"));
  const infrastructure = createFakeInfrastructure(infrastructureRoot);
  try {
    runManifest("create", directory);
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", resolve(root, "deploy/scripts/restore.ps1"),
      "-EnvFile", infrastructure.envFile,
      "-RecoverySetDirectory", directory,
      "-ConfirmDatabaseName", "ai_marriage",
      "-ConfirmBucketName", "photo-bucket",
    ], {
      cwd: root,
      env: { ...fakeEnvironment(infrastructure), FAKE_CORRUPT_REMOTE_DOWNLOAD: "true" },
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /verification failed|SHA-256 mismatch/i);
    const operations = readFileSync(infrastructure.log, "utf8").split(/\r?\n/).filter(Boolean);
    assert.equal(operations.some((line) => line.includes("pg_restore --username")), false);
    assert.equal(operations.some((line) => line.includes("|up|-d|api|web|gateway")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(infrastructureRoot, { recursive: true, force: true });
  }
});

test("a partial compose up failure triggers another gateway and API stop", () => {
  const directory = createFixture();
  const infrastructureRoot = mkdtempSync(resolve(tmpdir(), "ai-marriage-fake-infra-"));
  const infrastructure = createFakeInfrastructure(infrastructureRoot);
  try {
    runManifest("create", directory);
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", resolve(root, "deploy/scripts/restore.ps1"),
      "-EnvFile", infrastructure.envFile,
      "-RecoverySetDirectory", directory,
      "-ConfirmDatabaseName", "ai_marriage",
      "-ConfirmBucketName", "photo-bucket",
    ], {
      cwd: root,
      env: { ...fakeEnvironment(infrastructure), FAKE_FAIL_UP: "true" },
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    const operations = readFileSync(infrastructure.log, "utf8").split(/\r?\n/).filter(Boolean);
    const startAt = operations.findIndex((line) => line.includes("|up|-d|api|web|gateway"));
    const stopAfterStart = operations.findIndex((line, index) => index > startAt && line.includes("|stop|gateway|api"));
    assert.ok(startAt >= 0);
    assert.ok(stopAfterStart > startAt);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(infrastructureRoot, { recursive: true, force: true });
  }
});

test("the gateway gives the SSE endpoint an unbuffered long-lived proxy", () => {
  const nginx = read("deploy/gateway/nginx.conf");
  const match = nginx.match(/location\s+=\s+\/api\/realtime\/events\s*\{([\s\S]*?)\n\s*\}/);

  assert.ok(match, "missing exact SSE location");
  const block = match[1];
  assert.match(block, /proxy_buffering\s+off;/);
  assert.match(block, /proxy_cache\s+off;/);
  assert.match(block, /proxy_read_timeout\s+1h;/);
  assert.match(block, /add_header\s+X-Accel-Buffering\s+no\s+always;/);
});

test("operations documentation describes the executable complete recovery set", () => {
  const backupRestore = read("docs/operations/backup-restore.md");
  const deployment = read("docs/operations/deployment.md");

  assert.match(backupRestore, /manifest\.sha256/);
  assert.match(backupRestore, /PostgreSQL.*S3\/MinIO|S3\/MinIO.*PostgreSQL/s);
  assert.match(backupRestore, /-RecoverySetDirectory/);
  assert.match(backupRestore, /不保留[^。]*(对象版本|版本 ID)[^。]*标签[^。]*自定义元数据/);
  assert.match(backupRestore, /对象键[^。]*宿主文件系统[^。]*(映射|限制)/);
  assert.match(backupRestore, /只能停止[^。]*Compose[^。]*外部写入者[^。]*生命周期规则/);
  assert.match(deployment, /\/api\/realtime\/events/);
  assert.match(deployment, /proxy_buffering off/);
  assert.doesNotMatch(deployment, /只备份 PostgreSQL，不包含照片对象/);
  assert.match(backupRestore, /\/api\/health[^。]*(数据库|PostgreSQL)[^。]*(对象存储|S3)/);
  assert.match(deployment, /api \/api\/health[^。]*(数据库|PostgreSQL)[^。]*(对象存储|S3)/);
  assert.doesNotMatch(backupRestore, /\/api\/health[^。]*不是数据库和 S3 深度检查/);
  assert.doesNotMatch(deployment, /api \/api\/health[^。]*不执行数据库或外部 Provider 探测/);
});
