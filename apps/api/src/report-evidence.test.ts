import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("举报证据归属", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];
  afterEach(async () => { await Promise.all(apps.map((app) => app.close())); apps.length = 0; });

  function setup() {
    const store = createMemoryStore([]);
    const now = new Date().toISOString();
    for (const [id, phone, role] of [["user-a", "13800138000", "user"], ["user-b", "13900139000", "user"], ["user-c", "13700137000", "user"], ["admin", "13600136000", "admin"]] as const) {
      store.users.set(id, { id, phone, role, status: "active", createdAt: now });
      store.usersByPhone.set(phone, id);
      store.sessions.set(`token-${id}`, { id: `session-${id}`, userId: id, expiresAt: Date.now() + 60_000, userAgent: "test", createdAt: now, lastUsedAt: now });
    }
    for (const [userId, nickname, city] of [["user-a", "举报用户", "上海"], ["user-b", "被举报用户", "杭州"]] as const) {
      store.profiles.set(userId, { userId, nickname, gender: "女性", birthYear: 1980, city, district: "市区", job: "教育", maritalStatus: "离异", goal: "认真交往", introduction: "希望认真了解彼此。", preference: {}, answers: {}, profileStatus: "approved", reviewReason: null, updatedAt: now });
    }
    store.conversations.set("conversation-ab", { id: "conversation-ab", chatRequestId: "request-ab", participantIds: ["user-a", "user-b"], status: "active", createdAt: now });
    store.messages.set("message-b", { id: "message-b", conversationId: "conversation-ab", senderId: "user-b", text: "需要核查的消息", clientMessageId: null, createdAt: now });
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);
    return { app, store };
  }

  it("保存属于举报人与目标用户会话的真人消息证据", async () => {
    const { app, store } = setup();
    const response = await app.inject({ method: "POST", url: "/api/reports", headers: { cookie: "refresh_token=token-user-a" }, payload: { targetUserId: "user-b", reason: "骚扰或不尊重", description: "请核查聊天内容", conversationId: "conversation-ab", messageId: "message-b" } });
    expect(response.statusCode).toBe(201);
    expect([...store.reports.values()][0]).toMatchObject({ targetConversationId: "conversation-ab", targetMessageId: "message-b", targetAvatarSessionId: null });
  });

  it("拒绝不属于举报人与目标用户的会话证据", async () => {
    const { app } = setup();
    const response = await app.inject({ method: "POST", url: "/api/reports", headers: { cookie: "refresh_token=token-user-c" }, payload: { targetUserId: "user-b", reason: "骚扰或不尊重", description: "伪造证据", conversationId: "conversation-ab", messageId: "message-b" } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "REPORT_EVIDENCE_INVALID" } });
  });

  it("拒绝把举报人自己发送的真人消息伪装成目标用户证据", async () => {
    const { app, store } = setup();
    store.messages.set("message-a", { id: "message-a", conversationId: "conversation-ab", senderId: "user-a", text: "举报人自己的消息", clientMessageId: null, createdAt: new Date().toISOString() });

    const response = await app.inject({ method: "POST", url: "/api/reports", headers: { cookie: "refresh_token=token-user-a" }, payload: { targetUserId: "user-b", reason: "骚扰或不尊重", description: "发送者不匹配", conversationId: "conversation-ab", messageId: "message-a" } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "REPORT_EVIDENCE_INVALID" } });
  });

  it("拒绝 AI 跨会话消息和错误目标用户证据", async () => {
    const { app, store } = setup();
    const now = new Date().toISOString();
    store.members.set("member-user-b", { id: "member-user-b", nickname: "被举报用户", gender: "女性", age: 46, city: "杭州", district: "市区", job: "教育", maritalStatus: "离异", goal: "认真交往", tags: [], introduction: "希望认真了解彼此。", photoUrl: "/photo.png", activeLabel: "近期活跃", verified: true, ownerUserId: "user-b" });
    store.avatarSessions.set("avatar-session-one", { id: "avatar-session-one", userId: "user-a", memberId: "member-user-b", completedTopics: [], status: "active", createdAt: now, updatedAt: now });
    store.avatarSessions.set("avatar-session-two", { id: "avatar-session-two", userId: "user-a", memberId: "member-user-b", completedTopics: [], status: "active", createdAt: now, updatedAt: now });
    store.avatarMessages.set("avatar-other-session", { id: "avatar-other-session", sessionId: "avatar-session-two", sender: "avatar", text: "另一段会话的回答", topic: null, createdAt: now });

    const crossSession = await app.inject({ method: "POST", url: "/api/reports", headers: { cookie: "refresh_token=token-user-a" }, payload: { targetUserId: "user-b", reason: "AI 回答不当", description: "跨会话证据", avatarSessionId: "avatar-session-one", messageId: "avatar-other-session" } });
    const wrongTarget = await app.inject({ method: "POST", url: "/api/reports", headers: { cookie: "refresh_token=token-user-a" }, payload: { targetUserId: "user-c", reason: "AI 回答不当", description: "错误目标用户", avatarSessionId: "avatar-session-one" } });

    expect(crossSession.statusCode).toBe(400);
    expect(crossSession.json()).toMatchObject({ error: { code: "REPORT_EVIDENCE_INVALID" } });
    expect(wrongTarget.statusCode).toBe(400);
    expect(wrongTarget.json()).toMatchObject({ error: { code: "REPORT_EVIDENCE_INVALID" } });
  });

  it("管理员举报列表受权限保护并返回双方摘要和目标真人消息证据", async () => {
    const { app } = setup();
    await app.inject({ method: "POST", url: "/api/reports", headers: { cookie: "refresh_token=token-user-a" }, payload: { targetUserId: "user-b", reason: "骚扰或不尊重", description: "请核查聊天内容", conversationId: "conversation-ab", messageId: "message-b" } });

    const anonymous = await app.inject({ method: "GET", url: "/api/admin/reports" });
    const member = await app.inject({ method: "GET", url: "/api/admin/reports", headers: { cookie: "refresh_token=token-user-a" } });
    const admin = await app.inject({ method: "GET", url: "/api/admin/reports", headers: { cookie: "refresh_token=token-admin" } });

    expect(anonymous.statusCode).toBe(401);
    expect(member.statusCode).toBe(403);
    expect(admin.statusCode).toBe(200);
    expect(admin.json().data.items[0]).toMatchObject({
      reporter: { userId: "user-a", nickname: "举报用户", city: "上海" },
      target: { userId: "user-b", nickname: "被举报用户", city: "杭州" },
      evidence: {
        source: "human_message",
        conversationId: "conversation-ab",
        messages: [{ id: "message-b", sender: "target", text: "需要核查的消息" }],
      },
    });
    expect(JSON.stringify(admin.json())).not.toContain("13800138000");
    expect(JSON.stringify(admin.json())).not.toContain("13900139000");
  });

  it("管理员举报列表返回 AI 会话最近相关内容", async () => {
    const { app, store } = setup();
    const now = new Date().toISOString();
    store.members.set("member-user-b", { id: "member-user-b", nickname: "被举报用户", gender: "女性", age: 46, city: "杭州", district: "市区", job: "教育", maritalStatus: "离异", goal: "认真交往", tags: [], introduction: "希望认真了解彼此。", photoUrl: "/photo.png", activeLabel: "近期活跃", verified: true, ownerUserId: "user-b" });
    store.avatarSessions.set("avatar-session-ab", { id: "avatar-session-ab", userId: "user-a", memberId: "member-user-b", completedTopics: [], status: "active", createdAt: now, updatedAt: now });
    store.avatarMessages.set("avatar-question", { id: "avatar-question", sessionId: "avatar-session-ab", sender: "user", text: "你怎么看待家庭分工？", topic: "家庭", createdAt: new Date(Date.now() - 1_000).toISOString() });
    store.avatarMessages.set("avatar-answer", { id: "avatar-answer", sessionId: "avatar-session-ab", sender: "avatar", text: "我希望双方共同承担。", topic: "家庭", createdAt: now });
    await app.inject({ method: "POST", url: "/api/reports", headers: { cookie: "refresh_token=token-user-a" }, payload: { targetUserId: "user-b", reason: "AI 回答不当", description: "请核查 AI 会话", avatarSessionId: "avatar-session-ab" } });

    const admin = await app.inject({ method: "GET", url: "/api/admin/reports", headers: { cookie: "refresh_token=token-admin" } });

    expect(admin.statusCode).toBe(200);
    expect(admin.json().data.items[0].evidence).toMatchObject({
      source: "avatar_session",
      avatarSessionId: "avatar-session-ab",
      messages: [
        { id: "avatar-question", sender: "reporter", text: "你怎么看待家庭分工？" },
        { id: "avatar-answer", sender: "avatar", text: "我希望双方共同承担。" },
      ],
    });
  });
});
