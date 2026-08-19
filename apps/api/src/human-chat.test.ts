import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";
import type { AvatarKnowledgeState } from "./avatar-knowledge/index.js";
import type { ContentActivityState } from "./content/index.js";
import type { StorePersistence } from "./store/types.js";

describe("真人聊天历史消息", () => {
  const apps: Array<Awaited<ReturnType<typeof buildServer>>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  async function login(app: ReturnType<typeof buildServer>, phone: string) {
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
    const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone, code: "123456" } });
    const cookie = response.cookies.find((item) => item.name === "refresh_token");
    return `${cookie?.name}=${cookie?.value}`;
  }

  async function createDirectConversation(phoneSuffix: string) {
    const store = createMemoryStore([]);
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const senderPhone = `138000${phoneSuffix}`;
    const receiverPhone = `139000${phoneSuffix}`;
    const senderCookie = await login(app, senderPhone);
    const receiverCookie = await login(app, receiverPhone);
    const senderId = store.usersByPhone.get(senderPhone)!;
    const receiverId = store.usersByPhone.get(receiverPhone)!;
    const conversationId = `conversation-${phoneSuffix}`;
    store.conversations.set(conversationId, {
      id: conversationId,
      chatRequestId: "",
      participantIds: [senderId, receiverId],
      status: "active",
      archivedAt: null,
      createdAt: new Date().toISOString(),
    });
    return { app, store, senderCookie, receiverCookie, senderId, receiverId, conversationId };
  }

  it("接受申请后可以保存、读取并幂等发送真人消息", async () => {
    const app = buildServer({ otpCode: "123456", store: createMemoryStore() });
    apps.push(app);
    const senderCookie = await login(app, "13800138000");
    const receiverCookie = await login(app, "13900139000");
    const avatar = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie: senderCookie }, payload: { memberId: "lin-wanqing" } });
    const sessionId = avatar.json().data.session.id;
    for (const text of ["周末怎么过？", "关系期待是什么？", "遇到分歧如何沟通？"]) {
      await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: senderCookie }, payload: { text } });
    }
    const request = await app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie: senderCookie }, payload: { avatarSessionId: sessionId } });
    const requestId = request.json().data.request.id;
    const accepted = await app.inject({ method: "POST", url: `/api/chat-requests/${requestId}/accept`, headers: { cookie: receiverCookie } });
    const conversationId = accepted.json().data.conversation.id;
    const first = await app.inject({ method: "POST", url: `/api/conversations/${conversationId}/messages`, headers: { cookie: senderCookie }, payload: { text: "你好，很高兴认识你。", clientMessageId: "client-1" } });
    const second = await app.inject({ method: "POST", url: `/api/conversations/${conversationId}/messages`, headers: { cookie: senderCookie }, payload: { text: "你好，很高兴认识你。", clientMessageId: "client-1" } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.message.id).toBe(first.json().data.message.id);
    const conflict = await app.inject({ method: "POST", url: `/api/conversations/${conversationId}/messages`, headers: { cookie: senderCookie }, payload: { text: "同一个标识下的不同正文", clientMessageId: "client-1" } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("CLIENT_MESSAGE_ID_CONFLICT");
    const history = await app.inject({ method: "GET", url: `/api/conversations/${conversationId}/messages`, headers: { cookie: receiverCookie } });
    expect(history.statusCode).toBe(200);
    expect(history.json().data.items).toHaveLength(1);
  });

  it("消息持久化失败时不留下内存幽灵消息，重试会重新写库", async () => {
    const store = createMemoryStore();
    let failMessagePersistence = true;
    const emptyContent: ContentActivityState = { content: [], likes: [], registrations: [] };
    const emptyKnowledge: AvatarKnowledgeState = { items: [], versions: [], currentVersions: [], callLogs: [] };
    const noOp = async () => undefined;
    const persistence = new Proxy({
      hydrate: noOp,
      loadContentActivityState: async () => emptyContent,
      loadAvatarKnowledgeState: async () => emptyKnowledge,
      verifyOtp: async () => true,
      findUserByPhone: async () => undefined,
      persistHumanMessageBundle: async (message, receipt, notification) => {
        if (failMessagePersistence) throw new Error("database unavailable");
        return { message, receipt, notification };
      },
      close: noOp,
    } as Partial<StorePersistence>, {
      get(target, property) {
        return Reflect.get(target, property) ?? noOp;
      },
    }) as StorePersistence;
    store.persistence = persistence;
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const senderCookie = await login(app, "13800138000");
    const senderId = store.usersByPhone.get("13800138000")!;
    const receiverId = store.usersByPhone.get("13900139000")!;
    store.conversations.set("persistence-conversation", {
      id: "persistence-conversation",
      chatRequestId: "",
      participantIds: [senderId, receiverId],
      status: "active",
      createdAt: new Date().toISOString(),
    });

    const first = await app.inject({ method: "POST", url: "/api/conversations/persistence-conversation/messages", headers: { cookie: senderCookie }, payload: { text: "需要真正写入数据库", clientMessageId: "retry-after-failure" } });

    expect(first.statusCode).toBe(500);
    expect(store.messages.size).toBe(0);
    expect(store.messageReceipts.size).toBe(0);

    failMessagePersistence = false;
    const retried = await app.inject({ method: "POST", url: "/api/conversations/persistence-conversation/messages", headers: { cookie: senderCookie }, payload: { text: "需要真正写入数据库", clientMessageId: "retry-after-failure" } });

    expect(retried.statusCode).toBe(201);
    expect(store.messages.size).toBe(1);
    expect(store.messageReceipts.size).toBe(1);
  });

  it("参与者可以结束并恢复真人聊天，结束期间不能继续发消息", async () => {
    const store = createMemoryStore([]);
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const userACookie = await login(app, "13800138000");
    const userBCookie = await login(app, "13900139000");
    const userAId = store.usersByPhone.get("13800138000")!;
    const userBId = store.usersByPhone.get("13900139000")!;
    store.conversations.set("conversation-lifecycle", {
      id: "conversation-lifecycle",
      chatRequestId: "",
      participantIds: [userAId, userBId],
      status: "active",
      archivedAt: null,
      createdAt: new Date().toISOString(),
    });

    const archived = await app.inject({
      method: "POST",
      url: "/api/conversations/conversation-lifecycle/archive",
      headers: { cookie: userACookie },
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data.conversation).toMatchObject({ status: "archived" });
    expect(archived.json().data.conversation.archivedAt).toEqual(expect.any(String));

    const sendWhileArchived = await app.inject({
      method: "POST",
      url: "/api/conversations/conversation-lifecycle/messages",
      headers: { cookie: userBCookie },
      payload: { text: "这条消息不应该发出" },
    });
    expect(sendWhileArchived.statusCode).toBe(409);

    const restored = await app.inject({
      method: "POST",
      url: "/api/conversations/conversation-lifecycle/restore",
      headers: { cookie: userBCookie },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data.conversation).toMatchObject({ status: "active", archivedAt: null });
  });

  it("发送者可以撤回自己的近期消息且双方历史不再暴露原文", async () => {
    const store = createMemoryStore([]);
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const senderCookie = await login(app, "13800138000");
    const receiverCookie = await login(app, "13900139000");
    const senderId = store.usersByPhone.get("13800138000")!;
    const receiverId = store.usersByPhone.get("13900139000")!;
    store.conversations.set("conversation-recall", {
      id: "conversation-recall",
      chatRequestId: "",
      participantIds: [senderId, receiverId],
      status: "active",
      archivedAt: null,
      createdAt: new Date().toISOString(),
    });
    const sent = await app.inject({
      method: "POST",
      url: "/api/conversations/conversation-recall/messages",
      headers: { cookie: senderCookie },
      payload: { text: "刚刚发错的内容", clientMessageId: "recall-me" },
    });
    const messageId = sent.json().data.message.id as string;

    const forbidden = await app.inject({
      method: "POST",
      url: `/api/conversations/conversation-recall/messages/${messageId}/recall`,
      headers: { cookie: receiverCookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const recalled = await app.inject({
      method: "POST",
      url: `/api/conversations/conversation-recall/messages/${messageId}/recall`,
      headers: { cookie: senderCookie },
    });
    expect(recalled.statusCode).toBe(200);
    expect(recalled.json().data.message).toMatchObject({ text: "此消息已撤回" });
    expect(recalled.json().data.message.deletedAt).toEqual(expect.any(String));

    const history = await app.inject({
      method: "GET",
      url: "/api/conversations/conversation-recall/messages",
      headers: { cookie: receiverCookie },
    });
    expect(history.json().data.items[0]).toMatchObject({ text: "此消息已撤回" });
    expect(JSON.stringify(history.json())).not.toContain("刚刚发错的内容");
  });

  it("会话列表返回最后消息和当前用户未读数，标记已读后清零", async () => {
    const store = createMemoryStore([]);
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const receiverCookie = await login(app, "13800138000");
    const senderCookie = await login(app, "13900139000");
    const receiverId = store.usersByPhone.get("13800138000")!;
    const senderId = store.usersByPhone.get("13900139000")!;
    store.conversations.set("conversation-summary", {
      id: "conversation-summary",
      chatRequestId: "",
      participantIds: [receiverId, senderId],
      status: "active",
      archivedAt: null,
      createdAt: "2026-08-14T08:00:00.000Z",
    });

    const sent = await app.inject({
      method: "POST",
      url: "/api/conversations/conversation-summary/messages",
      headers: { cookie: senderCookie },
      payload: { text: "晚安，明天再聊。", clientMessageId: "summary-message" },
    });
    expect(sent.statusCode).toBe(201);

    const beforeRead = await app.inject({ method: "GET", url: "/api/conversations", headers: { cookie: receiverCookie } });
    expect(beforeRead.statusCode).toBe(200);
    expect(beforeRead.json().data.items).toEqual([
      expect.objectContaining({
        id: "conversation-summary",
        unreadCount: 1,
        lastMessage: expect.objectContaining({ senderId, text: "晚安，明天再聊。", createdAt: expect.any(String) }),
      }),
    ]);

    const markedRead = await app.inject({ method: "POST", url: "/api/conversations/conversation-summary/read", headers: { cookie: receiverCookie } });
    expect(markedRead.statusCode).toBe(200);
    const afterRead = await app.inject({ method: "GET", url: "/api/conversations", headers: { cookie: receiverCookie } });
    expect(afterRead.json().data.items[0]).toMatchObject({ id: "conversation-summary", unreadCount: 0 });
  });

  it("要求真人消息携带与 AI 消息同格式的 clientMessageId", async () => {
    const { app, senderCookie, conversationId } = await createDirectConversation("00401");

    const missing = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: senderCookie },
      payload: { text: "你好" },
    });
    const invalid = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: senderCookie },
      payload: { text: "你好", clientMessageId: "含空格 id" },
    });

    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: { code: "CLIENT_MESSAGE_ID_INVALID" } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: "CLIENT_MESSAGE_ID_INVALID" } });
  });

  it("服务端拦截明显资金诈骗文本但允许普通联系方式", async () => {
    const { app, store, senderCookie, conversationId } = await createDirectConversation("00402");

    const risky = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: senderCookie },
      payload: { text: "先给我的银行卡转账五千元保证金", clientMessageId: "risk-1" },
    });
    const contact = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: senderCookie },
      payload: { text: "方便加微信或者打电话吗？", clientMessageId: "contact-1" },
    });

    expect(risky.statusCode).toBe(422);
    expect(risky.json()).toMatchObject({ error: { code: "MESSAGE_FINANCIAL_RISK" } });
    expect(contact.statusCode).toBe(201);
    expect([...store.messages.values()].map((message) => message.text)).toEqual(["方便加微信或者打电话吗？"]);
  });

  it("每位用户每分钟最多发送三十条真人消息且幂等重试不重复计数", async () => {
    const { app, senderCookie, conversationId } = await createDirectConversation("00403");
    const url = `/api/conversations/${conversationId}/messages`;
    const firstPayload = { text: "第 1 条消息", clientMessageId: "rate-1" };

    const first = await app.inject({ method: "POST", url, headers: { cookie: senderCookie }, payload: firstPayload });
    const duplicate = await app.inject({ method: "POST", url, headers: { cookie: senderCookie }, payload: firstPayload });
    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(200);
    for (let index = 2; index <= 30; index += 1) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: { cookie: senderCookie },
        payload: { text: `第 ${index} 条消息`, clientMessageId: `rate-${index}` },
      });
      expect(response.statusCode).toBe(201);
    }

    const limited = await app.inject({
      method: "POST",
      url,
      headers: { cookie: senderCookie },
      payload: { text: "第 31 条消息", clientMessageId: "rate-31" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeTruthy();
    expect(limited.json()).toMatchObject({ error: { code: "HUMAN_MESSAGE_RATE_LIMITED" } });
  });

  it("另一参与者账号停用后不能再向该会话发送消息", async () => {
    const { app, store, senderCookie, receiverId, conversationId } = await createDirectConversation("00404");
    store.users.get(receiverId)!.status = "suspended";

    const response = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: senderCookie },
      payload: { text: "还能收到吗？", clientMessageId: "inactive-recipient" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "CHAT_PARTICIPANT_INACTIVE" } });
    expect(store.messages.size).toBe(0);
  });
});
