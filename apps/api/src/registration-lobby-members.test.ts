import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("注册会员大厅占位投影", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  function createApp() {
    const store = createMemoryStore([]);
    const app = buildServer({ store, otpCode: "123456", encryptionKey: "registration-lobby-test-secret" });
    apps.push(app);
    return { app, store };
  }

  async function login(app: ReturnType<typeof buildServer>, phone: string) {
    const requested = await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone },
    });
    expect(requested.statusCode).toBe(200);

    const verified = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { phone, code: "123456" },
    });
    expect(verified.statusCode).toBe(200);
    const token = verified.cookies.find((cookie) => cookie.name === "refresh_token")?.value;
    expect(token).toBeTruthy();
    return {
      cookie: `refresh_token=${token}`,
      userId: verified.json().data.user.id as string,
    };
  }

  it("OTP 首次注册后立即返回不含人口属性的安全占位卡", async () => {
    const { app } = createApp();
    const registered = await login(app, "13800138111");

    const response = await app.inject({
      method: "GET",
      url: "/api/members?includeIncomplete=true",
    });

    expect(response.statusCode).toBe(200);
    const item = response.json().data.items.find((member: { lobbyStatus?: string }) => member.lobbyStatus === "new");
    expect(item).toMatchObject({
      nickname: "新加入会员",
      lobbyStatus: "new",
      verified: false,
    });
    expect(item.id).not.toContain(registered.userId);
    expect(JSON.stringify(item)).not.toContain("13800138111");
    expect(item).not.toHaveProperty("age");
    expect(item).not.toHaveProperty("gender");
    expect(item).not.toHaveProperty("city");
  });

  it("占位会员不能被心仪、跳过或创建 AI 会话", async () => {
    const { app } = createApp();
    await login(app, "13800138112");
    const lobby = await app.inject({
      method: "GET",
      url: "/api/members?includeIncomplete=true",
    });
    const placeholderId = lobby.json().data.items.find((member: { lobbyStatus?: string }) => member.lobbyStatus === "new")?.id as string;
    expect(placeholderId).toBeTruthy();

    const viewer = await login(app, "13800138113");
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/members/${placeholderId}/interest`,
        headers: { cookie: viewer.cookie },
      }),
      app.inject({
        method: "POST",
        url: `/api/members/${placeholderId}/skip`,
        headers: { cookie: viewer.cookie },
      }),
      app.inject({
        method: "POST",
        url: "/api/avatar-sessions",
        headers: { cookie: viewer.cookie },
        payload: { memberId: placeholderId },
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "MEMBER_PROFILE_INCOMPLETE" },
      });
    }
  });
});
