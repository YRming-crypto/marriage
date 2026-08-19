import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { RealtimeEventCenter, type RealtimeDelivery } from "./realtime/index.js";
import { createMemoryStore, type Store } from "./store/index.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("真人聊天实时事件与回执", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  function setup() {
    const store = createMemoryStore([]);
    const now = new Date().toISOString();
    for (const [id, phone] of [["user-a", "13800138000"], ["user-b", "13900139000"]] as const) {
      store.users.set(id, { id, phone, role: "user", status: "active", createdAt: now });
      store.usersByPhone.set(phone, id);
      store.sessions.set(`token-${id}`, { id: `session-${id}`, userId: id, expiresAt: Date.now() + 60_000, userAgent: "test", createdAt: now, lastUsedAt: now });
    }
    store.conversations.set("conversation-1", { id: "conversation-1", chatRequestId: "request-1", participantIds: ["user-a", "user-b"], status: "active", createdAt: now });
    const realtime = new RealtimeEventCenter();
    const app = buildServer({ store, otpCode: "123456", realtimeEventCenter: realtime });
    apps.push(app);
    return { app, store, realtime };
  }

  async function sendMessage(app: ReturnType<typeof buildServer>) {
    return app.inject({
      method: "POST",
      url: "/api/conversations/conversation-1/messages",
      headers: { cookie: "refresh_token=token-user-a" },
      payload: { text: "你好，很高兴认识你。", clientMessageId: "client-1" },
    });
  }

  it("消息保存后向接收者发布事件并创建回执", async () => {
    const { app, store, realtime } = setup();
    const received: RealtimeDelivery[] = [];
    realtime.subscribe("user-b", (event) => received.push(event));

    const response = await sendMessage(app);
    await flush();

    expect(response.statusCode).toBe(201);
    expect(received).toContainEqual(expect.objectContaining({ type: "message.created", data: expect.objectContaining({ conversationId: "conversation-1" }) }));
    const receipt = [...store.messageReceipts.values()][0];
    expect(receipt).toMatchObject({ userId: "user-b", deliveredAt: null, readAt: null });
  });

  it("拉取历史标记送达，显式已读后通知发送者", async () => {
    const { app, store, realtime } = setup();
    const sent = await sendMessage(app);
    const messageId = sent.json().data.message.id as string;
    const senderEvents: RealtimeDelivery[] = [];
    realtime.subscribe("user-a", (event) => senderEvents.push(event));

    const history = await app.inject({ method: "GET", url: "/api/conversations/conversation-1/messages", headers: { cookie: "refresh_token=token-user-b" } });
    expect(history.statusCode).toBe(200);
    expect(store.messageReceipts.get(`${messageId}:user-b`)?.deliveredAt).toBeTruthy();

    const read = await app.inject({ method: "POST", url: "/api/conversations/conversation-1/read", headers: { cookie: "refresh_token=token-user-b" } });
    await flush();
    expect(read.statusCode).toBe(200);
    expect(read.json().data.readCount).toBe(1);
    expect(store.messageReceipts.get(`${messageId}:user-b`)?.readAt).toBeTruthy();
    expect(senderEvents).toContainEqual(expect.objectContaining({ type: "message.read", data: expect.objectContaining({ messageIds: [messageId] }) }));
  });

  it("只有会话参与者可以发布输入状态", async () => {
    const { app, realtime } = setup();
    const recipientEvents: RealtimeDelivery[] = [];
    realtime.subscribe("user-b", (event) => recipientEvents.push(event));

    const response = await app.inject({ method: "POST", url: "/api/conversations/conversation-1/typing", headers: { cookie: "refresh_token=token-user-a" }, payload: { typing: true } });
    await flush();
    expect(response.statusCode).toBe(204);
    expect(recipientEvents).toContainEqual(expect.objectContaining({ type: "typing.changed", data: expect.objectContaining({ userId: "user-a", typing: true }) }));

    const outsider = createMemoryStore([]) as Store;
    expect(outsider.conversations.size).toBe(0);
  });

  it.each(["archived", "blocked"] as const)("%s 会话不能继续发布输入状态", async (status) => {
    const { app, store, realtime } = setup();
    store.conversations.get("conversation-1")!.status = status;
    const recipientEvents: RealtimeDelivery[] = [];
    realtime.subscribe("user-b", (event) => recipientEvents.push(event));

    const response = await app.inject({
      method: "POST",
      url: "/api/conversations/conversation-1/typing",
      headers: { cookie: "refresh_token=token-user-a" },
      payload: { typing: true },
    });
    await flush();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CHAT_BLOCKED");
    expect(recipientEvents).toEqual([]);
  });

  it("实时事件入口要求登录", async () => {
    const { app } = setup();
    const response = await app.inject({ method: "GET", url: "/api/realtime/events" });
    expect(response.statusCode).toBe(401);
  });

  it("空闲连接周期发送心跳并在断开时清理计时器", async () => {
    const store = createMemoryStore([]);
    const now = new Date().toISOString();
    store.users.set("heartbeat-user", {
      id: "heartbeat-user",
      phone: "13800138000",
      role: "user",
      status: "active",
      createdAt: now,
    });
    store.usersByPhone.set("13800138000", "heartbeat-user");
    store.sessions.set("heartbeat-token", {
      id: "heartbeat-session",
      userId: "heartbeat-user",
      expiresAt: Date.now() + 60_000,
      userAgent: "test",
      createdAt: now,
      lastUsedAt: now,
    });
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const app = buildServer({ store, otpCode: "123456", realtimeHeartbeatMs: 20 });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener address.");

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/realtime/events`, {
      headers: { cookie: "refresh_token=heartbeat-token" },
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected an SSE response stream.");
    const decoder = new TextDecoder();
    let body = "";
    const deadline = Date.now() + 500;
    try {
      while (!body.includes(": heartbeat\n\n") && Date.now() < deadline) {
        const result = await Promise.race([
          reader.read(),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 50)),
        ]);
        if (result?.done) break;
        if (result?.value) body += decoder.decode(result.value, { stream: true });
      }
    } finally {
      controller.abort();
      await reader.cancel().catch(() => undefined);
      for (let attempt = 0; attempt < 20 && clearIntervalSpy.mock.calls.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(body).toContain(": connected\n\n");
    expect(body).toContain(": heartbeat\n\n");
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});
