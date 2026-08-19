import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";

describe("production provider configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function baseProductionEnvironment() {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://app:secret@db.example:5432/app");
    vi.stubEnv("APP_ENCRYPTION_KEY", "a-production-encryption-key-with-at-least-32-characters");
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "https://example.com");
    vi.stubEnv("SMS_PROVIDER", "console");
    vi.stubEnv("OBJECT_STORAGE_PROVIDER", "data-url");
    vi.stubEnv("AVATAR_MODEL_PROVIDER", "deterministic");
  }

  it("requires an HTTP SMS webhook in production", () => {
    baseProductionEnvironment();

    expect(() => buildServer()).toThrow("SMS_PROVIDER=http and SMS_WEBHOOK_URL are required in production.");
  });

  it("forbids data URL object storage in production", () => {
    baseProductionEnvironment();
    vi.stubEnv("SMS_PROVIDER", "http");
    vi.stubEnv("SMS_WEBHOOK_URL", "https://sms.example/send");

    expect(() => buildServer()).toThrow("OBJECT_STORAGE_PROVIDER=s3 is required in production; data URL storage is forbidden.");
  });

  it("requires OpenAI-compatible avatar model settings in production", () => {
    baseProductionEnvironment();
    vi.stubEnv("SMS_PROVIDER", "http");
    vi.stubEnv("SMS_WEBHOOK_URL", "https://sms.example/send");
    vi.stubEnv("OBJECT_STORAGE_PROVIDER", "s3");
    vi.stubEnv("S3_REGION", "us-east-1");
    vi.stubEnv("S3_ACCESS_KEY", "access-key");
    vi.stubEnv("S3_SECRET_KEY", "secret-key");
    vi.stubEnv("S3_BUCKET", "marriage-photos");
    vi.stubEnv("S3_PUBLIC_BASE_URL", "https://cdn.example/photos");

    expect(() => buildServer()).toThrow(
      "AVATAR_MODEL_PROVIDER=openai, AVATAR_MODEL_ENDPOINT, AVATAR_MODEL_API_KEY and AVATAR_MODEL_NAME are required in production.",
    );
  });

  it("accepts a complete production provider configuration", async () => {
    baseProductionEnvironment();
    vi.stubEnv("SMS_PROVIDER", "http");
    vi.stubEnv("SMS_WEBHOOK_URL", "https://sms.example/send");
    vi.stubEnv("OBJECT_STORAGE_PROVIDER", "s3");
    vi.stubEnv("S3_REGION", "us-east-1");
    vi.stubEnv("S3_ACCESS_KEY", "access-key");
    vi.stubEnv("S3_SECRET_KEY", "secret-key");
    vi.stubEnv("S3_BUCKET", "marriage-photos");
    vi.stubEnv("S3_PUBLIC_BASE_URL", "https://cdn.example/photos");
    vi.stubEnv("AVATAR_MODEL_PROVIDER", "openai");
    vi.stubEnv("AVATAR_MODEL_ENDPOINT", "https://model.example/v1/chat/completions");
    vi.stubEnv("AVATAR_MODEL_API_KEY", "model-key");
    vi.stubEnv("AVATAR_MODEL_NAME", "safe-chat");

    const app = buildServer();
    await app.close();
  });
});
