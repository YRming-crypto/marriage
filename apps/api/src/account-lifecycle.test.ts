import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { ContentActivityService } from "./content/index.js";
import { createMemoryStore } from "./store/index.js";

describe("账号建档与生命周期", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  function createApp() {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);
    return { app, store };
  }

  async function login(app: ReturnType<typeof buildServer>, phone = "13800138000", userAgent = "Chrome on Windows") {
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
    const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", headers: { "user-agent": userAgent }, payload: { phone, code: "123456" } });
    const cookie = response.cookies.find((item) => item.name === "refresh_token");
    expect(cookie?.value).toBeTruthy();
    return { cookie: `${cookie?.name}=${cookie?.value}`, user: response.json().data.user };
  }

  it("保存并恢复跨设备建档草稿", async () => {
    const { app } = createApp();
    const { cookie } = await login(app);
    const saved = await app.inject({
      method: "PUT",
      url: "/api/me/onboarding-draft",
      headers: { cookie },
      payload: { currentStep: 3, data: { nickname: "李先生", answers: { question1: "认真沟通" } } },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.draft).toMatchObject({ currentStep: 3, data: { nickname: "李先生" } });

    const restored = await app.inject({ method: "GET", url: "/api/me/onboarding-draft", headers: { cookie } });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data.draft).toMatchObject({ currentStep: 3, status: "in_progress", data: { answers: { question1: "认真沟通" } } });
  });

  it("已审核资料可隐藏并重新公开", async () => {
    const { app, store } = createApp();
    const { cookie, user } = await login(app);
    store.profiles.set(user.id, {
      userId: user.id, nickname: "公开用户", gender: "男性", birthYear: 1978, city: "上海", district: "徐汇", job: "教育",
      maritalStatus: "未婚", goal: "认真交往", introduction: "认真认识彼此。", preference: {}, answers: {}, profileStatus: "approved", visibility: "public", updatedAt: new Date().toISOString(),
    });

    const hidden = await app.inject({ method: "PATCH", url: "/api/me/visibility", headers: { cookie }, payload: { visibility: "private" } });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().data.visibility).toBe("private");

    const visible = await app.inject({ method: "PATCH", url: "/api/me/visibility", headers: { cookie }, payload: { visibility: "public" } });
    expect(visible.statusCode).toBe(200);
    expect(visible.json().data.visibility).toBe("public");
  });

  it("仅向合适对象展示的资料不会出现在游客大厅", async () => {
    const { app, store } = createApp();
    const candidate = store.users.get("00000000-0000-4000-8000-000000000001")!;
    store.profiles.set(candidate.id, {
      userId: candidate.id, nickname: "受限展示用户", gender: "女性", birthYear: 1981, city: "上海", district: "徐汇", job: "教育",
      maritalStatus: "离异", goal: "认真交往", introduction: "只向合适对象展示。", preference: { preferredGender: "男性" }, answers: {}, profileStatus: "approved", visibility: "approved_only", updatedAt: new Date().toISOString(),
    });

    const guestMembers = await app.inject({ method: "GET", url: "/api/members" });
    const guestDetail = await app.inject({ method: "GET", url: "/api/members/lin-wanqing" });

    expect(guestMembers.json().data.items.some((item: { id: string }) => item.id === "lin-wanqing")).toBe(false);
    expect(guestDetail.statusCode).toBe(404);
  });

  it("列出设备会话并撤销指定会话和其他会话", async () => {
    const { app, store } = createApp();
    const first = await login(app, "13800138000", "Chrome on Windows");
    const secondApp = buildServer({ store, otpCode: "123456" });
    apps.push(secondApp);
    await login(secondApp, "13800138000", "Safari on iPhone");

    const listed = await app.inject({ method: "GET", url: "/api/me/sessions", headers: { cookie: first.cookie } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.items).toHaveLength(2);
    expect(listed.json().data.items.some((item: { current: boolean; userAgent: string }) => item.current && item.userAgent === "Chrome on Windows")).toBe(true);

    const other = listed.json().data.items.find((item: { current: boolean }) => !item.current);
    const revoked = await app.inject({ method: "DELETE", url: `/api/me/sessions/${other.id}`, headers: { cookie: first.cookie } });
    expect(revoked.statusCode).toBe(204);
    expect(store.sessions.size).toBe(1);

    const thirdApp = buildServer({ store, otpCode: "123456" });
    apps.push(thirdApp);
    await login(thirdApp, "13800138000", "Edge on Windows");
    const revokedOthers = await app.inject({ method: "DELETE", url: "/api/me/sessions", headers: { cookie: first.cookie } });
    expect(revokedOthers.statusCode).toBe(204);
    expect(store.sessions.size).toBe(1);
  });

  it("停用账号撤销全部会话，并可用 OTP 恢复", async () => {
    const { app, store } = createApp();
    const { cookie, user } = await login(app);
    const suspended = await app.inject({ method: "POST", url: "/api/me/account/suspend", headers: { cookie }, payload: { reason: "暂时离开" } });
    expect(suspended.statusCode).toBe(204);
    expect(store.users.get(user.id)?.status).toBe("suspended");
    expect(store.sessions.size).toBe(0);

    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: "13800138000" } });
    const restored = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13800138000", code: "123456" } });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data.user.status).toBe("active");
  });

  it("注销使用冷静期且可以取消", async () => {
    const { app, store } = createApp();
    const { cookie, user } = await login(app);
    const requested = await app.inject({ method: "POST", url: "/api/me/account/deletion-request", headers: { cookie }, payload: { confirmation: "DELETE" } });
    expect(requested.statusCode).toBe(200);
    expect(requested.json().data.scheduledAt).toBeTruthy();
    expect(store.users.get(user.id)?.deletionScheduledAt).toBeTruthy();

    const cancelled = await app.inject({ method: "DELETE", url: "/api/me/account/deletion-request", headers: { cookie } });
    expect(cancelled.statusCode).toBe(204);
    expect(store.users.get(user.id)?.deletionScheduledAt).toBeNull();
  });

  it("冷静期到期后再次验证会执行注销且不再登录", async () => {
    const { app, store } = createApp();
    const { cookie, user } = await login(app);
    const storedUser = store.users.get(user.id)!;
    storedUser.deletionRequestedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    storedUser.deletionScheduledAt = new Date(Date.now() - 1000).toISOString();
    store.profiles.set(user.id, {
      userId: user.id,
      nickname: "Private user",
      gender: "female",
      birthYear: 1980,
      city: "Shanghai",
      district: "Xuhui",
      job: "Teacher",
      maritalStatus: "divorced",
      goal: "marriage",
      introduction: "private introduction",
      preference: {},
      answers: { family: "private answer" },
      profileStatus: "approved",
      updatedAt: new Date().toISOString(),
    });
    store.photos.set("expired-login-photo", {
      id: "expired-login-photo",
      userId: user.id,
      filename: "private.jpg",
      objectKey: `users/${user.id}/private.jpg`,
      url: "/api/photos/expired-login-photo/content",
      mimeType: "image/jpeg",
      sizeBytes: 10,
      isPrimary: true,
      reviewStatus: "approved",
      reviewReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const momentObjectKey = `moments/${user.id}/private-moment.jpg`;
    const momentImageUrl = `/api/content-images/${Buffer.from(momentObjectKey, "utf8").toString("base64url")}`;
    const contentService = new ContentActivityService();
    const moment = contentService.createMemberMoment({ userId: user.id, role: "member" }, {
      body: "注销后必须删除的生活动态。",
      imageUrls: [momentImageUrl],
    });
    contentService.publish({ userId: "admin-cleanup", role: "admin" }, moment.id);
    const reauthApp = buildServer({
      store,
      otpCode: "123456",
      contentService,
      providers: {
        objectStorage: {
          upload: vi.fn(),
          read: vi.fn(),
          delete: deleteObject,
        },
      },
    });
    apps.push(reauthApp);
    await reauthApp.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: "13800138000" } });
    const response = await reauthApp.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13800138000", code: "123456" } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "ACCOUNT_DELETED" } });
    expect(store.users.get(user.id)).toMatchObject({
      phone: `deleted:${user.id}`,
      status: "deleted",
      deletionRequestedAt: null,
      deletionScheduledAt: null,
    });
    expect(store.usersByPhone.has("13800138000")).toBe(false);
    expect(store.profiles.has(user.id)).toBe(false);
    expect(store.photos.has("expired-login-photo")).toBe(false);
    expect(deleteObject).toHaveBeenCalledWith(`users/${user.id}/private.jpg`);
    expect(deleteObject).toHaveBeenCalledWith(momentObjectKey);
    expect(contentService.exportState().content).toEqual([]);

    const accountStatus = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    const recommendations = await app.inject({ method: "GET", url: "/api/recommendations", headers: { cookie } });
    expect(accountStatus.statusCode).toBe(401);
    expect(accountStatus.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(recommendations.statusCode).toBe(401);
    expect(recommendations.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
  });

  it("注销时动态图片清理失败会保留账号和动态，以便安全重试", async () => {
    const { app, store } = createApp();
    const { user } = await login(app);
    const storedUser = store.users.get(user.id)!;
    storedUser.deletionRequestedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    storedUser.deletionScheduledAt = new Date(Date.now() - 1000).toISOString();

    const objectKey = `moments/${user.id}/retry-account-delete.jpg`;
    const imageUrl = `/api/content-images/${Buffer.from(objectKey, "utf8").toString("base64url")}`;
    const contentService = new ContentActivityService();
    const moment = contentService.createMemberMoment({ userId: user.id, role: "member" }, {
      body: "注销清理失败后仍需保留的动态。",
      imageUrls: [imageUrl],
    });
    const deleteObject = vi.fn().mockRejectedValueOnce(new Error("storage unavailable")).mockResolvedValue(undefined);
    const reauthApp = buildServer({
      store,
      otpCode: "123456",
      contentService,
      providers: { objectStorage: { upload: vi.fn(), read: vi.fn(), delete: deleteObject } },
    });
    apps.push(reauthApp);
    await reauthApp.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: "13800138000" } });

    const failed = await reauthApp.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13800138000", code: "123456" } });
    expect(failed.statusCode).toBe(500);
    expect(store.users.get(user.id)).toMatchObject({ status: "active", phone: "13800138000" });
    expect(contentService.exportState().content).toEqual([expect.objectContaining({ id: moment.id, imageUrls: [imageUrl] })]);

    const retried = await reauthApp.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13800138000", code: "123456" } });
    expect(retried.statusCode).toBe(403);
    expect(retried.json()).toMatchObject({ error: { code: "ACCOUNT_DELETED" } });
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(contentService.exportState().content).toEqual([]);
  });

  it("提交申诉并生成可下载的个人数据导出", async () => {
    const { app, store } = createApp();
    const { cookie, user } = await login(app);
    const appeal = await app.inject({ method: "POST", url: "/api/me/appeals", headers: { cookie }, payload: { reason: "希望复核账号状态", evidence: ["补充说明"] } });
    expect(appeal.statusCode).toBe(201);
    expect(appeal.json().data.appeal.status).toBe("pending");
    const appeals = await app.inject({ method: "GET", url: "/api/me/appeals", headers: { cookie } });
    expect(appeals.json().data.items).toHaveLength(1);

    const matchCreatedAt = new Date().toISOString();
    store.matchSnapshots.set("export-match-snapshot", {
      id: "export-match-snapshot",
      userId: user.id,
      targetUserId: "member-target",
      algorithmVersion: "private-algorithm-version",
      score: 86,
      reasons: ["生活目标接近"],
      factors: [{ factor: "goal", label: "关系目标", score: 100, explanation: "双方目标一致" }],
      createdAt: matchCreatedAt,
    });

    const exported = await app.inject({ method: "POST", url: "/api/me/data-exports", headers: { cookie } });
    expect(exported.statusCode).toBe(201);
    expect(exported.json().data.export.status).toBe("ready");
    const downloaded = await app.inject({ method: "GET", url: `/api/me/data-exports/${exported.json().data.export.id}/download`, headers: { cookie } });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.json()).toMatchObject({ account: { status: "active" } });
    for (const key of ["avatarKnowledge", "avatarVersions", "matchSnapshots", "avatarSessions", "avatarMessages", "chatRequests", "conversations", "messages", "messageReceipts", "notifications", "reports", "blocks"]) {
      expect(downloaded.json()).toHaveProperty(key);
    }
    expect(store.dataExports.size).toBe(1);
    expect(downloaded.json().account.id).toBe(user.id);
    expect(downloaded.json().matchSnapshots).toEqual([{
      id: "export-match-snapshot",
      targetUserId: "member-target",
      score: 86,
      reasons: ["生活目标接近"],
      createdAt: matchCreatedAt,
    }]);
    expect(JSON.stringify(downloaded.json().matchSnapshots)).not.toContain("private-algorithm-version");
    expect(downloaded.json().matchSnapshots[0]).not.toHaveProperty("factors");
  });

  it("个人数据导出不包含其他用户访问本人 AI 分身或针对本人的私密记录", async () => {
    const { app, store } = createApp();
    const owner = await login(app, "13900139000");
    const visitor = await login(app, "13800138000");
    const createdAt = new Date().toISOString();
    const avatarSessionId = "privacy-avatar-session";
    store.avatarSessions.set(avatarSessionId, {
      id: avatarSessionId,
      userId: visitor.user.id,
      memberId: "lin-wanqing",
      completedTopics: [],
      status: "active",
      createdAt,
      updatedAt: createdAt,
    });
    store.avatarMessages.set("privacy-avatar-message", {
      id: "privacy-avatar-message",
      sessionId: avatarSessionId,
      sender: "user",
      text: "这是访客向 AI 分身提出的私密问题",
      topic: null,
      createdAt,
    });
    store.matchSnapshots.set("privacy-match-snapshot", {
      id: "privacy-match-snapshot",
      userId: visitor.user.id,
      targetUserId: owner.user.id,
      algorithmVersion: "private-version",
      score: 88,
      reasons: ["仅属于访客的内部判断"],
      factors: [],
      createdAt,
    });
    store.reports.set("privacy-report", {
      id: "privacy-report",
      reporterUserId: visitor.user.id,
      targetUserId: owner.user.id,
      targetAvatarSessionId: null,
      targetConversationId: null,
      targetMessageId: null,
      reason: "其他",
      description: "访客提交给平台的举报内容",
      status: "pending",
      resolution: null,
      resolvedByUserId: null,
      createdAt,
      updatedAt: createdAt,
    });
    store.blocks.set(`${visitor.user.id}:${owner.user.id}`, {
      id: "privacy-block",
      blockerUserId: visitor.user.id,
      blockedUserId: owner.user.id,
      createdAt,
    });

    const exported = await app.inject({ method: "POST", url: "/api/me/data-exports", headers: { cookie: owner.cookie } });
    const downloaded = await app.inject({ method: "GET", url: `/api/me/data-exports/${exported.json().data.export.id}/download`, headers: { cookie: owner.cookie } });
    const payload = downloaded.json();

    expect(payload.avatarSessions).toEqual([]);
    expect(payload.avatarMessages).toEqual([]);
    expect(payload.matchSnapshots).toEqual([]);
    expect(payload.reports).toEqual([]);
    expect(payload.blocks).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain("私密问题");
    expect(JSON.stringify(payload)).not.toContain("访客提交给平台的举报内容");
  });
});
