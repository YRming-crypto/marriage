import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("登录会话注销", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  it("注销后撤销服务端会话、清除 Cookie，并拒绝旧 Cookie 继续访问", async () => {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);

    await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone: "13800138000" },
    });
    const verified = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { phone: "13800138000", code: "123456" },
    });
    const cookie = verified.headers["set-cookie"];

    expect(cookie).toContain("refresh_token=");
    expect(store.sessions.size).toBe(1);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).statusCode).toBe(200);

    const loggedOut = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });

    expect(loggedOut.statusCode).toBe(204);
    const clearedCookies = loggedOut.cookies;
    expect(clearedCookies).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "refresh_token", value: "", maxAge: 0 }),
      expect.objectContaining({ name: "admin_access", value: "", maxAge: 0 }),
    ]));
    expect(store.sessions.size).toBe(0);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("内存会话超过 Cookie 有效期后立即失效", async () => {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);

    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: "13800138000" } });
    const verified = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13800138000", code: "123456" } });
    const cookie = verified.headers["set-cookie"];
    const session = [...store.sessions.values()][0];
    session.expiresAt = Date.now() - 1;

    const expired = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });

    expect(expired.statusCode).toBe(401);
    expect(store.sessions.size).toBe(0);
  });

  it("suspended 账号仅保留账号安全访问权", async () => {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);

    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: "13800138000" } });
    const verified = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13800138000", code: "123456" } });
    const cookie = verified.headers["set-cookie"];
    const session = [...store.sessions.values()][0];
    const user = store.users.get(session.userId);
    expect(user).toBeDefined();
    user!.status = "suspended";
    user!.suspensionSource = "admin";

    const account = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    const business = await app.inject({ method: "GET", url: "/api/recommendations", headers: { cookie } });

    expect(account.statusCode).toBe(200);
    expect(account.json().data.user.status).toBe("suspended");
    expect(business.statusCode).toBe(401);
  });

  it("deleted 账号立即失去旧会话访问权", async () => {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: "13800138000" } });
    const verified = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13800138000", code: "123456" } });
    const cookie = verified.headers["set-cookie"];
    const session = [...store.sessions.values()][0];
    store.users.get(session.userId)!.status = "deleted";
    const response = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_REQUIRED");
    expect(store.sessions.size).toBe(0);
  });

  it("公开会员登录和继续访问时刷新真实最近活跃时间", async () => {
    const store = createMemoryStore();
    const userId = "user-active-member";
    store.users.set(userId, { id: userId, phone: "13800138000", role: "user", status: "active", createdAt: "2026-01-01T00:00:00.000Z" });
    store.usersByPhone.set("13800138000", userId);
    store.profiles.set(userId, {
      userId,
      nickname: "活跃会员",
      gender: "女性",
      birthYear: 1980,
      city: "上海",
      district: "徐汇",
      job: "教育",
      maritalStatus: "离异",
      goal: "认真交往",
      introduction: "希望认真了解彼此。",
      preference: {},
      answers: {},
      profileStatus: "approved",
      visibility: "public",
      reviewReason: null,
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    store.photos.set("photo-active-member", {
      id: "photo-active-member",
      userId,
      filename: "profile.png",
      objectKey: "users/user-active-member/profile.png",
      url: "/api/photos/photo-active-member/content",
      mimeType: "image/png",
      sizeBytes: 68,
      isPrimary: true,
      reviewStatus: "approved",
      reviewReason: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    store.avatarProfiles.set(userId, {
      userId,
      version: 1,
      approvedFacts: [],
      relationshipExpectations: [],
      boundaries: [],
      unknownResponse: "建议真人确认。",
      status: "enabled",
      generatedAt: "2026-08-01T00:00:00.000Z",
      enabledAt: "2026-08-01T00:00:00.000Z",
    });
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);

    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: "13800138000" } });
    const verified = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13800138000", code: "123456" } });
    const cookie = verified.headers["set-cookie"];
    const session = [...store.sessions.values()][0];
    expect(store.members.get(`member-${userId}`)?.lastActiveAt).toBe(session.lastUsedAt);

    session.lastUsedAt = "2026-08-01T00:00:00.000Z";
    store.members.get(`member-${userId}`)!.lastActiveAt = session.lastUsedAt;
    await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });

    expect(store.members.get(`member-${userId}`)?.lastActiveAt).toBe(session.lastUsedAt);
    expect(new Date(session.lastUsedAt).getTime()).toBeGreaterThan(new Date("2026-08-01T00:00:00.000Z").getTime());
  });
});
