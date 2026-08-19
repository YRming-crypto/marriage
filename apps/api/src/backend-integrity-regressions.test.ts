import { relationshipQuestions } from "@ai-marriage/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryAvatarKnowledgeService, type AvatarKnowledgeState } from "./avatar-knowledge/index.js";
import { ContentActivityService, type ContentActivityState } from "./content/index.js";
import { cleanupExpiredAccount } from "./operations/index.js";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";
import type {
  Store,
  StorePersistence,
  StoredAvatarSession,
  StoredChatRequest,
  StoredMember,
  StoredPhoto,
  StoredProfile,
  StoredUser,
} from "./store/types.js";

const NOW = "2026-08-14T08:00:00.000Z";

function persistence(overrides: Partial<StorePersistence> & Record<string, unknown> = {}) {
  return new Proxy({
    hydrate: async () => undefined,
    loadContentActivityState: async () => undefined,
    loadAvatarKnowledgeState: async () => undefined,
    close: async () => undefined,
    ...overrides,
  }, {
    get(target, property) {
      return Reflect.get(target, property) ?? (async (...args: unknown[]) => args[0]);
    },
  }) as StorePersistence;
}

function authenticate(store: Store, input: Partial<StoredUser> & Pick<StoredUser, "id" | "phone">) {
  const user: StoredUser = {
    role: "user",
    status: "active",
    createdAt: NOW,
    ...input,
  };
  const token = `token-${user.id}`;
  store.users.set(user.id, user);
  store.usersByPhone.set(user.phone, user.id);
  store.sessions.set(token, {
    id: `session-${user.id}`,
    userId: user.id,
    expiresAt: Date.now() + 60_000,
    userAgent: "test",
    createdAt: NOW,
    lastUsedAt: NOW,
  });
  return { user, cookie: `refresh_token=${token}` };
}

