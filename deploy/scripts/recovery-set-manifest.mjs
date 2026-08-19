#!/usr/bin/env node

import { createReadStream } from "node:fs";
import {
  lstat,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";

const manifestName = "manifest.sha256";
const requiredEntries = ["database.dump", "recovery-set.json"];

function abort(message) {
  throw new Error(message);
}

async function assertDirectory(path, label) {
  const info = await lstat(path).catch(() => null);
  if (info?.isSymbolicLink()) abort(`${label} must not be a symbolic link: ${path}`);
  if (!info?.isDirectory()) abort(`${label} not found or not a directory: ${path}`);
}

async function assertRegularFile(path, label) {
  const info = await lstat(path).catch(() => null);
  if (info?.isSymbolicLink()) abort(`${label} must not be a symbolic link: ${path}`);
  if (!info?.isFile()) abort(`${label} not found or not a regular file: ${path}`);
}

async function assertRecoveryLayout(root) {
  await assertDirectory(root, "Recovery-set root");
  await assertRegularFile(join(root, "database.dump"), "Database archive");
  await assertRegularFile(join(root, "recovery-set.json"), "Recovery-set metadata");
  await assertDirectory(join(root, "objects"), "Objects directory");
}

async function collectFiles(root, directory = root, excludeRootManifest = true) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relative(root, absolutePath).split(sep).join("/");
    const info = await lstat(absolutePath);

    if (info.isSymbolicLink()) abort(`Symbolic links are not allowed: ${relativePath}`);
    if (info.isDirectory()) {
      files.push(...await collectFiles(root, absolutePath, excludeRootManifest));
      continue;
    }
    if (!info.isFile()) abort(`Unsupported filesystem entry: ${relativePath}`);
    if (!excludeRootManifest || relativePath !== manifestName) files.push(relativePath);
  }

  return files.sort((left, right) => left.localeCompare(right, "en"));
}

async function hashFile(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

function assertRequiredEntries(files) {
  for (const entry of requiredEntries) {
    if (!files.includes(entry)) abort(`Required recovery-set file is missing: ${entry}`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isPlainObject(value)) abort(`Recovery-set metadata schema error: ${label} must be an object`);
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actualKeys.length !== expected.length || actualKeys.some((key, index) => key !== expected[index])) {
    abort(`Recovery-set metadata schema error: unexpected ${label} keys: ${actualKeys.join(", ")}`);
  }
}

function assertNonEmptyString(value, label, maxLength = 255) {
  if (typeof value !== "string" || !value || value.length > maxLength || /[\0\r\n]/.test(value)) {
    abort(`Recovery-set metadata schema error: ${label} must be a non-empty string of at most ${maxLength} characters`);
  }
}

function validateRecoveryMetadata(metadata) {
  assertExactKeys(metadata, [
    "formatVersion",
    "recoverySetId",
    "createdAt",
    "applicationRevision",
    "database",
    "objectStorage",
  ], "top-level");
  if (metadata.formatVersion !== 1) abort("Recovery-set metadata schema error: formatVersion must be 1");
  if (typeof metadata.recoverySetId !== "string" || !/^ai-marriage-\d{8}T\d{6}Z$/.test(metadata.recoverySetId)) {
    abort("Recovery-set metadata schema error: recoverySetId has an invalid format");
  }
  if (
    typeof metadata.createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(metadata.createdAt) ||
    !Number.isFinite(Date.parse(metadata.createdAt))
  ) {
    abort("Recovery-set metadata schema error: createdAt must be a UTC ISO-8601 timestamp");
  }
  if (
    typeof metadata.applicationRevision !== "string" ||
    !/^(?:unknown|[a-f0-9]{7,64})$/.test(metadata.applicationRevision)
  ) {
    abort("Recovery-set metadata schema error: applicationRevision must be 'unknown' or a Git revision");
  }

  assertExactKeys(metadata.database, ["file", "name", "format"], "database");
  if (metadata.database.file !== "database.dump") {
    abort("Recovery-set metadata schema error: database.file must be database.dump");
  }
  assertNonEmptyString(metadata.database.name, "database.name", 63);
  if (metadata.database.format !== "postgresql-custom") {
    abort("Recovery-set metadata schema error: database.format must be postgresql-custom");
  }

  assertExactKeys(metadata.objectStorage, ["directory", "bucket", "region", "endpoint"], "objectStorage");
  if (metadata.objectStorage.directory !== "objects") {
    abort("Recovery-set metadata schema error: objectStorage.directory must be objects");
  }
  assertNonEmptyString(metadata.objectStorage.bucket, "objectStorage.bucket", 255);
  assertNonEmptyString(metadata.objectStorage.region, "objectStorage.region", 255);
  if (typeof metadata.objectStorage.endpoint !== "string" || /[\0\r\n]/.test(metadata.objectStorage.endpoint)) {
    abort("Recovery-set metadata schema error: objectStorage.endpoint must be a string");
  }
  if (metadata.objectStorage.endpoint) {
    let endpoint;
    try {
      endpoint = new URL(metadata.objectStorage.endpoint);
    } catch {
      abort("Recovery-set metadata schema error: objectStorage.endpoint must be an HTTP(S) URL or empty");
    }
    if (!["http:", "https:"].includes(endpoint.protocol)) {
      abort("Recovery-set metadata schema error: objectStorage.endpoint must be an HTTP(S) URL or empty");
    }
    if (endpoint.username || endpoint.password) {
      abort("Recovery-set metadata schema error: objectStorage.endpoint must not contain credentials or userinfo");
    }
    if (endpoint.search) {
      abort("Recovery-set metadata schema error: objectStorage.endpoint must not contain a query or secret token");
    }
    if (endpoint.hash) {
      abort("Recovery-set metadata schema error: objectStorage.endpoint must not contain a fragment");
    }
  }
  return metadata;
}

async function readRecoveryMetadata(root) {
  let metadata;
  try {
    const json = await readFile(join(root, "recovery-set.json"), "utf8");
    metadata = JSON.parse(json.replace(/^\uFEFF/, ""));
  } catch (error) {
    abort(`Recovery-set metadata schema error: invalid JSON (${error.message})`);
  }
  return validateRecoveryMetadata(metadata);
}

function assertSafeManifestPath(path) {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.includes("\n") ||
    path.includes("\r") ||
    posix.normalize(path) !== path ||
    path === ".." ||
    path.startsWith("../") ||
    path === manifestName
  ) {
    abort(`Unsafe manifest path: ${JSON.stringify(path)}`);
  }
}

