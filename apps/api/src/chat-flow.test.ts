import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";
import type { StorePersistence } from "./store/types.js";

describe("AI 分身到真人聊天的真实状态机", () => {
  const apps: Array<Awaited<ReturnType<typeof buildServer>>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  async function login(app: ReturnType<typeof buildServer>, phone: string) {
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
    const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone, code: "123456" } });
    const cookie = response.cookies.find((item) => item.name === "refresh_token");
    expect(cookie?.value).toBeTruthy();
    return `${cookie?.name}=${cookie?.value}`;
  }

  function createApp() {
    const app = buildServer({ otpCode: "123456", store: createMemoryStore() });
    apps.push(app);
    return app;
  }

  function attachChatRequestPersistence(store: ReturnType<typeof createMemoryStore>) {
    const persistChatRequest = vi.fn().mockResolvedValue(undefined);
    store.persistence = new Proxy({
      hydrate: vi.fn().mockResolvedValue(undefined),
      loadContentActivityState: vi.fn().mockResolvedValue(undefined),
      loadAvatarKnowledgeState: vi.fn().mockResolvedValue(undefined),
      verifyOtp: vi.fn().mockResolvedValue(true),
      findUserByPhone: vi.fn().mockResolvedValue(undefined),
      persistChatRequest,
      close: vi.fn().mockResolvedValue(undefined),
    } as Partial<StorePersistence>, {
      get(target, property) {
        return Reflect.get(target, property) ?? vi.fn().mockResolvedValue(undefined);
      },
    }) as StorePersistence;
    return persistChatRequest;
  }

  async function createReadyRequest(app: ReturnType<typeof buildServer>, cookie: string) {
    const created = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie }, payload: { memberId: "lin-wanqing" } });
    const sessionId = created.json().data.session.id as string;
    for (const [index, text] of ["周末怎么过？", "关系期待是什么？", "遇到分歧如何沟通？"].entries()) {
      await app.inject({
        method: "POST",
        url: `/api/avatar-sessions/${sessionId}/messages`,
        headers: { cookie },
        payload: { text, clientMessageId: `ready-${sessionId}-${index}` },
      });
    }
    return app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie }, payload: { avatarSessionId: sessionId } });
  }

  it("目标用户未授权 AI 分身时拒绝创建会话", async () => {
    const store = createMemoryStore();
    store.avatarProfiles.delete("00000000-0000-4000-8000-000000000001");
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const cookie = await login(app, "13800138000");

    const response = await app.inject({
      method: "POST",
      url: "/api/avatar-sessions",
      headers: { cookie },
      payload: { memberId: "lin-wanqing" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("AI_PROFILE_NOT_ENABLED");
  });

  it("目标用户暂停 AI 分身后，已有会话立即停止回答", async () => {
    const store = createMemoryStore();
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const cookie = await login(app, "13800138000");
    const session = await app.inject({
      method: "POST",
      url: "/api/avatar-sessions",
      headers: { cookie },
      payload: { memberId: "lin-wanqing" },
    });
    store.avatarProfiles.get("00000000-0000-4000-8000-000000000001")!.status = "paused";

    const response = await app.inject({
      method: "POST",
      url: `/api/avatar-sessions/${session.json().data.session.id}/messages`,
      headers: { cookie },
      payload: { text: "周末通常怎么安排？" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("AI_PROFILE_NOT_ENABLED");
  });

  it("AI 分身会话保存消息并按主题累计了解进度", async () => {
    const app = createApp();
    const cookie = await login(app, "13800138000");
    const sessionResponse = await app.inject({
      method: "POST",
      url: "/api/avatar-sessions",
      headers: { cookie },
      payload: { memberId: "lin-wanqing" },
    });
    expect(sessionResponse.statusCode).toBe(201);
    const sessionId = sessionResponse.json().data.session.id;

    for (const text of ["周末通常怎么安排？", "你希望建立怎样的关系？", "沟通中最看重什么？"]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/avatar-sessions/${sessionId}/messages`,
        headers: { cookie },
        payload: { text },
      });
      expect(response.statusCode).toBe(201);
    }

    const session = await app.inject({ method: "GET", url: `/api/avatar-sessions/${sessionId}`, headers: { cookie } });
    expect(session.statusCode).toBe(200);
    expect(session.json().data.session.completedTopicCount).toBe(3);
    expect(session.json().data.session.canRequestChat).toBe(true);
    const messages = await app.inject({ method: "GET", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie } });
    expect(messages.json().data.items).toHaveLength(6);
  });

  it("AI 回答持久化模型审计字段但不向用户接口暴露", async () => {
    const persistAvatarMessages = vi.fn().mockResolvedValue(undefined);
    const persistAvatarReplySuccess = vi.fn().mockResolvedValue(undefined);
    const store = createMemoryStore();
    store.persistence = new Proxy({
      hydrate: vi.fn().mockResolvedValue(undefined),
      loadContentActivityState: vi.fn().mockResolvedValue(undefined),
      loadAvatarKnowledgeState: vi.fn().mockResolvedValue(undefined),
      verifyOtp: vi.fn().mockResolvedValue(true),
      persistAvatarMessages,
      persistAvatarReplySuccess,
      close: vi.fn().mockResolvedValue(undefined),
    }, {
      get(target, property) {
        return Reflect.get(target, property) ?? vi.fn().mockResolvedValue(undefined);
      },
    }) as unknown as StorePersistence;
    const reply = vi.fn().mockResolvedValue("这是经过授权的回答");
    const app = buildServer({
      otpCode: "123456",
      store,
      avatarModelName: "audited-avatar-model",
      providers: { avatarModel: { reply } },
    });
    apps.push(app);
    const cookie = await login(app, "13800138000");
    const session = await app.inject({
      method: "POST",
      url: "/api/avatar-sessions",
      headers: { cookie },
      payload: { memberId: "lin-wanqing" },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/avatar-sessions/${session.json().data.session.id}/messages`,
      headers: { cookie },
      payload: { text: "周末通常怎么安排？" },
    });

    expect(response.statusCode).toBe(201);
    expect(persistAvatarMessages).toHaveBeenCalledOnce();
    expect(persistAvatarReplySuccess).toHaveBeenCalledOnce();
    const persistedUser = persistAvatarMessages.mock.calls[0][0][0];
    const persistedAvatar = persistAvatarReplySuccess.mock.calls[0][1];
    expect(persistedUser).toMatchObject({
      sender: "user",
      modelName: null,
      promptVersion: null,
      latencyMs: null,
    });
    expect(persistedAvatar).toMatchObject({
      sender: "avatar",
      modelName: "audited-avatar-model",
      promptVersion: "avatar-profile-v1",
      latencyMs: expect.any(Number),
    });
    expect(persistedAvatar.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(response.json())).not.toMatch(/modelName|promptVersion|latencyMs/);
  });

  it("未完成了解主题不能申请真人聊天，完成后申请幂等", async () => {
    const app = createApp();
    const cookie = await login(app, "13800138000");
    const session = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie }, payload: { memberId: "lin-wanqing" } });
    const sessionId = session.json().data.session.id;

    const blocked = await app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie }, payload: { avatarSessionId: sessionId } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("CHAT_NOT_READY");

    for (const text of ["周末怎么过？", "关系期待是什么？", "遇到分歧如何沟通？"]) {
      await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie }, payload: { text } });
    }
    const first = await app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie }, payload: { avatarSessionId: sessionId } });
    const second = await app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie }, payload: { avatarSessionId: sessionId } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.request.id).toBe(first.json().data.request.id);
  });

  it("接收方同意申请后才创建真人会话", async () => {
    const app = createApp();
    const senderCookie = await login(app, "13800138000");
    const receiverCookie = await login(app, "13900139000");
    const session = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie: senderCookie }, payload: { memberId: "lin-wanqing" } });
    const sessionId = session.json().data.session.id;
    for (const text of ["周末怎么过？", "关系期待是什么？", "遇到分歧如何沟通？"]) {
      await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: senderCookie }, payload: { text } });
    }
    const request = await app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie: senderCookie }, payload: { avatarSessionId: sessionId } });
    const requestId = request.json().data.request.id;
    const before = await app.inject({ method: "GET", url: "/api/conversations", headers: { cookie: receiverCookie } });
    expect(before.json().data.items).toHaveLength(0);
    const accepted = await app.inject({ method: "POST", url: `/api/chat-requests/${requestId}/accept`, headers: { cookie: receiverCookie } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().data.conversation.status).toBe("active");
  });

  it("完成三个主题但服务端评估未达到继续条件时不能申请真人聊天", async () => {
    const store = createMemoryStore([{
      id: "low-match",
      demo: true,
      nickname: "低匹配测试用户",
      gender: "女性",
      age: 45,
      city: "北京",
      district: "朝阳",
      job: "教育",
      maritalStatus: "离异",
      goal: "认真交往",
      tags: ["阅读"],
      introduction: "用于验证服务端准入。",
      photoUrl: "/images/member-lin-v2.jpg",
      activeLabel: "近期活跃",
      verified: true,
      ownerUserId: "00000000-0000-4000-8000-000000000099",
      score: 20,
    }]);
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const cookie = await login(app, "13800138000");
    const created = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie }, payload: { memberId: "low-match" } });
    const sessionId = created.json().data.session.id;
    for (const text of ["周末怎么过？", "关系期待是什么？", "遇到分歧如何沟通？"]) {
      await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie }, payload: { text } });
    }

    const analysis = await app.inject({ method: "GET", url: `/api/avatar-sessions/${sessionId}/analysis`, headers: { cookie } });
    const request = await app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie }, payload: { avatarSessionId: sessionId } });

    expect(analysis.json().data.analysis.canRequestChat).toBe(false);
    expect(analysis.json().data.analysis.summary).toContain("继续了解");
    expect(request.statusCode).toBe(409);
    expect(request.json()).toMatchObject({ error: { code: "CHAT_NOT_READY" } });
  });

  it("拒绝后重新申请复用原申请记录", async () => {
    const app = createApp();
    const senderCookie = await login(app, "13800138000");
    const receiverCookie = await login(app, "13900139000");
    const created = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie: senderCookie }, payload: { memberId: "lin-wanqing" } });
    const sessionId = created.json().data.session.id;
    for (const text of ["周末怎么过？", "关系期待是什么？", "遇到分歧如何沟通？"]) {
      await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: senderCookie }, payload: { text } });
    }
    const first = await app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie: senderCookie }, payload: { avatarSessionId: sessionId } });
    const firstId = first.json().data.request.id;
    await app.inject({ method: "POST", url: `/api/chat-requests/${firstId}/reject`, headers: { cookie: receiverCookie } });

    const retried = await app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie: senderCookie }, payload: { avatarSessionId: sessionId } });

    expect(retried.statusCode).toBe(200);
    expect(retried.json().data.request).toMatchObject({ id: firstId, status: "pending" });
  });

  it("待处理申请默认七天有效并在列表读取时惰性过期且持久化", async () => {
    const store = createMemoryStore();
    const persistChatRequest = attachChatRequestPersistence(store);
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const senderCookie = await login(app, "13800138000");
    const createdAt = Date.now();
    const response = await createReadyRequest(app, senderCookie);
    const requestId = response.json().data.request.id as string;
    const requestItem = store.chatRequests.get(requestId)!;
    expect(new Date(requestItem.expiresAt!).getTime() - createdAt).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1_000 - 2_000);
    requestItem.expiresAt = new Date(Date.now() - 1_000).toISOString();
    persistChatRequest.mockClear();

    const listed = await app.inject({ method: "GET", url: "/api/chat-requests", headers: { cookie: senderCookie } });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.items[0]).toMatchObject({ id: requestId, status: "expired", expiresAt: requestItem.expiresAt });
    expect(persistChatRequest).toHaveBeenCalledWith(expect.objectContaining({ id: requestId, status: "expired" }));
  });

  it.each(["accept", "reject"] as const)("过期申请不能执行 %s 并会持久化过期状态", async (action) => {
    const store = createMemoryStore();
    const persistChatRequest = attachChatRequestPersistence(store);
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const senderCookie = await login(app, "13800138000");
    const receiverCookie = await login(app, "13900139000");
    const created = await createReadyRequest(app, senderCookie);
    const requestId = created.json().data.request.id as string;
    store.chatRequests.get(requestId)!.expiresAt = new Date(Date.now() - 1_000).toISOString();
    persistChatRequest.mockClear();

    const response = await app.inject({ method: "POST", url: `/api/chat-requests/${requestId}/${action}`, headers: { cookie: receiverCookie } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "REQUEST_EXPIRED" } });
    expect(store.chatRequests.get(requestId)?.status).toBe("expired");
    expect(persistChatRequest).toHaveBeenCalledWith(expect.objectContaining({ id: requestId, status: "expired" }));
  });

  it("过期申请可以复用原记录重新申请并刷新七天有效期", async () => {
    const store = createMemoryStore();
    const persistChatRequest = attachChatRequestPersistence(store);
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const senderCookie = await login(app, "13800138000");
    const created = await createReadyRequest(app, senderCookie);
    const requestId = created.json().data.request.id as string;
    store.chatRequests.get(requestId)!.expiresAt = new Date(Date.now() - 1_000).toISOString();
    persistChatRequest.mockClear();

    const retried = await app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie: senderCookie }, payload: { avatarSessionId: created.json().data.request.avatarSessionId } });

    expect(retried.statusCode).toBe(200);
    expect(retried.json().data.request).toMatchObject({ id: requestId, status: "pending", expiresAt: expect.any(String) });
    expect(new Date(retried.json().data.request.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1_000);
    expect(persistChatRequest.mock.calls.map(([item]) => item.status)).toEqual(["expired", "pending"]);
  });

  it("申请人账号停用后接收方不能接受申请", async () => {
    const store = createMemoryStore();
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const senderCookie = await login(app, "13800138000");
    const receiverCookie = await login(app, "13900139000");
    const created = await createReadyRequest(app, senderCookie);
    const requestId = created.json().data.request.id as string;
    const requesterId = store.chatRequests.get(requestId)!.fromUserId;
    store.users.get(requesterId)!.status = "suspended";

    const accepted = await app.inject({ method: "POST", url: `/api/chat-requests/${requestId}/accept`, headers: { cookie: receiverCookie } });

    expect(accepted.statusCode).toBe(409);
    expect(accepted.json()).toMatchObject({ error: { code: "CHAT_PARTICIPANT_INACTIVE" } });
    expect(store.conversations.size).toBe(0);
  });

  it("双方任一方屏蔽后不能创建或继续 AI 会话、申请或接受真人聊天", async () => {
    const app = createApp();
    const sender = await login(app, "13800138000");
    const receiver = await login(app, "13900139000");
    const created = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie: sender }, payload: { memberId: "lin-wanqing" } });
    const sessionId = created.json().data.session.id;
    for (const text of ["周末怎么过？", "关系期待是什么？", "遇到分歧如何沟通？"]) {
      await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: sender }, payload: { text } });
    }
    const request = await app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie: sender }, payload: { avatarSessionId: sessionId } });
    const requestId = request.json().data.request.id;
    const senderMe = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: sender } });
    await app.inject({ method: "POST", url: `/api/users/${senderMe.json().data.user.id}/block`, headers: { cookie: receiver } });

    const newSession = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie: sender }, payload: { memberId: "lin-wanqing" } });
    const continued = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: sender }, payload: { text: "还可以继续聊吗？" } });
    const reapplied = await app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie: sender }, payload: { avatarSessionId: sessionId } });
    const accepted = await app.inject({ method: "POST", url: `/api/chat-requests/${requestId}/accept`, headers: { cookie: receiver } });

    for (const response of [newSession, continued, reapplied, accepted]) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: "CHAT_BLOCKED" } });
    }
  });

  it("正式会员只接受审核通过且有公开照片的用户联系", async () => {
    const store = createMemoryStore([{
      id: "member-real-target",
      nickname: "正式会员",
      gender: "女性",
      age: 46,
      city: "上海",
      district: "徐汇",
      job: "教育",
      maritalStatus: "离异",
      goal: "认真交往",
      tags: ["真诚"],
      introduction: "审核通过的正式会员。",
      photoUrl: "/api/photos/approved/content",
      activeLabel: "近期活跃",
      verified: true,
      ownerUserId: "00000000-0000-4000-8000-000000000099",
    }]);
    store.avatarProfiles.set("00000000-0000-4000-8000-000000000099", {
      userId: "00000000-0000-4000-8000-000000000099",
      version: 1,
      approvedFacts: [{ topic: "生活习惯", fact: "生活规律。" }],
      relationshipExpectations: ["认真交往"],
      boundaries: ["不公开联系方式"],
      unknownResponse: "建议真人确认。",
      status: "enabled",
      generatedAt: new Date().toISOString(),
      enabledAt: new Date().toISOString(),
    });
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const cookie = await login(app, "13800138000");

    const response = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie }, payload: { memberId: "member-real-target" } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "ACCOUNT_REVIEW_REQUIRED" } });
  });

  it("正式会员必须先被选择为心仪对象才能创建 AI 会话", async () => {
    const store = createMemoryStore([{
      id: "member-real-target", nickname: "正式会员", gender: "女性", age: 46, city: "上海", district: "徐汇", job: "教育", maritalStatus: "离异", goal: "认真交往", tags: ["真诚"], introduction: "审核通过的正式会员。", photoUrl: "/api/photos/approved/content", activeLabel: "近期活跃", verified: true, ownerUserId: "00000000-0000-4000-8000-000000000099",
    }]);
    store.avatarProfiles.set("00000000-0000-4000-8000-000000000099", { userId: "00000000-0000-4000-8000-000000000099", version: 1, approvedFacts: [{ topic: "生活习惯", fact: "生活规律。" }], relationshipExpectations: ["认真交往"], boundaries: ["不公开联系方式"], unknownResponse: "建议真人确认。", status: "enabled", generatedAt: new Date().toISOString(), enabledAt: new Date().toISOString() });
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const cookie = await login(app, "13800138000");
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    const userId = me.json().data.user.id as string;
    store.profiles.set(userId, { userId, nickname: "申请人", gender: "男性", birthYear: 1978, city: "上海", district: "静安", job: "工程", maritalStatus: "离异", goal: "认真交往", introduction: "认真认识。", preference: { preferredGender: "女性" }, answers: {}, profileStatus: "approved", visibility: "public", updatedAt: new Date().toISOString() });
    store.members.set(`member-${userId}`, { ...store.members.get("member-real-target")!, id: `member-${userId}`, gender: "男性", ownerUserId: userId });

    const blocked = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie }, payload: { memberId: "member-real-target" } });
    await app.inject({ method: "POST", url: "/api/members/member-real-target/interest", headers: { cookie } });
    const allowed = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie }, payload: { memberId: "member-real-target" } });

    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: "INTEREST_REQUIRED" } });
    expect(allowed.statusCode).toBe(201);
  });

  it("取消心仪后旧 AI 会话不能继续发送消息", async () => {
    const store = createMemoryStore([{
      id: "member-interest-revoked", nickname: "正式会员", gender: "女性", age: 46, city: "上海", district: "徐汇", job: "教育", maritalStatus: "离异", goal: "认真交往", tags: ["真诚"], introduction: "审核通过的正式会员。", photoUrl: "/api/photos/approved/content", activeLabel: "近期活跃", verified: true, ownerUserId: "00000000-0000-4000-8000-000000000098",
    }]);
    store.avatarProfiles.set("00000000-0000-4000-8000-000000000098", { userId: "00000000-0000-4000-8000-000000000098", version: 1, approvedFacts: [{ topic: "生活习惯", fact: "生活规律。" }], relationshipExpectations: ["认真交往"], boundaries: ["不公开联系方式"], unknownResponse: "建议真人确认。", status: "enabled", generatedAt: new Date().toISOString(), enabledAt: new Date().toISOString() });
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const cookie = await login(app, "13800138000");
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    const userId = me.json().data.user.id as string;
    store.profiles.set(userId, { userId, nickname: "申请人", gender: "男性", birthYear: 1978, city: "上海", district: "静安", job: "工程", maritalStatus: "离异", goal: "认真交往", introduction: "认真认识。", preference: { preferredGender: "女性" }, answers: {}, profileStatus: "approved", visibility: "public", updatedAt: new Date().toISOString() });
    store.members.set(`member-${userId}`, { ...store.members.get("member-interest-revoked")!, id: `member-${userId}`, gender: "男性", ownerUserId: userId });
    await app.inject({ method: "POST", url: "/api/members/member-interest-revoked/interest", headers: { cookie } });
    const session = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie }, payload: { memberId: "member-interest-revoked" } });
    await app.inject({ method: "DELETE", url: "/api/members/member-interest-revoked/interest", headers: { cookie } });

    const response = await app.inject({ method: "POST", url: `/api/avatar-sessions/${session.json().data.session.id}/messages`, headers: { cookie }, payload: { text: "周末喜欢做什么？" } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "INTEREST_REQUIRED" } });
  });

  it("聊天分析只返回面向用户的结论而不泄露算法结构", async () => {
    const store = createMemoryStore();
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const cookie = await login(app, "13800138000");
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    const userId = me.json().data.user.id as string;
    store.profiles.set(userId, { userId, nickname: "申请人", gender: "男性", birthYear: 1978, city: "上海", district: "静安", job: "工程", maritalStatus: "离异", goal: "认真交往", introduction: "认真认识。", preference: { preferredGender: "女性" }, answers: {}, profileStatus: "approved", visibility: "public", updatedAt: new Date().toISOString() });
    const session = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie }, payload: { memberId: "lin-wanqing" } });
    const analysis = await app.inject({ method: "GET", url: `/api/avatar-sessions/${session.json().data.session.id}/analysis`, headers: { cookie } });

    expect(analysis.statusCode).toBe(200);
    expect(analysis.json().data.analysis).toMatchObject({ score: expect.any(Number), commonPoints: expect.any(Array) });
    expect(analysis.json().data.analysis).not.toHaveProperty("algorithmVersion");
    expect(analysis.json().data.analysis).not.toHaveProperty("factors");
  });

  it("AI 问答在十分钟窗口内限制为二十条", async () => {
    const app = createApp();
    const cookie = await login(app, "13800138000");
    const session = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie }, payload: { memberId: "lin-wanqing" } });
    const sessionId = session.json().data.session.id as string;
    for (let index = 0; index < 20; index += 1) {
      const response = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie }, payload: { text: `第 ${index + 1} 个问题` } });
      expect(response.statusCode).toBe(201);
    }
    const limited = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie }, payload: { text: "第二十一个问题" } });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: "AVATAR_MESSAGE_RATE_LIMITED" } });
  });

  it("目标用户暂停分身后不能用旧会话申请真人聊天", async () => {
    const store = createMemoryStore();
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const cookie = await login(app, "13800138000");
    const session = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie }, payload: { memberId: "lin-wanqing" } });
    const sessionId = session.json().data.session.id as string;
    for (const text of ["周末怎么过？", "关系期待是什么？", "遇到分歧如何沟通？"]) {
      await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie }, payload: { text } });
    }
    store.avatarProfiles.get("00000000-0000-4000-8000-000000000001")!.status = "paused";

    const response = await app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie }, payload: { avatarSessionId: sessionId } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "AI_PROFILE_NOT_ENABLED" } });
  });

  it("双向申请被依次接受时复用同一个真人会话", async () => {
    const store = createMemoryStore();
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const userA = await login(app, "13800138000");
    const userB = await login(app, "13900139000");
    const meA = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: userA } });
    const userAId = meA.json().data.user.id as string;
    store.members.set("member-user-a", {
      id: "member-user-a", demo: true, nickname: "用户 A", gender: "男性", age: 48, city: "上海", district: "静安", job: "产品", maritalStatus: "离异", goal: "认真交往", tags: ["真诚"], introduction: "用于双向申请测试。", photoUrl: "/images/member-zhou-v2.jpg", activeLabel: "近期活跃", verified: true, ownerUserId: userAId, score: 92,
    });
    store.avatarProfiles.set(userAId, { userId: userAId, version: 1, approvedFacts: [{ topic: "生活习惯", fact: "生活规律。" }], relationshipExpectations: ["认真交往"], boundaries: ["不公开联系方式"], unknownResponse: "建议真人确认。", status: "enabled", generatedAt: new Date().toISOString(), enabledAt: new Date().toISOString() });

    async function readyRequest(cookie: string, memberId: string) {
      const created = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie }, payload: { memberId } });
      const sessionId = created.json().data.session.id as string;
      for (const text of ["周末怎么过？", "关系期待是什么？", "遇到分歧如何沟通？"]) {
        await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie }, payload: { text } });
      }
      return app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie }, payload: { avatarSessionId: sessionId } });
    }

    const fromA = await readyRequest(userA, "lin-wanqing");
    const fromB = await readyRequest(userB, "member-user-a");
    expect(fromA.statusCode).toBe(201);
    expect(fromB.statusCode).toBe(201);
    const acceptedByB = await app.inject({ method: "POST", url: `/api/chat-requests/${fromA.json().data.request.id}/accept`, headers: { cookie: userB } });
    const acceptedByA = await app.inject({ method: "POST", url: `/api/chat-requests/${fromB.json().data.request.id}/accept`, headers: { cookie: userA } });

    expect(acceptedByA.statusCode).toBe(200);
    expect(acceptedByA.json().data.conversation.id).toBe(acceptedByB.json().data.conversation.id);
    expect(store.conversations.size).toBe(1);
  });
});
