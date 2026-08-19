import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config.js";

describe("生产环境配置", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function productionEnvironment() {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://app:secret@db.example:5432/app");
    vi.stubEnv("APP_ENCRYPTION_KEY", "a-production-encryption-key-with-at-least-32-characters");
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "https://example.com");
  }

  it("缺少数据库时拒绝启动", () => {
    productionEnvironment();
    vi.stubEnv("DATABASE_URL", undefined);

    expect(() => getConfig()).toThrow("DATABASE_URL is required in production.");
  });

  it("缺少独立加密密钥时拒绝启动", () => {
    productionEnvironment();
    vi.stubEnv("APP_ENCRYPTION_KEY", undefined);

    expect(() => getConfig()).toThrow("APP_ENCRYPTION_KEY is required in production.");
  });

  it("拒绝示例文件中的公开占位密钥", () => {
    productionEnvironment();
    vi.stubEnv("APP_ENCRYPTION_KEY", "replace-with-a-long-random-secret");

    expect(() => getConfig()).toThrow("APP_ENCRYPTION_KEY must not use the public placeholder value in production.");
  });

  it("生产配置完整时返回显式数据库、密钥和来源", () => {
    productionEnvironment();

    expect(getConfig()).toMatchObject({
      databaseUrl: "postgresql://app:secret@db.example:5432/app",
      encryptionKey: "a-production-encryption-key-with-at-least-32-characters",
      allowedOrigins: ["https://example.com"],
      secureCookies: true,
      trustProxy: true,
      otpCode: undefined,
    });
  });

  it("配置管理员手机号时要求独立后台访问码", () => {
    productionEnvironment();
    vi.stubEnv("ADMIN_PHONES", "13900139999");
    vi.stubEnv("ADMIN_ACCESS_CODE", undefined);

    expect(() => getConfig()).toThrow("ADMIN_ACCESS_CODE is required when ADMIN_PHONES is configured in production.");
  });
});