async function createManifest(rootArgument) {
  const root = resolve(rootArgument);
  await assertRecoveryLayout(root);
  await readRecoveryMetadata(root);
  const files = await collectFiles(root);
  assertRequiredEntries(files);

  const lines = [];
  for (const file of files) {
    assertSafeManifestPath(file);
    lines.push(`${await hashFile(join(root, ...file.split("/")))}  ${file}`);
  }

  const manifestPath = join(root, manifestName);
  const temporaryPath = `${manifestPath}.partial`;
  try {
    await writeFile(temporaryPath, `${lines.join("\n")}\n`, { encoding: "ascii", flag: "wx" });
    await rename(temporaryPath, manifestPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  process.stdout.write(`Recovery-set manifest created: ${files.length} files\n`);
}

async function readExpectedManifest(root) {
  const manifestPath = join(root, manifestName);
  const rawManifest = await readFile(manifestPath, "ascii").catch(() => {
    abort(`Manifest not found: ${manifestPath}`);
  });
  const lines = rawManifest.split(/\r?\n/).filter(Boolean);
  const expected = new Map();

  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) abort(`Malformed manifest line: ${JSON.stringify(line)}`);
    const [, digest, path] = match;
    assertSafeManifestPath(path);
    if (expected.has(path)) abort(`Duplicate manifest path: ${path}`);
    expected.set(path, digest);
  }
  return expected;
}

async function verifyFileSet(root, actualFiles, expected, labels) {
  const actualSet = new Set(actualFiles);
  const missing = [...expected.keys()].filter((path) => !actualSet.has(path));
  const unexpected = actualFiles.filter((path) => !expected.has(path));
  if (missing.length) abort(`${labels.missing}: ${missing.join(", ")}`);
  if (unexpected.length) abort(`${labels.unexpected}: ${unexpected.join(", ")}`);

  for (const [path, expectedDigest] of expected) {
    const actualDigest = await hashFile(join(root, ...path.split("/")));
    if (actualDigest !== expectedDigest) abort(`SHA-256 mismatch: ${path}`);
  }
}

async function verifyManifest(rootArgument) {
  const root = resolve(rootArgument);
  await assertRecoveryLayout(root);
  await readRecoveryMetadata(root);
  const expected = await readExpectedManifest(root);

  const actualFiles = await collectFiles(root);
  assertRequiredEntries(actualFiles);
  await verifyFileSet(root, actualFiles, expected, {
    missing: "Files missing from recovery set",
    unexpected: "Files missing from manifest",
  });

  process.stdout.write(`Recovery set verified: ${actualFiles.length} files\n`);
}

