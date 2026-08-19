import { describe, expect, it } from "vitest";
import type { AppConfig } from "./config.js";
import { assertDatabaseSeedConfig } from "./database-seed-runner.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "development",
    otpTtlSeconds: 300,
    secureCookies: false,
    trustProxy: false,
    databaseUrl: "postgresql://local/database",
    encryptionKey: "local-secret",
    allowedOrigins: [],
    adminPhones: [],
    smsProvider: "console",
    objectStorageProvider: "s3",
    s3Endpoint: "http://127.0.0.1:9000",
    s3Region: "us-east-1",
    s3AccessKey: "minioadmin",
    s3SecretKey: "secret",
    s3Bucket: "photos",
    s3PublicBaseUrl: "http://127.0.0.1:9000/photos",
    s3ForcePathStyle: true,
    avatarModelProvider: "deterministic",
    ...overrides,
  };
}

describe("database seed runtime configuration", () => {
  it("requires PostgreSQL persistence", () => {
    expect(() => assertDatabaseSeedConfig(config({ databaseUrl: undefined }))).toThrow(
      "DATABASE_URL is required",
    );
  });

  it("requires persistent S3-compatible photo storage", () => {
    expect(() => assertDatabaseSeedConfig(config({ objectStorageProvider: "data-url" }))).toThrow(
      "OBJECT_STORAGE_PROVIDER=s3 is required",
    );
  });

  it("accepts a complete local PostgreSQL and MinIO configuration", () => {
    expect(assertDatabaseSeedConfig(config())).toEqual({
      databaseUrl: "postgresql://local/database",
      encryptionKey: "local-secret",
    });
  });
});
