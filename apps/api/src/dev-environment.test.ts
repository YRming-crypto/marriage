import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyDevelopmentStoreOverride,
  developmentEnvFilePath,
  enableDevelopmentOtp,
  prepareDevelopmentEnvironment,
} from "./dev-environment.js";

describe("开发启动环境", () => {
  it("拒绝覆盖生产环境并开启固定验证码", () => {
    const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

    expect(() => enableDevelopmentOtp(env)).toThrow("Refusing to enable development OTP in production.");
    expect(env.NODE_ENV).toBe("production");
    expect(env.ALLOW_DEV_OTP).toBeUndefined();
  });

  it("只在非生产环境启用本地开发验证码", () => {
    const env = {} as NodeJS.ProcessEnv;

    enableDevelopmentOtp(env);

    expect(env.NODE_ENV).toBe("development");
    expect(env.ALLOW_DEV_OTP).toBe("true");
  });

  it("先加载 .env 再判断是否允许开发验证码", () => {
    const env = {} as NodeJS.ProcessEnv;

    expect(() => prepareDevelopmentEnvironment(() => {
      env.NODE_ENV = "production";
    }, env)).toThrow("Refusing to enable development OTP in production.");
    expect(env.NODE_ENV).toBe("production");
    expect(env.ALLOW_DEV_OTP).toBeUndefined();
  });

  it("始终从项目根目录加载开发环境文件", () => {
    const env = {} as NodeJS.ProcessEnv;
    let loadedPath = "";

    prepareDevelopmentEnvironment((path) => {
      loadedPath = path;
    }, env);

    expect(loadedPath).toBe(developmentEnvFilePath);
    expect(loadedPath).toBe(resolve(process.cwd(), "../../.env"));
  });

  it("显式启用内存模式时在加载 .env 后移除数据库连接", () => {
    const env = { USE_IN_MEMORY_STORE: "true" } as NodeJS.ProcessEnv;

    prepareDevelopmentEnvironment(() => {
      env.NODE_ENV = "development";
      env.DATABASE_URL = "postgresql://localhost/app";
    }, env);

    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.ALLOW_DEV_OTP).toBe("true");
  });

  it("服务重新加载 .env 后仍会应用开发内存模式", () => {
    const env = {
      NODE_ENV: "development",
      USE_IN_MEMORY_STORE: "true",
      DATABASE_URL: "postgresql://localhost/app",
    } as NodeJS.ProcessEnv;

    applyDevelopmentStoreOverride(env);

    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("生产环境永远保留数据库连接", () => {
    const env = {
      NODE_ENV: "production",
      USE_IN_MEMORY_STORE: "true",
      DATABASE_URL: "postgresql://localhost/app",
    } as NodeJS.ProcessEnv;

    applyDevelopmentStoreOverride(env);

    expect(env.DATABASE_URL).toBe("postgresql://localhost/app");
  });
});