async function verifyRemoteObjects(rootArgument, downloadedObjectsArgument) {
  const root = resolve(rootArgument);
  const downloadedObjects = resolve(downloadedObjectsArgument);
  await assertRecoveryLayout(root);
  await readRecoveryMetadata(root);
  await assertDirectory(downloadedObjects, "Downloaded objects directory");
  const manifest = await readExpectedManifest(root);
  const expectedObjects = new Map(
    [...manifest]
      .filter(([path]) => path.startsWith("objects/"))
      .map(([path, digest]) => [path.slice("objects/".length), digest]),
  );
  const actualObjects = await collectFiles(downloadedObjects, downloadedObjects, false);
  await verifyFileSet(downloadedObjects, actualObjects, expectedObjects, {
    missing: "Objects missing from restored bucket",
    unexpected: "Unexpected objects in restored bucket",
  });
  process.stdout.write(`Remote objects verified: ${actualObjects.length} files\n`);
}

async function printMetadataValue(rootArgument, key) {
  const root = resolve(rootArgument);
  await assertRecoveryLayout(root);
  const metadata = await readRecoveryMetadata(root);
  const values = {
    "database.name": metadata.database.name,
    "objectStorage.bucket": metadata.objectStorage.bucket,
  };
  if (!Object.hasOwn(values, key)) abort(`Unsupported recovery-set metadata key: ${key}`);
  process.stdout.write(values[key]);
}

function parseEnvironment(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\([\\"nrt])/g, (_, escaped) => ({
        "\\": "\\",
        '"': '"',
        n: "\n",
        r: "\r",
        t: "\t",
      })[escaped]);
    } else {
      value = value.replace(/\s+#.*$/, "").trimEnd();
    }
    values.set(key, value);
  }
  return values;
}

async function printEnvironmentValue(file, key) {
  const values = parseEnvironment(await readFile(resolve(file), "utf8"));
  if (!values.has(key)) abort(`Environment key is not defined: ${key}`);
  process.stdout.write(values.get(key));
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function printComposeEnvironmentValue(serviceName, key) {
  let config;
  try {
    config = JSON.parse(await readStandardInput());
  } catch (error) {
    abort(`Resolved Compose config is not valid JSON (${error.message})`);
  }
  const environment = config?.services?.[serviceName]?.environment;
  let values;
  if (isPlainObject(environment)) {
    values = environment;
  } else if (Array.isArray(environment)) {
    values = Object.fromEntries(environment.map((entry) => {
      const separator = typeof entry === "string" ? entry.indexOf("=") : -1;
      if (separator < 1) abort(`Resolved Compose service environment for '${serviceName}' contains an invalid entry`);
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }));
  } else {
    abort(`Resolved Compose service environment for '${serviceName}' is missing`);
  }
  if (!Object.hasOwn(values, key) || values[key] === null || values[key] === undefined) {
    abort(`Resolved Compose service environment key is not defined: ${key}`);
  }
  if (typeof values[key] !== "string") {
    abort(`Resolved Compose service environment value must be a string: ${key}`);
  }
  process.stdout.write(values[key]);
}

async function main() {
  const [command, first, second, third] = process.argv.slice(2);
  if (command === "create" && first && !second) return createManifest(first);
  if (command === "verify" && first && !second) return verifyManifest(first);
  if (command === "verify-objects" && first && second && !third) return verifyRemoteObjects(first, second);
  if (command === "metadata" && first && second && !third) return printMetadataValue(first, second);
  if (command === "env" && first && second && !third) return printEnvironmentValue(first, second);
  if (command === "compose-env" && first && second && !third) return printComposeEnvironmentValue(first, second);
  abort("Usage: recovery-set-manifest.mjs <create|verify> RECOVERY_SET_DIRECTORY | verify-objects RECOVERY_SET_DIRECTORY DOWNLOADED_OBJECTS_DIRECTORY | metadata RECOVERY_SET_DIRECTORY KEY | env ENV_FILE KEY | compose-env SERVICE KEY < compose-config.json");
}

main().catch((error) => {
  const prefix = process.argv[2]?.startsWith("verify")
    ? "Recovery-set manifest verification failed"
    : "Recovery-set operation failed";
  process.stderr.write(`${prefix}: ${error.message}\n`);
  process.exitCode = 1;
});
