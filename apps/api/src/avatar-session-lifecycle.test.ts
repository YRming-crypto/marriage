import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("AI avatar session lifecycle", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  async function login(app: ReturnType<typeof buildServer>) {
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: "13800138000" } });
    const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13800138000", code: "123456" } });
    return `refresh_token=${response.cookies.find((cookie) => cookie.name === "refresh_token")?.value}`;
  }

  it("lists the current user's sessions and lets the owner end an active session", async () => {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);
    const cookie = await login(app);
    const created = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie }, payload: { memberId: "lin-wanqing" } });
    const sessionId = created.json().data.session.id as string;

    const listed = await app.inject({ method: "GET", url: "/api/avatar-sessions", headers: { cookie } });
    const ended = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/end`, headers: { cookie } });
    const messageAfterEnd = await app.inject({
      method: "POST",
      url: `/api/avatar-sessions/${sessionId}/messages`,
      headers: { cookie },
      payload: { text: "周末怎么安排？", clientMessageId: "after-end" },
    });
    const restarted = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie }, payload: { memberId: "lin-wanqing" } });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.items).toEqual([expect.objectContaining({ id: sessionId, memberId: "lin-wanqing", status: "active" })]);
    expect(ended.statusCode).toBe(200);
    expect(ended.json().data.session).toMatchObject({ id: sessionId, status: "paused" });
    expect(messageAfterEnd.statusCode).toBe(409);
    expect(messageAfterEnd.json().error.code).toBe("AVATAR_PAUSED");
    expect(restarted.statusCode).toBe(201);
    expect(restarted.json().data.session.id).not.toBe(sessionId);
  });

  it("does not expose or end another user's AI session", async () => {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);
    const ownerCookie = await login(app);
    const created = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie: ownerCookie }, payload: { memberId: "lin-wanqing" } });
    const sessionId = created.json().data.session.id as string;

    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: "13900139000" } });
    const otherLogin = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13900139000", code: "123456" } });
    const otherCookie = `refresh_token=${otherLogin.cookies.find((cookie) => cookie.name === "refresh_token")?.value}`;
    const listed = await app.inject({ method: "GET", url: "/api/avatar-sessions", headers: { cookie: otherCookie } });
    const ended = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/end`, headers: { cookie: otherCookie } });

    expect(listed.json().data.items).toEqual([]);
    expect(ended.statusCode).toBe(404);
    expect(store.avatarSessions.get(sessionId)?.status).toBe("active");
  });

  it("keeps the session ended when ending races with an in-flight AI reply", async () => {
    const store = createMemoryStore();
    let releaseReply!: () => void;
    let markReplyStarted!: () => void;
    const replyStarted = new Promise<void>((resolve) => { markReplyStarted = resolve; });
    const replyGate = new Promise<void>((resolve) => { releaseReply = resolve; });
    const modelReply = vi.fn(async () => {
      markReplyStarted();
      await replyGate;
      return "我平时喜欢散步。";
    });
    const app = buildServer({ store, otpCode: "123456", providers: { avatarModel: { reply: modelReply } } });
    apps.push(app);
    const cookie = await login(app);
    const created = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie }, payload: { memberId: "lin-wanqing" } });
    const sessionId = created.json().data.session.id as string;

    const sending = app.inject({
      method: "POST",
      url: `/api/avatar-sessions/${sessionId}/messages`,
      headers: { cookie },
      payload: { text: "平时喜欢什么？", clientMessageId: "in-flight-before-end" },
    });
    await replyStarted;
    let endSettled = false;
    const ending = app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/end`, headers: { cookie } })
      .then((response) => {
        endSettled = true;
        return response;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(endSettled).toBe(false);
    releaseReply();
    const [sent, ended] = await Promise.all([sending, ending]);

    expect(sent.statusCode).toBe(201);
    expect(ended.statusCode).toBe(200);
    expect(store.avatarSessions.get(sessionId)?.status).toBe("paused");
  });
});
