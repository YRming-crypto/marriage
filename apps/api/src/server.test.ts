import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore, type StorePersistence } from "./store/index.js";

const app = buildServer();

afterEach(async () => {
  await app.ready();
});

describe("API", () => {
  it("提供健康检查", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "healthy",
      service: "ai-marriage-api",
      components: expect.arrayContaining([
        { name: "api", status: "healthy" },
        { name: "object-storage", status: "healthy" },
        { name: "realtime", status: "healthy" },
        { name: "store", status: "healthy", detail: expect.any(String) },
      ]),
    });
  });

  it("依赖探测失败时健康接口返回 503", async () => {
    const store = createMemoryStore([]);
    store.persistence = new Proxy({
      hydrate: vi.fn().mockResolvedValue(undefined),
      loadContentActivityState: vi.fn().mockResolvedValue(undefined),
      loadAvatarKnowledgeState: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi.fn().mockRejectedValue(new Error("database unavailable")),
      close: vi.fn().mockResolvedValue(undefined),
    }, {
      get(target, property) {
        return Reflect.get(target, property) ?? vi.fn().mockResolvedValue(undefined);
      },
    }) as unknown as StorePersistence;
    const failingApp = buildServer({
      store,
      providers: {
        objectStorage: {
          upload: vi.fn(),
          read: vi.fn(),
          delete: vi.fn(),
          healthCheck: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
    const response = await failingApp.inject({ method: "GET", url: "/api/health" });
    await failingApp.close();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "unhealthy",
      service: "ai-marriage-api",
      components: expect.arrayContaining([
        { name: "database", status: "unhealthy", detail: expect.any(String) },
        { name: "object-storage", status: "healthy" },
      ]),
    });
    expect(JSON.stringify(response.json())).not.toContain("database unavailable");
  });

  it("公开成员接口不返回内部算法字段", async () => {
    const response = await app.inject({ method: "GET", url: "/api/members" });
    const body = response.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/prompt|weight|answer/i);
  });

  it("允许用户端跨域预检资料保存 PATCH 请求", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/me/profile",
      headers: {
        origin: "http://127.0.0.1:4183",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "content-type",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4183");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  it("允许用户端跨域预检建档草稿 PUT 请求", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/me/onboarding-draft",
      headers: {
        origin: "http://127.0.0.1:4183",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4183");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");
  });

  it("拒绝未列入白名单的网站携带用户凭证", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/me/profile",
      headers: {
        origin: "https://malicious.example",
        "access-control-request-method": "PATCH",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("ORIGIN_NOT_ALLOWED");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("非法来源的简单 POST 请求不会执行处理器", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      headers: { origin: "https://malicious.example" },
      payload: { phone: "13800138000" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("ORIGIN_NOT_ALLOWED");
  });
});
