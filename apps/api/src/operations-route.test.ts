import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";
import type { Store, StorePersistence, StoredDataExport, StoredUser } from "./store/types.js";

describe("运维中心 HTTP 集成", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  function addAuthenticatedUser(store: Store, token: string, role: StoredUser["role"] = "user") {
    const user: StoredUser = {
      id: `user-${token}`,
      phone: role === "admin" ? "13900139999" : "13800138000",
      role,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    store.users.set(user.id, user);
    store.usersByPhone.set(user.phone, user.id);
    store.sessions.set(token, {
      id: `session-${token}`,
      userId: user.id,
      expiresAt: Date.now() + 60_000,
      userAgent: "operations-test",
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    });
    return { user, cookie: `refresh_token=${token}` };
  }

  function createApp(store = createMemoryStore()) {
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);
    return app;
  }

  function persistence(overrides: Partial<StorePersistence>) {
    return new Proxy({
      hydrate: async () => undefined,
      close: async () => undefined,
      ...overrides,
    }, {
      get(target, property) {
        return Reflect.get(target, property) ?? (async () => undefined);
      },
    }) as StorePersistence;
  }

  it("只允许管理员查看运维摘要", async () => {
    const store = createMemoryStore();
    const member = addAuthenticatedUser(store, "member-token");
    const app = createApp(store);

    const anonymous = await app.inject({ method: "GET", url: "/api/admin/operations" });
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/admin/operations",
      headers: { cookie: member.cookie },
    });

    expect(anonymous.statusCode).toBe(401);
    expect(forbidden.statusCode).toBe(403);
  });

  it("汇总请求指标和已注册的组件健康状态", async () => {
    const store = createMemoryStore();
    const admin = addAuthenticatedUser(store, "admin-token", "admin");
    const app = createApp(store);

    await app.inject({ method: "GET", url: "/api/health" });
    await app.inject({ method: "GET", url: "/api/not-a-real-route" });
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/operations",
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.operations).toMatchObject({
      health: { status: "healthy" },
      requests: { requestCount: 2, errorCount: 1, errorRate: 0.5 },
      maintenance: { runningCount: 0, succeededCount: 0, failedCount: 0, totalRemoved: 0 },
      recentErrors: [],
    });
    expect(response.json().data.operations.health.components.map((item: { name: string }) => item.name)).toEqual([
      "api",
      "object-storage",
      "realtime",
      "store",
    ]);
    expect(response.json().data.operations.requests.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "GET", route: "/api/health", requestCount: 1 }),
      expect.objectContaining({ method: "GET", route: "/api/not-a-real-route", requestCount: 1, errorCount: 1 }),
    ]));
  });

  it("把未处理异常记录为结构化脱敏日志", async () => {
    const store = createMemoryStore();
    const admin = addAuthenticatedUser(store, "admin-error-token", "admin");
    const target = addAuthenticatedUser(store, "target-token");
    store.blocks.set(`${admin.user.id}:${target.user.id}`, {
      id: "block-1",
      blockerUserId: admin.user.id,
      blockedUserId: target.user.id,
      createdAt: new Date().toISOString(),
    });
    store.persistence = persistence({
      deleteBlockState: vi.fn().mockRejectedValue(
        new Error("database failed token=private-token phone=13800138000"),
      ),
    });
    const app = createApp(store);

    const failed = await app.inject({
      method: "DELETE",
      url: `/api/users/${target.user.id}/block`,
      headers: { cookie: admin.cookie },
    });
    const summary = await app.inject({
      method: "GET",
      url: "/api/admin/operations",
      headers: { cookie: admin.cookie },
    });
    const serialized = JSON.stringify(summary.json().data.operations.recentErrors);

    expect(failed.statusCode).toBe(500);
    expect(summary.statusCode).toBe(200);
    expect(summary.json().data.operations.recentErrors).toEqual([
      expect.objectContaining({
        level: "error",
        event: "request.failed",
        context: expect.objectContaining({ method: "DELETE", route: "/api/users/:userId/block", statusCode: 500 }),
      }),
    ]);
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("13800138000");
    expect(serialized).toContain("[REDACTED]");
  });

  it("清理过期 OTP、会话和数据导出并保留有效资源", async () => {
    const now = Date.now();
    const store = createMemoryStore();
    const admin = addAuthenticatedUser(store, "admin-cleanup-token", "admin");
    store.otpRequests.set("13800138001", { phone: "13800138001", code: "111111", expiresAt: now - 1 });
    store.otpRequests.set("13800138002", { phone: "13800138002", code: "222222", expiresAt: now + 60_000 });
    store.sessions.set("expired-session-token", {
      id: "expired-session",
      userId: admin.user.id,
      expiresAt: now - 1,
      userAgent: "old-device",
      createdAt: new Date(now - 120_000).toISOString(),
      lastUsedAt: new Date(now - 120_000).toISOString(),
    });
    const expiredExport: StoredDataExport = {
      id: "expired-export",
      userId: admin.user.id,
      status: "ready",
      payload: { phone: "13800138001", privateProfile: true },
      createdAt: new Date(now - 120_000).toISOString(),
      readyAt: new Date(now - 120_000).toISOString(),
      expiresAt: new Date(now - 1).toISOString(),
    };
    const validExport: StoredDataExport = {
      ...expiredExport,
      id: "valid-export",
      payload: { stillAvailable: true },
      expiresAt: new Date(now + 60_000).toISOString(),
    };
    store.dataExports.set(expiredExport.id, expiredExport);
    store.dataExports.set(validExport.id, validExport);
    const deleteOtpRequest = vi.fn().mockResolvedValue(undefined);
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    const persistDataExport = vi.fn().mockResolvedValue(undefined);
    store.persistence = persistence({ deleteOtpRequest, deleteSession, persistDataExport });
    const app = createApp(store);

    const response = await app.inject({
      method: "POST",
      url: "/api/admin/operations/cleanup",
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.run).toMatchObject({
      taskName: "expired-resources",
      actorId: admin.user.id,
      status: "succeeded",
      totalRemoved: 3,
      results: [
        { target: "accountDeletions", status: "succeeded", removedCount: 0 },
        { target: "otp", status: "succeeded", removedCount: 1 },
        { target: "sessions", status: "succeeded", removedCount: 1 },
        { target: "dataExports", status: "succeeded", removedCount: 1 },
      ],
    });
    expect(store.otpRequests.has("13800138001")).toBe(false);
    expect(store.otpRequests.has("13800138002")).toBe(true);
    expect(store.sessions.has("expired-session-token")).toBe(false);
    expect(store.sessions.has("admin-cleanup-token")).toBe(true);
    expect(store.dataExports.get("expired-export")).toMatchObject({ status: "expired", payload: null });
    expect(store.dataExports.get("valid-export")).toEqual(validExport);
    expect(deleteOtpRequest).toHaveBeenCalledWith("13800138001");
    expect(deleteSession).toHaveBeenCalledWith("expired-session-token");
    expect(persistDataExport).toHaveBeenCalledWith(expect.objectContaining({
      id: "expired-export",
      status: "expired",
      payload: null,
    }));

    const repeated = await app.inject({
      method: "POST",
      url: "/api/admin/operations/cleanup",
      headers: { cookie: admin.cookie },
    });
    const summary = await app.inject({
      method: "GET",
      url: "/api/admin/operations",
      headers: { cookie: admin.cookie },
    });

    expect(repeated.statusCode).toBe(201);
    expect(repeated.json().data.run.totalRemoved).toBe(0);
    expect(summary.json().data.operations.maintenance).toMatchObject({
      runningCount: 0,
      succeededCount: 2,
      failedCount: 0,
      totalRemoved: 3,
    });
    expect(summary.json().data.operations.maintenance.recentRuns).toHaveLength(2);
  });

  it("真实维护清理失败会进入运维摘要的最近错误", async () => {
    const store = createMemoryStore();
    const admin = addAuthenticatedUser(store, "admin-failed-cleanup-token", "admin");
    store.otpRequests.set("13800138001", {
      phone: "13800138001",
      code: "111111",
      expiresAt: Date.now() - 1,
    });
    store.persistence = persistence({
      deleteOtpRequest: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    const app = createApp(store);

    const cleanup = await app.inject({
      method: "POST",
      url: "/api/admin/operations/cleanup",
      headers: { cookie: admin.cookie },
    });
    const summary = await app.inject({
      method: "GET",
      url: "/api/admin/operations",
      headers: { cookie: admin.cookie },
    });

    expect(cleanup.statusCode).toBe(201);
    expect(cleanup.json().data.run).toMatchObject({
      taskName: "expired-resources",
      status: "failed",
      results: expect.arrayContaining([
        { target: "otp", status: "failed", removedCount: 0, error: "清理失败" },
      ]),
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().data.operations.recentErrors).toEqual([
      expect.objectContaining({
        level: "error",
        event: "maintenance.cleanup.failed",
        context: expect.objectContaining({
          taskName: "expired-resources",
          failedTargets: ["otp"],
        }),
      }),
    ]);
  });
});