function approvedProfile(userId: string, overrides: Partial<StoredProfile> = {}): StoredProfile {
  return {
    userId,
    nickname: "完整资料用户",
    gender: "女性",
    birthYear: 1980,
    city: "上海",
    district: "徐汇",
    job: "教育",
    maritalStatus: "离异",
    goal: "认真交往",
    introduction: "生活稳定，希望认真了解彼此。",
    preference: {},
    answers: Object.fromEntries(relationshipQuestions.map((question) => [question, "认真沟通，一起商量。"])),
    profileStatus: "approved",
    visibility: "public",
    reviewReason: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function approvedPhoto(userId: string, overrides: Partial<StoredPhoto> = {}): StoredPhoto {
  return {
    id: `photo-${userId}`,
    userId,
    filename: "portrait.png",
    objectKey: `${userId}/portrait.png`,
    url: `/api/photos/photo-${userId}/content`,
    mimeType: "image/png",
    sizeBytes: 68,
    isPrimary: true,
    reviewStatus: "approved",
    reviewReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function member(userId: string, overrides: Partial<StoredMember> = {}): StoredMember {
  return {
    id: `member-${userId}`,
    nickname: "正式会员",
    gender: "女性",
    age: 46,
    city: "上海",
    district: "徐汇",
    job: "教育",
    maritalStatus: "离异",
    goal: "认真交往",
    tags: ["真诚"],
    introduction: "希望认真了解彼此。",
    photoUrl: `/api/photos/photo-${userId}/content`,
    activeLabel: "近期活跃",
    verified: true,
    ownerUserId: userId,
    score: 90,
    ...overrides,
  };
}

function readyChatFixture() {
  const store = createMemoryStore([]);
  const requester = authenticate(store, { id: "00000000-0000-4000-8000-000000000101", phone: "13800138101" });
  const recipient = authenticate(store, { id: "00000000-0000-4000-8000-000000000102", phone: "13800138102" });
  for (const party of [requester, recipient]) {
    store.profiles.set(party.user.id, approvedProfile(party.user.id));
    store.photos.set(`photo-${party.user.id}`, approvedPhoto(party.user.id));
    store.members.set(`member-${party.user.id}`, member(party.user.id));
    store.avatarProfiles.set(party.user.id, {
      userId: party.user.id,
      version: 1,
      approvedFacts: [{ topic: "生活方式", fact: "生活规律。" }],
      relationshipExpectations: ["认真交往"],
      boundaries: ["不公开联系方式"],
      unknownResponse: "建议真人确认。",
      status: "enabled",
      generatedAt: NOW,
      enabledAt: NOW,
    });
  }
  const targetMemberId = `member-${recipient.user.id}`;
  store.interests.set(`${requester.user.id}:${targetMemberId}`, {
    id: "interest-ready",
    userId: requester.user.id,
    memberId: targetMemberId,
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  });
  const avatarSession: StoredAvatarSession = {
    id: "avatar-session-ready",
    userId: requester.user.id,
    memberId: targetMemberId,
    completedTopics: ["life", "relationship", "communication"],
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  };
  store.avatarSessions.set(avatarSession.id, avatarSession);
  const request: StoredChatRequest = {
    id: "chat-request-ready",
    avatarSessionId: avatarSession.id,
    fromUserId: requester.user.id,
    toUserId: recipient.user.id,
    memberId: targetMemberId,
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };
  store.chatRequests.set(request.id, request);
  return { store, requester, recipient, request, avatarSession, targetMemberId };
}

describe("backend integrity regressions", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  it("登录时内存手机号索引未命中会先恢复数据库用户，不会重复创建账号", async () => {
    const store = createMemoryStore([]);
    const phone = "13900139999";
    const persistedUser: StoredUser = {
      id: "persisted-admin-user",
      phone,
      role: "admin",
      status: "active",
      createdAt: NOW,
    };
    const findUserByPhone = vi.fn().mockResolvedValue(persistedUser);
    const persistUser = vi.fn().mockRejectedValue(new Error("users_phone_hash_key"));
    const persistSession = vi.fn().mockResolvedValue(undefined);
    store.persistence = persistence({
      verifyOtp: vi.fn().mockResolvedValue(true),
      findUserByPhone,
      persistUser,
      persistSession,
    });
    const app = buildServer({ store, adminPhones: [phone] });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { phone, code: "123456" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.user).toMatchObject({ id: persistedUser.id, role: "admin" });
    expect(findUserByPhone).toHaveBeenCalledWith(phone);
    expect(persistUser).not.toHaveBeenCalled();
    expect(persistSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ userId: persistedUser.id }),
    );
    expect(store.users.get(persistedUser.id)).toEqual(persistedUser);
    expect(store.usersByPhone.get(phone)).toBe(persistedUser.id);
  });

  it("正式用户不能把自己设为心仪", async () => {
    const store = createMemoryStore();
    const ownerId = store.members.get("lin-wanqing")!.ownerUserId!;
    const owner = authenticate(store, { ...store.users.get(ownerId)!, id: ownerId });
    const app = buildServer({ store });
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/members/lin-wanqing/interest", headers: { cookie: owner.cookie } });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SELF_NOT_ALLOWED");
    expect(store.interests.has(`${ownerId}:lin-wanqing`)).toBe(false);
  });

  it.each([
    ["nickname", "昵".repeat(41)],
    ["city", "城".repeat(81)],
    ["district", "区".repeat(81)],
    ["job", "职".repeat(81)],
    ["introduction", "介".repeat(1001)],
  ])("建档字段 %s 超过数据库长度时稳定返回 400", async (field, value) => {
    const store = createMemoryStore([]);
    const current = authenticate(store, { id: `user-length-${field}`, phone: `13800${String(field.length).padStart(6, "0")}`.slice(0, 11) });
    const app = buildServer({ store });
    apps.push(app);
    const payload = {
      nickname: "测试用户",
      gender: "女性",
      birthYear: 1980,
      city: "上海",
      district: "徐汇",
      job: "教育",
      maritalStatus: "离异",
      goal: "认真交往",
      introduction: "生活稳定，希望认真认识彼此。",
      preference: {},
      answers: Object.fromEntries(relationshipQuestions.map((question) => [question, "认真沟通，一起商量。"])),
      [field]: value,
    };

    const response = await app.inject({ method: "PATCH", url: "/api/me/profile", headers: { cookie: current.cookie }, payload });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("PROFILE_INVALID");
    expect(store.profiles.has(current.user.id)).toBe(false);
  });

  it.each([
    ["interest", "INTEREST_REQUIRED", (fixture: ReturnType<typeof readyChatFixture>) => {
      storeInterest(fixture).status = "removed";
    }],
    ["requester-profile", "ACCOUNT_REVIEW_REQUIRED", (fixture: ReturnType<typeof readyChatFixture>) => {
      fixture.store.profiles.get(fixture.requester.user.id)!.profileStatus = "rejected";
    }],
    ["recipient-profile", "ACCOUNT_REVIEW_REQUIRED", (fixture: ReturnType<typeof readyChatFixture>) => {
      fixture.store.profiles.get(fixture.recipient.user.id)!.profileStatus = "rejected";
    }],
    ["requester-photo", "ACCOUNT_REVIEW_REQUIRED", (fixture: ReturnType<typeof readyChatFixture>) => {
      fixture.store.photos.get(`photo-${fixture.requester.user.id}`)!.reviewStatus = "rejected";
    }],
    ["recipient-photo", "ACCOUNT_REVIEW_REQUIRED", (fixture: ReturnType<typeof readyChatFixture>) => {
      fixture.store.photos.get(`photo-${fixture.recipient.user.id}`)!.reviewStatus = "rejected";
    }],
    ["avatar-profile", "AI_PROFILE_NOT_ENABLED", (fixture: ReturnType<typeof readyChatFixture>) => {
      fixture.store.avatarProfiles.get(fixture.recipient.user.id)!.status = "paused";
    }],
    ["requester-avatar-profile", "AI_PROFILE_NOT_ENABLED", (fixture: ReturnType<typeof readyChatFixture>) => {
      fixture.store.avatarProfiles.get(fixture.requester.user.id)!.status = "paused";
    }],
    ["avatar-session", "CHAT_NOT_READY", (fixture: ReturnType<typeof readyChatFixture>) => {
      fixture.avatarSession.completedTopics = ["life", "relationship"];
    }],
  ] as const)("接受申请时重新校验 %s 门槛", async (_case, expectedCode, invalidate) => {
    const fixture = readyChatFixture();
    invalidate(fixture);
    const app = buildServer({ store: fixture.store });
    apps.push(app);

    const response = await app.inject({ method: "POST", url: `/api/chat-requests/${fixture.request.id}/accept`, headers: { cookie: fixture.recipient.cookie } });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe(expectedCode);
    expect(fixture.store.chatRequests.get(fixture.request.id)?.status).toBe("pending");
    expect(fixture.store.conversations.size).toBe(0);
  });

  it("取消心仪后 pending 申请保持未接受且不能创建真人会话", async () => {
    const fixture = readyChatFixture();
    const persistInterest = vi.fn().mockResolvedValue(undefined);
    const persistAcceptedChatRequest = vi.fn();
    fixture.store.persistence = persistence({ persistInterest, persistAcceptedChatRequest });
    const app = buildServer({ store: fixture.store });
    apps.push(app);

    const cancelled = await app.inject({ method: "DELETE", url: `/api/members/${fixture.targetMemberId}/interest`, headers: { cookie: fixture.requester.cookie } });
    const accepted = await app.inject({ method: "POST", url: `/api/chat-requests/${fixture.request.id}/accept`, headers: { cookie: fixture.recipient.cookie } });

    expect(cancelled.statusCode).toBe(204);
    expect(persistInterest).toHaveBeenCalledWith(expect.objectContaining({ status: "removed" }));
    expect(accepted.statusCode).toBe(409);
    expect(accepted.json().error.code).toBe("INTEREST_REQUIRED");
    expect(fixture.store.chatRequests.get(fixture.request.id)?.status).toBe("pending");
    expect(persistAcceptedChatRequest).not.toHaveBeenCalled();
    expect(fixture.store.conversations.size).toBe(0);
  });

  it("内容快照写入串行化，失败回滚不会覆盖后续成功请求", async () => {
    const contentService = new ContentActivityService({ now: () => Date.parse(NOW), createId: (prefix) => `${prefix}-1` });
    const admin = { userId: "admin-content", role: "admin" as const };
    const content = contentService.createDraft(admin, { type: "article", title: "相处建议", summary: "摘要", body: "正文" });
    contentService.publish(admin, content.id);
    const firstPersist = deferred<void>();
    const persistContentActivityState = vi.fn()
      .mockImplementationOnce(() => firstPersist.promise)
      .mockResolvedValue(undefined);
    const store = createMemoryStore([]);
    store.persistence = persistence({ persistContentActivityState });
    const firstUser = authenticate(store, { id: "content-user-1", phone: "13800138201" });
    const secondUser = authenticate(store, { id: "content-user-2", phone: "13800138202" });
    const app = buildServer({ store, contentService });
    apps.push(app);

    const first = app.inject({ method: "POST", url: `/api/content/${content.id}/like`, headers: { cookie: firstUser.cookie } });
    await vi.waitFor(() => expect(persistContentActivityState).toHaveBeenCalledTimes(1));
    const second = app.inject({ method: "POST", url: `/api/content/${content.id}/like`, headers: { cookie: secondUser.cookie } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(persistContentActivityState).toHaveBeenCalledTimes(1);
    firstPersist.reject(new Error("database unavailable"));

    expect((await first).statusCode).toBe(500);
    expect((await second).statusCode).toBe(200);
    expect(contentService.exportState().likes).toEqual([{ contentId: content.id, userIds: [secondUser.user.id] }]);
  });

  it("AI 知识快照写入串行化，失败回滚不会覆盖后续成功请求", async () => {
    const avatarKnowledgeService = new InMemoryAvatarKnowledgeService();
    const firstPersist = deferred<void>();
    const persistAvatarKnowledgeState = vi.fn()
      .mockImplementationOnce(() => firstPersist.promise)
      .mockResolvedValue(undefined);
    const store = createMemoryStore([]);
    store.persistence = persistence({ persistAvatarKnowledgeState });
    const owner = authenticate(store, { id: "knowledge-owner", phone: "13800138301" });
    store.profiles.set(owner.user.id, approvedProfile(owner.user.id));
    const app = buildServer({ store, avatarKnowledgeService });
    apps.push(app);

    const first = app.inject({ method: "POST", url: "/api/me/avatar-knowledge", headers: { cookie: owner.cookie }, payload: { title: "第一条", topic: "生活", content: "第一条内容" } });
    await vi.waitFor(() => expect(persistAvatarKnowledgeState).toHaveBeenCalledTimes(1));
    const second = app.inject({ method: "POST", url: "/api/me/avatar-knowledge", headers: { cookie: owner.cookie }, payload: { title: "第二条", topic: "关系", content: "第二条内容" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(persistAvatarKnowledgeState).toHaveBeenCalledTimes(1);
    firstPersist.reject(new Error("database unavailable"));

    expect((await first).statusCode).toBe(500);
    expect((await second).statusCode).toBe(201);
    expect(avatarKnowledgeService.exportState().items.map((item) => item.title)).toEqual(["第二条"]);
  });

  it("到期注销清除内容活动与 AI 知识快照，后续持久化不会复活数据", async () => {
    const deletedUserId = "00000000-0000-4000-8000-000000000301";
    const survivorId = "00000000-0000-4000-8000-000000000302";
    const contentService = new ContentActivityService();
    const contentState: ContentActivityState = {
      content: [{ id: "content-cleanup", type: "event", status: "published", title: "线下活动", summary: "摘要", body: "正文", tags: [], coverImageUrl: null, authorId: survivorId, likeCount: 1, registrationCount: 1, event: { startsAt: Date.now() + 60_000, endsAt: Date.now() + 120_000, location: "上海", capacity: 10, remainingCapacity: 9 }, createdAt: Date.now(), updatedAt: Date.now(), publishedAt: Date.now(), offlineAt: null }],
      likes: [{ contentId: "content-cleanup", userIds: [deletedUserId] }],
      registrations: [{ id: "registration-cleanup", contentId: "content-cleanup", userId: deletedUserId, status: "registered", registeredAt: Date.now(), cancelledAt: null, updatedAt: Date.now() }],
    };
    contentService.restoreState(contentState);
    const avatarKnowledgeService = new InMemoryAvatarKnowledgeService();
    const knowledgeState: AvatarKnowledgeState = {
      items: [{ id: "knowledge-cleanup", ownerId: deletedUserId, title: "隐私", content: "应删除", topic: "家庭", keywords: [], status: "allowed", moderationReason: null, revision: 1, createdAt: Date.now(), updatedAt: Date.now() }],
      versions: [{ id: "version-cleanup", ownerId: deletedUserId, versionNumber: 1, status: "active", note: null, items: [], createdAt: Date.now(), activatedAt: Date.now() }],
      currentVersions: [{ ownerId: deletedUserId, versionId: "version-cleanup" }],
      callLogs: [{ id: "call-cleanup", ownerId: deletedUserId, versionId: "version-cleanup", model: "test", status: "succeeded", latencyMs: 1, inputTokens: 1, outputTokens: 1, errorCode: null, createdAt: Date.now() }],
    };
    avatarKnowledgeService.restoreState(knowledgeState);
    const persistedContent: ContentActivityState[] = [];
    const persistedKnowledge: AvatarKnowledgeState[] = [];
    const store = createMemoryStore([]);
    store.persistence = persistence({
      deleteAccountPrivateData: vi.fn().mockResolvedValue(undefined),
      persistContentActivityState: vi.fn(async (state) => { persistedContent.push(structuredClone(state)); }),
      persistAvatarKnowledgeState: vi.fn(async (state) => { persistedKnowledge.push(structuredClone(state)); }),
    });
    const expired = authenticate(store, { id: deletedUserId, phone: "13800138301", status: "suspended", suspensionSource: "self", deletionScheduledAt: new Date(Date.now() - 1).toISOString() });
    authenticate(store, { id: survivorId, phone: "13800138302" });

    const removed = await cleanupExpiredAccount({
      store,
      user: expired.user,
      currentTime: Date.now(),
      removeContentActivity: async (userId) => {
        contentService.removeUserActivity(userId);
        await store.persistence?.persistContentActivityState(contentService.exportState());
      },
      removeAvatarKnowledge: async (userId) => {
        avatarKnowledgeService.removeOwnerData(userId);
        await store.persistence?.persistAvatarKnowledgeState(avatarKnowledgeService.exportState());
      },
    });

    expect(removed).toBe(true);
    expect(contentService.exportState().likes).toEqual([]);
    expect(contentService.exportState().registrations).toEqual([]);
    expect(avatarKnowledgeService.exportState()).toEqual({ items: [], versions: [], currentVersions: [], callLogs: [] });
    expect(persistedContent.at(-1)?.likes).toEqual([]);
    expect(persistedKnowledge.at(-1)?.items).toEqual([]);
  });

  it("真人消息、回执和通知只通过一个原子持久化接口提交", async () => {
    const store = createMemoryStore([]);
    const persistHumanMessageBundle = vi.fn().mockRejectedValue(new Error("transaction failed"));
    const persistMessage = vi.fn();
    const persistMessageReceipt = vi.fn();
    const persistNotification = vi.fn();
    store.persistence = persistence({ persistMessage, persistMessageReceipt, persistNotification, persistHumanMessageBundle } as Partial<StorePersistence> & Record<string, unknown>);
    const sender = authenticate(store, { id: "message-sender", phone: "13800138401" });
    const recipient = authenticate(store, { id: "message-recipient", phone: "13800138402" });
    store.conversations.set("conversation-atomic-message", { id: "conversation-atomic-message", chatRequestId: "", participantIds: [sender.user.id, recipient.user.id], status: "active", createdAt: NOW });
    const app = buildServer({ store });
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/conversations/conversation-atomic-message/messages", headers: { cookie: sender.cookie }, payload: { text: "你好，很高兴认识你。", clientMessageId: "atomic-message-1" } });

    expect(response.statusCode).toBe(500);
    expect(persistHumanMessageBundle).toHaveBeenCalledOnce();
    expect(persistMessage).not.toHaveBeenCalled();
    expect(persistMessageReceipt).not.toHaveBeenCalled();
    expect(persistNotification).not.toHaveBeenCalled();
    expect(store.messages.size).toBe(0);
    expect(store.messageReceipts.size).toBe(0);
    expect(store.notifications.size).toBe(0);
  });

  it("草稿持久化失败时不写入内存", async () => {
    const store = createMemoryStore([]);
    store.persistence = persistence({ persistOnboardingDraft: vi.fn().mockRejectedValue(new Error("database unavailable")) });
    const current = authenticate(store, { id: "draft-user", phone: "13800138501" });
    const app = buildServer({ store });
    apps.push(app);

    const response = await app.inject({ method: "PUT", url: "/api/me/onboarding-draft", headers: { cookie: current.cookie }, payload: { currentStep: 2, data: { nickname: "草稿" } } });

    expect(response.statusCode).toBe(500);
    expect(store.onboardingDrafts.has(current.user.id)).toBe(false);
  });

  it("主动停用持久化失败时恢复账号和会话", async () => {
    const store = createMemoryStore([]);
    store.persistence = persistence({ suspendUserAndDeleteSessions: vi.fn().mockRejectedValue(new Error("database unavailable")) });
    const current = authenticate(store, { id: "suspend-user", phone: "13800138502" });
    const app = buildServer({ store });
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/me/account/suspend", headers: { cookie: current.cookie }, payload: { reason: "暂时停用" } });

    expect(response.statusCode).toBe(500);
    expect(store.users.get(current.user.id)?.status).toBe("active");
    expect(store.users.get(current.user.id)?.suspensionSource).toBeUndefined();
    expect([...store.sessions.values()].some((session) => session.userId === current.user.id)).toBe(true);
  });

  it.each([
    ["profile", "/api/admin/profiles/review-user/approve", () => ({
      profileStatus: "pending_review",
      reviewReason: null,
    })],
    ["photo", "/api/admin/photos/review-photo/approve", () => ({
      reviewStatus: "pending",
      reviewReason: null,
    })],
  ] as const)("%s 审核持久化失败时恢复原状态", async (kind, url, expected) => {
    const store = createMemoryStore([]);
    store.persistence = persistence({
      persistProfile: vi.fn().mockRejectedValue(new Error("database unavailable")),
      persistPhoto: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    const admin = authenticate(store, { id: "review-admin", phone: "13800138503", role: "admin" });
    authenticate(store, { id: "review-user", phone: "13800138504" });
    store.profiles.set("review-user", approvedProfile("review-user", { profileStatus: "pending_review" }));
    store.photos.set("review-photo", approvedPhoto("review-user", { id: "review-photo", reviewStatus: "pending" }));
    const app = buildServer({ store });
    apps.push(app);

    const response = await app.inject({ method: "POST", url, headers: { cookie: admin.cookie } });

    expect(response.statusCode).toBe(500);
    const value = kind === "profile" ? store.profiles.get("review-user") : store.photos.get("review-photo");
    expect(value).toMatchObject(expected());
  });
});

function storeInterest(fixture: ReturnType<typeof readyChatFixture>) {
  return fixture.store.interests.get(`${fixture.requester.user.id}:${fixture.targetMemberId}`)!;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
