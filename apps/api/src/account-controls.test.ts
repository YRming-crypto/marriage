import { relationshipQuestions } from "@ai-marriage/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";
import type { StorePersistence } from "./store/types.js";

describe("账户控制、审核拒绝与消息闭环", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  function createApp() {
    const app = buildServer({ otpCode: "123456", store: createMemoryStore() });
    apps.push(app);
    return app;
  }

  async function login(app: ReturnType<typeof buildServer>, phone: string) {
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
    const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone, code: "123456" } });
    const cookie = response.cookies.find((item) => item.name === "refresh_token");
    expect(response.statusCode).toBe(200);
    return { cookie: `${cookie?.name}=${cookie?.value}`, user: response.json().data.user as { id: string } };
  }

  async function saveProfile(app: ReturnType<typeof buildServer>, cookie: string, nickname: string) {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: { cookie },
      payload: {
        nickname,
        gender: "女性",
        birthYear: 1978,
        city: "上海",
        district: "徐汇",
        job: "教育",
        maritalStatus: "离异",
        goal: "认真交往",
        introduction: "生活稳定，希望认真认识彼此。",
        preference: { preferredGender: "男性", relationshipGoal: "认真交往", valuedQualities: "真诚", dealBreakers: "欺骗" },
        answers: Object.fromEntries(relationshipQuestions.map((question) => [question, "认真沟通，一起商量。"])),
      },
    });
    expect(response.statusCode).toBe(200);
  }

  async function uploadPhoto(app: ReturnType<typeof buildServer>, cookie: string, filename: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/me/photos",
      headers: { cookie },
      payload: { filename, mimeType: "image/png", sizeBytes: 68, dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=" },
    });
    expect(response.statusCode).toBe(201);
    return response.json().data.photo as { id: string; isPrimary: boolean };
  }

  it("允许管理自己的照片与 AI 分身授权", async () => {
    const app = createApp();
    const user = await login(app, "13900003001");
    await saveProfile(app, user.cookie, "测试林女士");
    const first = await uploadPhoto(app, user.cookie, "first.png");
    const second = await uploadPhoto(app, user.cookie, "second.png");

    const primary = await app.inject({ method: "POST", url: `/api/me/photos/${second.id}/primary`, headers: { cookie: user.cookie } });
    expect(primary.statusCode).toBe(200);
    expect(primary.json().data.photo.isPrimary).toBe(true);
    const photosAfterPrimary = await app.inject({ method: "GET", url: "/api/me/photos", headers: { cookie: user.cookie } });
    expect(photosAfterPrimary.json().data.items.find((item: { id: string }) => item.id === first.id).isPrimary).toBe(false);

    const removed = await app.inject({ method: "DELETE", url: `/api/me/photos/${first.id}`, headers: { cookie: user.cookie } });
    expect(removed.statusCode).toBe(204);
    const photosAfterDelete = await app.inject({ method: "GET", url: "/api/me/photos", headers: { cookie: user.cookie } });
    expect(photosAfterDelete.json().data.items.map((item: { id: string }) => item.id)).toEqual([second.id]);

    await app.inject({ method: "POST", url: "/api/me/avatar-profile/generate", headers: { cookie: user.cookie } });
    await app.inject({ method: "POST", url: "/api/me/avatar-profile/enable", headers: { cookie: user.cookie } });
    const paused = await app.inject({ method: "POST", url: "/api/me/avatar-profile/pause", headers: { cookie: user.cookie } });
    expect(paused.statusCode).toBe(200);
    expect(paused.json().data.avatarProfile.status).toBe("paused");
    const revoked = await app.inject({ method: "POST", url: "/api/me/avatar-profile/revoke", headers: { cookie: user.cookie } });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().data.avatarProfile.status).toBe("revoked");
  });

  it("允许拒绝聊天申请并通知申请人", async () => {
    const app = createApp();
    const requester = await login(app, "13900003002");
    const recipient = await login(app, "13900139000");
    const avatar = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie: requester.cookie }, payload: { memberId: "lin-wanqing" } });
    const sessionId = avatar.json().data.session.id as string;
    for (const text of ["周末如何生活？", "希望怎样的关系？", "遇到分歧如何沟通？"]) {
      await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: requester.cookie }, payload: { text } });
    }
    const created = await app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie: requester.cookie }, payload: { avatarSessionId: sessionId } });
    const requestId = created.json().data.request.id as string;

    const rejected = await app.inject({ method: "POST", url: `/api/chat-requests/${requestId}/reject`, headers: { cookie: recipient.cookie } });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().data.request.status).toBe("rejected");
    const repeated = await app.inject({ method: "POST", url: `/api/chat-requests/${requestId}/accept`, headers: { cookie: recipient.cookie } });
    expect(repeated.statusCode).toBe(409);
    const notices = await app.inject({ method: "GET", url: "/api/notifications", headers: { cookie: requester.cookie } });
    expect(notices.json().data.items.some((item: { type: string }) => item.type === "chat_request_rejected")).toBe(true);
  });

  it("支持通知全部已读、查看黑名单和解除屏蔽", async () => {
    const app = createApp();
    const userA = await login(app, "13900003003");
    const userB = await login(app, "13900003004");
    const blocked = await app.inject({ method: "POST", url: `/api/users/${userB.user.id}/block`, headers: { cookie: userA.cookie } });
    expect(blocked.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: "/api/me/blocks", headers: { cookie: userA.cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.items).toHaveLength(1);
    const unblocked = await app.inject({ method: "DELETE", url: `/api/users/${userB.user.id}/block`, headers: { cookie: userA.cookie } });
    expect(unblocked.statusCode).toBe(204);
    const emptyList = await app.inject({ method: "GET", url: "/api/me/blocks", headers: { cookie: userA.cookie } });
    expect(emptyList.json().data.items).toEqual([]);

    await saveProfile(app, userA.cookie, "待审核用户");
    const admin = await login(app, "13900139999");
    const rejected = await app.inject({ method: "POST", url: `/api/admin/profiles/${userA.user.id}/reject`, headers: { cookie: admin.cookie }, payload: { reason: "请补充更清楚的自我介绍。" } });
    expect(rejected.statusCode).toBe(200);
    const markAll = await app.inject({ method: "POST", url: "/api/notifications/read-all", headers: { cookie: userA.cookie } });
    expect(markAll.statusCode).toBe(200);
    expect(markAll.json().data.unreadCount).toBe(0);
  });

  it("管理员可拒绝照片并把原因反馈给用户，普通用户不能审核", async () => {
    const app = createApp();
    const user = await login(app, "13900003005");
    const otherUser = await login(app, "13900003006");
    const admin = await login(app, "13900139999");
    const photo = await uploadPhoto(app, user.cookie, "unclear.png");

    const forbidden = await app.inject({ method: "POST", url: `/api/admin/photos/${photo.id}/reject`, headers: { cookie: otherUser.cookie }, payload: { reason: "照片不清晰" } });
    expect(forbidden.statusCode).toBe(403);
    const rejected = await app.inject({ method: "POST", url: `/api/admin/photos/${photo.id}/reject`, headers: { cookie: admin.cookie }, payload: { reason: "照片较模糊，请重新上传清晰正面照。" } });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().data.photo).toMatchObject({ reviewStatus: "rejected", reviewReason: "照片较模糊，请重新上传清晰正面照。" });
    const notices = await app.inject({ method: "GET", url: "/api/notifications", headers: { cookie: user.cookie } });
    expect(notices.json().data.items.some((item: { body: string }) => item.body.includes("照片较模糊"))).toBe(true);
  });

  it("重新提交已审核资料时撤下公开成员并暂停 AI 分身", async () => {
    const store = createMemoryStore();
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const user = await login(app, "13900003007");
    const admin = await login(app, "13900139999");
    await saveProfile(app, user.cookie, "准备修改资料的用户");
    const photo = await uploadPhoto(app, user.cookie, "portrait.png");
    await app.inject({ method: "POST", url: `/api/admin/profiles/${user.user.id}/approve`, headers: { cookie: admin.cookie } });
    await app.inject({ method: "POST", url: `/api/admin/photos/${photo.id}/approve`, headers: { cookie: admin.cookie } });
    await app.inject({ method: "POST", url: "/api/me/avatar-profile/generate", headers: { cookie: user.cookie } });
    await app.inject({ method: "POST", url: "/api/me/avatar-profile/enable", headers: { cookie: user.cookie } });
    expect(store.members.has(`member-${user.user.id}`)).toBe(true);
    expect(store.avatarProfiles.get(user.user.id)?.status).toBe("enabled");

    await saveProfile(app, user.cookie, "已修改资料的用户");

    expect(store.members.has(`member-${user.user.id}`)).toBe(false);
    expect(store.avatarProfiles.get(user.user.id)?.status).toBe("paused");
  });

  function failingPersistence(overrides: Partial<StorePersistence>) {
    const implementation: Partial<StorePersistence> = {
      hydrate: async () => undefined,
      close: async () => undefined,
      verifyOtp: async () => true,
      persistConversation: async (conversation) => conversation,
      ...overrides,
    };
    return new Proxy(implementation, {
      get(target, property) {
        return Reflect.get(target, property) ?? (async () => undefined);
      },
    }) as StorePersistence;
  }

  it("照片数据库删除失败时保留对象和内存记录", async () => {
    const store = createMemoryStore();
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    store.persistence = failingPersistence({
      deletePhoto: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    const app = buildServer({
      otpCode: "123456",
      store,
      providers: {
        objectStorage: {
          upload: vi.fn(),
          read: vi.fn(),
          delete: deleteObject,
        },
      },
    });
    apps.push(app);
    const user = await login(app, "13900003120");
    store.photos.set("photo-delete-atomic", {
      id: "photo-delete-atomic",
      userId: user.user.id,
      filename: "portrait.png",
      objectKey: "photos/portrait.png",
      url: "/api/photos/photo-delete-atomic/content",
      mimeType: "image/png",
      sizeBytes: 68,
      isPrimary: true,
      reviewStatus: "approved",
      reviewReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const response = await app.inject({ method: "DELETE", url: "/api/me/photos/photo-delete-atomic", headers: { cookie: user.cookie } });

    expect(response.statusCode).toBe(500);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(store.photos.has("photo-delete-atomic")).toBe(true);
  });

  it("屏蔽持久化失败时不污染内存中的黑名单和会话", async () => {
    const store = createMemoryStore();
    const persistence = failingPersistence({
      persistBlockState: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    store.persistence = persistence;
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const userA = await login(app, "13900003008");
    const userB = await login(app, "13900003009");
    store.conversations.set("conversation-atomic-block", { id: "conversation-atomic-block", chatRequestId: "", participantIds: [userA.user.id, userB.user.id], status: "active", createdAt: new Date().toISOString() });

    const response = await app.inject({ method: "POST", url: `/api/users/${userB.user.id}/block`, headers: { cookie: userA.cookie } });

    expect(response.statusCode).toBe(500);
    expect(store.blocks.size).toBe(0);
    expect(store.conversations.get("conversation-atomic-block")?.status).toBe("active");
  });

  it("解除屏蔽持久化失败时保留内存中的黑名单和会话状态", async () => {
    const store = createMemoryStore();
    const persistence = failingPersistence({
      deleteBlockState: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    store.persistence = persistence;
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const userA = await login(app, "13900003010");
    const userB = await login(app, "13900003011");
    const key = `${userA.user.id}:${userB.user.id}`;
    store.blocks.set(key, { id: "block-atomic-unblock", blockerUserId: userA.user.id, blockedUserId: userB.user.id, createdAt: new Date().toISOString() });
    store.conversations.set("conversation-atomic-unblock", { id: "conversation-atomic-unblock", chatRequestId: "", participantIds: [userA.user.id, userB.user.id], status: "blocked", createdAt: new Date().toISOString() });

    const response = await app.inject({ method: "DELETE", url: `/api/users/${userB.user.id}/block`, headers: { cookie: userA.cookie } });

    expect(response.statusCode).toBe(500);
    expect(store.blocks.has(key)).toBe(true);
    expect(store.conversations.get("conversation-atomic-unblock")?.status).toBe("blocked");
  });

  it.each([
    ["enable", "pending"],
    ["pause", "enabled"],
    ["revoke", "enabled"],
  ] as const)("AI 分身 %s 持久化失败时保留原授权状态", async (action, initialStatus) => {
    const store = createMemoryStore();
    const persistence = failingPersistence({
      persistAvatarProfile: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    store.persistence = persistence;
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const user = await login(app, `139000031${action === "enable" ? "01" : action === "pause" ? "02" : "03"}`);
    store.avatarProfiles.set(user.user.id, {
      userId: user.user.id,
      version: 1,
      approvedFacts: [{ topic: "生活习惯", fact: "生活规律。" }],
      relationshipExpectations: ["认真交往"],
      boundaries: ["不公开联系方式"],
      unknownResponse: "建议真人确认。",
      status: initialStatus,
      generatedAt: new Date().toISOString(),
      enabledAt: initialStatus === "enabled" ? new Date().toISOString() : null,
    });

    const response = await app.inject({ method: "POST", url: `/api/me/avatar-profile/${action}`, headers: { cookie: user.cookie } });

    expect(response.statusCode).toBe(500);
    expect(store.avatarProfiles.get(user.user.id)?.status).toBe(initialStatus);
  });

  it("接受聊天申请持久化失败时不改变申请或创建会话", async () => {
    const store = createMemoryStore();
    const persistence = failingPersistence({
      persistAcceptedChatRequest: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    store.persistence = persistence;
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);
    const requester = await login(app, "13900003104");
    const recipient = await login(app, "13900003105");
    store.members.set("member-atomic-accept", {
      id: "member-atomic-accept", demo: true, nickname: "事务测试用户", gender: "女性", age: 45, city: "上海", district: "徐汇", job: "教育", maritalStatus: "离异", goal: "认真交往", tags: ["真诚"], introduction: "用于事务失败测试。", photoUrl: "/images/member.jpg", activeLabel: "近期活跃", verified: true, ownerUserId: recipient.user.id, score: 90,
    });
    store.avatarProfiles.set(recipient.user.id, {
      userId: recipient.user.id, version: 1, approvedFacts: [], relationshipExpectations: ["认真交往"], boundaries: [], unknownResponse: "建议真人确认。", status: "enabled", generatedAt: new Date().toISOString(), enabledAt: new Date().toISOString(),
    });
    store.avatarSessions.set("avatar-session-atomic-accept", {
      id: "avatar-session-atomic-accept", userId: requester.user.id, memberId: "member-atomic-accept", completedTopics: ["life", "relationship", "communication"], status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    store.chatRequests.set("request-atomic-accept", {
      id: "request-atomic-accept",
      avatarSessionId: "avatar-session-atomic-accept",
      fromUserId: requester.user.id,
      toUserId: recipient.user.id,
      memberId: "member-atomic-accept",
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const response = await app.inject({ method: "POST", url: "/api/chat-requests/request-atomic-accept/accept", headers: { cookie: recipient.cookie } });

    expect(response.statusCode).toBe(500);
    expect(store.chatRequests.get("request-atomic-accept")?.status).toBe("pending");
    expect(store.conversations.size).toBe(0);
  });

  it("停用账号的审核资料不会在服务重启后重新公开", async () => {
    const store = createMemoryStore([]);
    const inactiveUserId = "00000000-0000-4000-8000-000000000088";
    store.persistence = failingPersistence({
      hydrate: async (target) => {
        target.users.set(inactiveUserId, { id: inactiveUserId, phone: "13900003106", role: "user", status: "suspended", createdAt: new Date().toISOString() });
        target.profiles.set(inactiveUserId, {
          userId: inactiveUserId, nickname: "已停用用户", gender: "女性", birthYear: 1978, city: "上海", district: "徐汇", job: "教育", maritalStatus: "离异", goal: "认真交往", introduction: "不应公开。", preference: {}, answers: {}, profileStatus: "approved", updatedAt: new Date().toISOString(),
        });
        target.photos.set("inactive-photo", { id: "inactive-photo", userId: inactiveUserId, filename: "photo.png", objectKey: "inactive/photo.png", url: "/api/photos/inactive-photo/content", mimeType: "image/png", sizeBytes: 68, isPrimary: true, reviewStatus: "approved", reviewReason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      },
    });
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);

    const members = await app.inject({ method: "GET", url: "/api/members" });

    expect(members.statusCode).toBe(200);
    expect(members.json().data.items).toEqual([]);
  });
});
