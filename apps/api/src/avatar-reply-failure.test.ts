import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";
import type { Store, StoredUser } from "./store/types.js";

describe("AI avatar reply failure recovery", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  async function login(app: ReturnType<typeof buildServer>, phone: string) {
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
    const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone, code: "123456" } });
    const token = response.cookies.find((item) => item.name === "refresh_token")?.value;
    expect(token).toBeTruthy();
    return { cookie: `refresh_token=${token}`, userId: response.json().data.user.id as string };
  }

  async function createSession(app: ReturnType<typeof buildServer>, cookie: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/avatar-sessions",
      headers: { cookie },
      payload: { memberId: "lin-wanqing" },
    });
    expect(response.statusCode).toBe(201);
    return response.json().data.session.id as string;
  }

  function addAdmin(store: Store) {
    const now = new Date().toISOString();
    const user: StoredUser = { id: "admin-retry", phone: "13900139999", role: "admin", status: "active", createdAt: now };
    store.users.set(user.id, user);
    store.usersByPhone.set(user.phone, user.id);
    store.sessions.set("admin-retry-token", { id: "admin-retry-session", userId: user.id, expiresAt: Date.now() + 60_000, userAgent: "test", createdAt: now, lastUsedAt: now });
    return "refresh_token=admin-retry-token";
  }

  it("persists the validated user message and a sanitized failure task when the model fails", async () => {
    const store = createMemoryStore();
    const question = "周末通常怎么安排？";
    const reply = vi.fn().mockRejectedValue(new Error(`timeout for ${question}; api_key=secret-value`));
    const app = buildServer({ store, otpCode: "123456", providers: { avatarModel: { reply } } });
    apps.push(app);
    const user = await login(app, "13800138000");
    const sessionId = await createSession(app, user.cookie);

    const response = await app.inject({
      method: "POST",
      url: `/api/avatar-sessions/${sessionId}/messages`,
      headers: { cookie: user.cookie },
      payload: { text: question, clientMessageId: "question-1" },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: { code: "AVATAR_MODEL_UNAVAILABLE" },
      data: {
        message: { sessionId, sender: "user", text: question, clientMessageId: "question-1" },
        failureTask: { sessionId, memberId: "lin-wanqing", status: "pending", attempts: 1 },
      },
    });
    const messages = [...store.avatarMessages.values()].filter((message) => message.sessionId === sessionId);
    expect(messages).toEqual([expect.objectContaining({ id: response.json().data.message.id, sender: "user", text: question })]);
    const tasks = [...store.avatarReplyFailureTasks.values()];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      userMessageId: messages[0]?.id,
      sessionId,
      memberId: "lin-wanqing",
      status: "pending",
      attempts: 1,
      resolvedAt: null,
      resolvedMessageId: null,
    });
    expect(tasks[0]?.lastError).toEqual(expect.any(String));
    expect(tasks[0]!.lastError!.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(tasks[0])).not.toContain(question);
    expect(JSON.stringify(tasks[0])).not.toContain("secret-value");
    expect(store.avatarSessions.get(sessionId)?.completedTopics).toEqual([]);
  });

  it("returns the same pending task for the same client message id without calling the model again", async () => {
    const store = createMemoryStore();
    const modelReply = vi.fn().mockRejectedValue(new Error("upstream unavailable"));
    const app = buildServer({ store, otpCode: "123456", providers: { avatarModel: { reply: modelReply } } });
    apps.push(app);
    const user = await login(app, "13800138000");
    const sessionId = await createSession(app, user.cookie);
    const payload = { text: "周末怎么安排？", clientMessageId: "stable-question-id" };

    const first = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: user.cookie }, payload });
    const repeated = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: user.cookie }, payload });

    expect(first.statusCode).toBe(502);
    expect(repeated.statusCode).toBe(202);
    expect(repeated.json().data).toEqual(first.json().data);
    expect(modelReply).toHaveBeenCalledTimes(1);
    expect([...store.avatarMessages.values()].filter((message) => message.sessionId === sessionId)).toHaveLength(1);
    expect(store.avatarReplyFailureTasks.size).toBe(1);

    const conflict = await app.inject({
      method: "POST",
      url: `/api/avatar-sessions/${sessionId}/messages`,
      headers: { cookie: user.cookie },
      payload: { text: "这是不同的问题", clientMessageId: "stable-question-id" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("AVATAR_MESSAGE_ID_CONFLICT");
    expect(modelReply).toHaveBeenCalledTimes(1);
  });

  it("allows the session owner to explicitly retry a failed reply without duplicating the question", async () => {
    const store = createMemoryStore();
    const modelReply = vi.fn()
      .mockRejectedValueOnce(new Error("upstream unavailable"))
      .mockResolvedValueOnce("我更习惯先商量彼此都舒服的安排。");
    const app = buildServer({ store, otpCode: "123456", providers: { avatarModel: { reply: modelReply } } });
    apps.push(app);
    const user = await login(app, "13800138000");
    const sessionId = await createSession(app, user.cookie);
    const payload = { text: "遇到分歧会怎么处理？", clientMessageId: "owner-retry-question" };

    const failed = await app.inject({
      method: "POST",
      url: `/api/avatar-sessions/${sessionId}/messages`,
      headers: { cookie: user.cookie },
      payload,
    });
    const retried = await app.inject({
      method: "POST",
      url: `/api/avatar-sessions/${sessionId}/messages`,
      headers: { cookie: user.cookie },
      payload: { ...payload, retry: true },
    });

    expect(failed.statusCode).toBe(502);
    expect(retried.statusCode).toBe(200);
    expect(retried.json().data.messages).toEqual([
      expect.objectContaining({ id: failed.json().data.message.id, sender: "user", text: payload.text }),
      expect.objectContaining({ sender: "avatar", text: "我更习惯先商量彼此都舒服的安排。" }),
    ]);
    expect(modelReply).toHaveBeenCalledTimes(2);
    expect([...store.avatarMessages.values()].filter((message) => message.sessionId === sessionId && message.sender === "user")).toHaveLength(1);
    expect([...store.avatarMessages.values()].filter((message) => message.sessionId === sessionId && message.sender === "avatar")).toHaveLength(1);
    expect([...store.avatarReplyFailureTasks.values()][0]).toMatchObject({
      status: "resolved",
      attempts: 2,
      resolvedMessageId: expect.any(String),
      resolvedAt: expect.any(String),
    });
  });

  it("serializes concurrent sends with the same client message id", async () => {
    const store = createMemoryStore();
    const modelReply = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error("upstream unavailable");
    });
    const app = buildServer({ store, otpCode: "123456", providers: { avatarModel: { reply: modelReply } } });
    apps.push(app);
    const user = await login(app, "13800138000");
    const sessionId = await createSession(app, user.cookie);
    const request = {
      method: "POST" as const,
      url: `/api/avatar-sessions/${sessionId}/messages`,
      headers: { cookie: user.cookie },
      payload: { text: "周末怎么安排？", clientMessageId: "concurrent-question" },
    };

    const responses = await Promise.all([app.inject(request), app.inject(request)]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([202, 502]);
    const data = responses.map((response) => response.json().data);
    expect(data[0]).toEqual(data[1]);
    expect(modelReply).toHaveBeenCalledTimes(1);
    expect(store.avatarReplyFailureTasks.size).toBe(1);
    expect([...store.avatarMessages.values()].filter((message) => message.sessionId === sessionId && message.sender === "user")).toHaveLength(1);
  });

  it("allows only administrators to list failures and returns stable pagination", async () => {
    const store = createMemoryStore();
    const adminCookie = addAdmin(store);
    const app = buildServer({
      store,
      otpCode: "123456",
      providers: { avatarModel: { reply: vi.fn().mockRejectedValue(new Error("upstream unavailable")) } },
    });
    apps.push(app);
    const user = await login(app, "13800138000");
    const sessionId = await createSession(app, user.cookie);
    await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: user.cookie }, payload: { text: "周末怎么安排？" } });

    const forbidden = await app.inject({ method: "GET", url: "/api/admin/avatar-reply-failures", headers: { cookie: user.cookie } });
    const listed = await app.inject({ method: "GET", url: "/api/admin/avatar-reply-failures?page=1&pageSize=10", headers: { cookie: adminCookie } });

    expect(forbidden.statusCode).toBe(403);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toMatchObject({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    expect(listed.json().data.items).toEqual([
      expect.objectContaining({ sessionId, memberId: "lin-wanqing", status: "pending", attempts: 1 }),
    ]);
    expect(JSON.stringify(listed.json())).not.toContain("周末怎么安排");
  });

  it("retries from the persisted user message, appends one AI message, resolves the task, and is idempotent", async () => {
    const store = createMemoryStore();
    const adminCookie = addAdmin(store);
    const modelReply = vi.fn()
      .mockRejectedValueOnce(new Error("first call failed"))
      .mockResolvedValueOnce("我通常喜欢散步和阅读。");
    const app = buildServer({ store, otpCode: "123456", providers: { avatarModel: { reply: modelReply } } });
    apps.push(app);
    const user = await login(app, "13800138000");
    const sessionId = await createSession(app, user.cookie);
    const failed = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: user.cookie }, payload: { text: "周末怎么安排？", clientMessageId: "resolved-question" } });
    const taskId = failed.json().data.failureTask.id as string;

    const retried = await app.inject({ method: "POST", url: `/api/admin/avatar-reply-failures/${taskId}/retry`, headers: { cookie: adminCookie } });
    const repeated = await app.inject({ method: "POST", url: `/api/admin/avatar-reply-failures/${taskId}/retry`, headers: { cookie: adminCookie } });
    const repeatedSend = await app.inject({
      method: "POST",
      url: `/api/avatar-sessions/${sessionId}/messages`,
      headers: { cookie: user.cookie },
      payload: { text: "周末怎么安排？", clientMessageId: "resolved-question" },
    });

    expect(retried.statusCode).toBe(200);
    expect(retried.json().data).toMatchObject({
      task: { id: taskId, status: "resolved", attempts: 2, resolvedAt: expect.any(String) },
      message: { sessionId, sender: "avatar", id: expect.any(String), createdAt: expect.any(String) },
    });
    expect(retried.json().data.message).not.toHaveProperty("text");
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data.message.id).toBe(retried.json().data.message.id);
    expect(repeatedSend.statusCode).toBe(200);
    expect(repeatedSend.json().data.messages.map((message: { id: string }) => message.id)).toEqual([
      failed.json().data.message.id,
      retried.json().data.message.id,
    ]);
    expect(modelReply).toHaveBeenCalledTimes(2);
    expect(modelReply.mock.calls[1]?.[0].question).toBe("周末怎么安排？");
    expect([...store.avatarMessages.values()].filter((message) => message.sessionId === sessionId && message.sender === "avatar")).toHaveLength(1);
    expect(store.adminAuditLogs.size).toBe(1);
    expect([...store.adminAuditLogs.values()][0]).toMatchObject({
      actorUserId: "admin-retry",
      action: "avatar_reply.retry_succeeded",
      targetType: "avatar_reply_failure",
      targetId: taskId,
      metadata: { sessionId, attempts: 2 },
    });
    expect(JSON.stringify([...store.adminAuditLogs.values()])).not.toContain("周末怎么安排");
  });

  it("keeps a failed retry pending with a sanitized error and rejects retry after the session is paused", async () => {
    const store = createMemoryStore();
    const adminCookie = addAdmin(store);
    const modelReply = vi.fn().mockRejectedValue(new Error("https://provider.invalid?token=super-secret"));
    const app = buildServer({ store, otpCode: "123456", providers: { avatarModel: { reply: modelReply } } });
    apps.push(app);
    const user = await login(app, "13800138000");
    const sessionId = await createSession(app, user.cookie);
    const failed = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: user.cookie }, payload: { text: "平时喜欢什么？" } });
    const taskId = failed.json().data.failureTask.id as string;

    const retryFailed = await app.inject({ method: "POST", url: `/api/admin/avatar-reply-failures/${taskId}/retry`, headers: { cookie: adminCookie } });
    expect(retryFailed.statusCode).toBe(502);
    expect(store.avatarReplyFailureTasks.get(taskId)).toMatchObject({ status: "pending", attempts: 2, resolvedAt: null });
    expect(JSON.stringify(store.avatarReplyFailureTasks.get(taskId))).not.toContain("super-secret");
    expect([...store.adminAuditLogs.values()][0]?.action).toBe("avatar_reply.retry_failed");

    store.avatarSessions.get(sessionId)!.status = "paused";
    const paused = await app.inject({ method: "POST", url: `/api/admin/avatar-reply-failures/${taskId}/retry`, headers: { cookie: adminCookie } });
    expect(paused.statusCode).toBe(409);
    expect(paused.json().error.code).toBe("AVATAR_RETRY_NOT_ALLOWED");
    expect(modelReply).toHaveBeenCalledTimes(2);
  });

  it("serializes administrator retry with ending the same AI session", async () => {
    const store = createMemoryStore();
    const adminCookie = addAdmin(store);
    let releaseRetry!: () => void;
    let markRetryStarted!: () => void;
    const retryStarted = new Promise<void>((resolve) => { markRetryStarted = resolve; });
    const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
    const modelReply = vi.fn()
      .mockRejectedValueOnce(new Error("first call failed"))
      .mockImplementationOnce(async () => {
        markRetryStarted();
        await retryGate;
        return "重试后的回答";
      });
    const app = buildServer({ store, otpCode: "123456", providers: { avatarModel: { reply: modelReply } } });
    apps.push(app);
    const user = await login(app, "13800138000");
    const sessionId = await createSession(app, user.cookie);
    const failed = await app.inject({
      method: "POST",
      url: `/api/avatar-sessions/${sessionId}/messages`,
      headers: { cookie: user.cookie },
      payload: { text: "平时喜欢什么？", clientMessageId: "admin-race" },
    });
    const taskId = failed.json().data.failureTask.id as string;

    const retrying = app.inject({ method: "POST", url: `/api/admin/avatar-reply-failures/${taskId}/retry`, headers: { cookie: adminCookie } });
    await retryStarted;
    let endSettled = false;
    const ending = app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/end`, headers: { cookie: user.cookie } })
      .then((response) => {
        endSettled = true;
        return response;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(endSettled).toBe(false);
    releaseRetry();
    const [retried, ended] = await Promise.all([retrying, ending]);

    expect(retried.statusCode).toBe(200);
    expect(ended.statusCode).toBe(200);
    expect(store.avatarSessions.get(sessionId)?.status).toBe("paused");
    expect([...store.avatarMessages.values()].filter((message) => message.sessionId === sessionId && message.sender === "avatar")).toHaveLength(1);
  });

  it("counts explicit user retries against the AI question rate limit", async () => {
    const store = createMemoryStore();
    const modelReply = vi.fn().mockRejectedValue(new Error("upstream unavailable"));
    const app = buildServer({ store, otpCode: "123456", providers: { avatarModel: { reply: modelReply } } });
    apps.push(app);
    const user = await login(app, "13800138000");
    const sessionId = await createSession(app, user.cookie);
    const payload = { text: "周末怎么安排？", clientMessageId: "rate-limited-retry" };

    const initial = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: user.cookie }, payload });
    expect(initial.statusCode).toBe(502);
    for (let attempt = 0; attempt < 19; attempt += 1) {
      const retry = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: user.cookie }, payload: { ...payload, retry: true } });
      expect(retry.statusCode).toBe(502);
    }
    const limited = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: user.cookie }, payload: { ...payload, retry: true } });

    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("AVATAR_MESSAGE_RATE_LIMITED");
    expect(modelReply).toHaveBeenCalledTimes(20);
  });
});
