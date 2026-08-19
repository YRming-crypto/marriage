import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("OTP request", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    try {
      await Promise.all(apps.map((app) => app.close()));
    } finally {
      apps.length = 0;
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });

  function createApp(options: Parameters<typeof buildServer>[0] = {}) {
    const app = buildServer({ store: createMemoryStore(), ...options });
    apps.push(app);
    return app;
  }

  it("returns the explicitly configured OTP as a development code", async () => {
    const app = createApp({ otpCode: "123456", otpTtlSeconds: 180 });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone: "13800138000" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: { sent: true, expiresIn: 180, devCode: "123456" },
    });
  });

  it("returns and verifies the default OTP when development mode explicitly allows it", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_OTP", "true");
    vi.stubEnv("DEV_OTP_CODE", undefined);
    const app = createApp();

    const requestResponse = await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone: "13800138000" },
    });

    expect(requestResponse.statusCode).toBe(200);
    expect(requestResponse.json()).toEqual({
      data: { sent: true, expiresIn: 300, devCode: "123456" },
    });

    const verifyResponse = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { phone: "13800138000", code: "123456" },
    });

    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.json().data.user.phoneMasked).toBe("138****8000");
  });

  it("uses a configured development OTP only when development mode explicitly allows it", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_OTP", "true");
    vi.stubEnv("DEV_OTP_CODE", "654321");
    const app = createApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone: "13800138000" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: { sent: true, expiresIn: 300, devCode: "654321" },
    });
  });

  it("does not enable a development OTP when NODE_ENV is missing", async () => {
    vi.stubEnv("NODE_ENV", undefined);
    vi.stubEnv("ALLOW_DEV_OTP", "true");
    vi.stubEnv("DEV_OTP_CODE", "123456");
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const app = createApp();

    const requestResponse = await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone: "13800138000" },
    });

    expect(requestResponse.statusCode).toBe(200);
    expect(requestResponse.json()).toEqual({ data: { sent: true, expiresIn: 300 } });

    const verifyResponse = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { phone: "13800138000", code: "123456" },
    });

    expect(verifyResponse.statusCode).toBe(400);
    expect(verifyResponse.json().error.code).toBe("OTP_INVALID");
    expect(randomSpy).toHaveBeenCalled();
  });

  it.each([undefined, "developmnt", "staging"])(
    "ignores an explicit OTP when NODE_ENV is unknown: %s",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("ALLOW_DEV_OTP", "true");
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      const app = createApp({ otpCode: "123456" });

      const requestResponse = await app.inject({
        method: "POST",
        url: "/api/auth/otp/request",
        payload: { phone: "13800138000" },
      });

      expect(requestResponse.statusCode).toBe(200);
      expect(requestResponse.json()).toEqual({ data: { sent: true, expiresIn: 300 } });

      const verifyResponse = await app.inject({
        method: "POST",
        url: "/api/auth/otp/verify",
        payload: { phone: "13800138000", code: "123456" },
      });

      expect(verifyResponse.statusCode).toBe(400);
      expect(verifyResponse.json().error.code).toBe("OTP_INVALID");
      expect(randomSpy).toHaveBeenCalled();
    },
  );

  it("ignores every development OTP source in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEV_OTP", "true");
    vi.stubEnv("DEV_OTP_CODE", "123456");
    vi.stubEnv("DATABASE_URL", "postgresql://app:secret@db.example:5432/app");
    vi.stubEnv("APP_ENCRYPTION_KEY", "a-production-encryption-key-with-at-least-32-characters");
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "https://example.com");
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const app = createApp({ otpCode: "123456", databaseUrl: undefined });

    const requestResponse = await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone: "13800138000" },
    });

    expect(requestResponse.statusCode).toBe(200);
    expect(requestResponse.json()).toEqual({
      data: { sent: true, expiresIn: 300 },
    });

    const verifyResponse = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { phone: "13800138000", code: "123456" },
    });

    expect(verifyResponse.statusCode).toBe(400);
    expect(verifyResponse.json().error.code).toBe("OTP_INVALID");
    expect(randomSpy).toHaveBeenCalled();
  });

  it.each(["12345", "1234567", "abcdef"])("rejects invalid explicit development OTP %s at startup", (otpCode) => {
    vi.stubEnv("NODE_ENV", "test");

    expect(() => createApp({ otpCode })).toThrowError("Development OTP code must be exactly 6 digits.");
  });

  it("rejects an invalid enabled development OTP from the environment at startup", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_OTP", "true");
    vi.stubEnv("DEV_OTP_CODE", "12ab56");

    expect(() => createApp()).toThrowError("Development OTP code must be exactly 6 digits.");
  });

  it.each([undefined, "", "1380013800", "12800138000", "10000000000", "23800138000", "1380013800a"])(
    "rejects invalid phone value %s without returning OTP data",
    async (phone) => {
      const app = createApp({ otpCode: "123456" });

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/otp/request",
        payload: { phone },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "PHONE_INVALID" } });
      expect(response.json()).not.toHaveProperty("data");
    },
  );

  it("limits repeated OTP sends for the same phone", async () => {
    const app = createApp({ otpCode: "123456" });

    const first = await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone: "13800138000" },
    });
    const repeated = await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone: "13800138000" },
    });

    expect(first.statusCode).toBe(200);
    expect(repeated.statusCode).toBe(429);
    expect(repeated.headers["retry-after"]).toBeTruthy();
    expect(repeated.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("在可信反向代理后按真实客户端 IP 分别限流", async () => {
    const app = createApp({ otpCode: "123456", trustProxy: true } as Parameters<typeof buildServer>[0]);

    for (let index = 0; index < 20; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/otp/request",
        headers: { "x-forwarded-for": "203.0.113.10" },
        payload: { phone: `1380000${String(index).padStart(4, "0")}` },
      });
      expect(response.statusCode).toBe(200);
    }

    const otherClient = await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      headers: { "x-forwarded-for": "203.0.113.11" },
      payload: { phone: "13900009999" },
    });

    expect(otherClient.statusCode).toBe(200);
  });

  it("invalidates an OTP after five failed verification attempts", async () => {
    const app = createApp({ otpCode: "123456" });
    await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone: "13800138000" },
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await app.inject({
        method: "POST",
        url: "/api/auth/otp/verify",
        payload: { phone: "13800138000", code: "000000" },
      });
      expect(failed.statusCode).toBe(400);
    }

    const correctAfterLockout = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { phone: "13800138000", code: "123456" },
    });
    expect(correctAfterLockout.statusCode).toBe(400);
    expect(correctAfterLockout.json()).toMatchObject({ error: { code: "OTP_INVALID" } });
  });
});
