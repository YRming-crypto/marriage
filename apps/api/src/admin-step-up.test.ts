import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("admin step-up authentication", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  async function login(app: ReturnType<typeof buildServer>, phone = "13900139999") {
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { phone, code: "123456" },
    });
    const refreshToken = response.cookies.find((cookie) => cookie.name === "refresh_token")?.value;
    expect(refreshToken).toBeTruthy();
    return `refresh_token=${refreshToken}`;
  }

  it("requires a separate access code before protected admin actions", async () => {
    const store = createMemoryStore([]);
    const app = buildServer({
      store,
      otpCode: "123456",
      adminPhones: ["13900139999"],
      adminAccessCode: "654321",
    });
    apps.push(app);
    const loginCookie = await login(app);

    const blocked = await app.inject({
      method: "GET",
      url: "/api/admin/accounts",
      headers: { cookie: loginCookie },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: { code: "ADMIN_STEP_UP_REQUIRED" } });

    const wrong = await app.inject({
      method: "POST",
      url: "/api/admin/access/verify",
      headers: { cookie: loginCookie },
      payload: { code: "123456" },
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toMatchObject({ error: { code: "ADMIN_ACCESS_CODE_INVALID" } });
    expect(wrong.cookies.some((cookie) => cookie.name === "admin_access")).toBe(false);

    const verified = await app.inject({
      method: "POST",
      url: "/api/admin/access/verify",
      headers: { cookie: loginCookie },
      payload: { code: "654321" },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().data).toEqual({ verified: true, expiresAt: expect.any(String) });
    const adminAccess = verified.cookies.find((cookie) => cookie.name === "admin_access")?.value;
    expect(adminAccess).toBeTruthy();

    const elevatedCookie = `${loginCookie}; admin_access=${adminAccess}`;
    const status = await app.inject({ method: "GET", url: "/api/admin/access", headers: { cookie: elevatedCookie } });
    expect(status.statusCode).toBe(200);
    expect(status.json().data).toEqual({ required: true, verified: true, expiresAt: expect.any(String) });
    expect((await app.inject({ method: "GET", url: "/api/admin/accounts", headers: { cookie: elevatedCookie } })).statusCode).toBe(200);
  });

  it("binds elevated access to the refresh session and clears it on logout", async () => {
    const store = createMemoryStore([]);
    const app = buildServer({
      store,
      otpCode: "123456",
      adminPhones: ["13900139999"],
      adminAccessCode: "654321",
    });
    apps.push(app);
    const firstLoginCookie = await login(app);
    const verified = await app.inject({
      method: "POST",
      url: "/api/admin/access/verify",
      headers: { cookie: firstLoginCookie },
      payload: { code: "654321" },
    });
    const adminAccess = verified.cookies.find((cookie) => cookie.name === "admin_access")?.value;
    const admin = [...store.users.values()].find((user) => user.phone === "13900139999")!;
    const now = new Date().toISOString();
    store.sessions.set("second-refresh-token", {
      id: "second-admin-session",
      userId: admin.id,
      expiresAt: Date.now() + 60_000,
      userAgent: "second device",
      createdAt: now,
      lastUsedAt: now,
    });

    const wrongSession = await app.inject({
      method: "GET",
      url: "/api/admin/accounts",
      headers: { cookie: `refresh_token=second-refresh-token; admin_access=${adminAccess}` },
    });
    expect(wrongSession.statusCode).toBe(403);
    expect(wrongSession.json()).toMatchObject({ error: { code: "ADMIN_STEP_UP_REQUIRED" } });

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: `${firstLoginCookie}; admin_access=${adminAccess}` },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.cookies).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "refresh_token", value: "", maxAge: 0 }),
      expect.objectContaining({ name: "admin_access", value: "", maxAge: 0 }),
    ]));
  });
});
