import type {
  AdminModeration,
  AvatarProfile,
  Block,
  CompatibilityAnalysis,
  Notification,
  Photo,
  Recommendation,
  RejectChatRequestResponse,
  Report,
  Member,
} from "@ai-marriage/shared";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  approvePhoto,
  approveProfile,
  blockUser,
  createReport,
  deletePhoto,
  enableAvatarProfile,
  generateAvatarProfile,
  getAdminModeration,
  getAdminContent,
  getAdminReports,
  getAvatarAnalysis,
  getAvatarProfile,
  getMember,
  getMyPhotos,
  getBlocks,
  getNotifications,
  getRecommendations,
  markNotificationRead,
  markAllNotificationsRead,
  logout,
  pauseAvatarProfile,
  rejectChatRequest,
  rejectPhoto,
  rejectProfile,
  resolveReport,
  revokeAvatarProfile,
  sendAvatarMessage,
  setPrimaryPhoto,
  unblockUser,
  uploadPhoto,
  verifyOtp,
} from "./client";

const jsonHeaders = { "Content-Type": "application/json" };

function apiResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: jsonHeaders });
}

function lastRequest() {
  const fetchMock = vi.mocked(fetch);
  const [input, init] = fetchMock.mock.calls.at(-1) ?? [];
  return { url: String(input), init };
}

describe("完整平台 API client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("保留验证码登录返回的账号状态并拒绝未知状态", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ user: { id: "user-1", phoneMasked: "138****8000", status: "suspended" }, profile: null }))
      .mockResolvedValueOnce(apiResponse({ user: { id: "user-1", phoneMasked: "138****8000", status: "unknown" }, profile: null }));

    await expect(verifyOtp("13800138000", "123456")).resolves.toMatchObject({ user: { status: "suspended" } });
    await expect(verifyOtp("13800138000", "123456")).rejects.toThrow();
  });

  it("接口失败时保留后端结构化错误 code 和 HTTP 状态", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      error: { code: "ANSWERS_REQUIRED", message: "请先补充 AI 问答。" },
    }), { status: 409, headers: jsonHeaders }));

    await expect(generateAvatarProfile()).rejects.toMatchObject({
      name: "ApiError",
      code: "ANSWERS_REQUIRED",
      status: 409,
      message: "请先补充 AI 问答。",
    });
  });

  it("上传并读取当前用户照片", async () => {
    const photo = { id: "photo-1", reviewStatus: "pending" } as Photo;
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ photo }, 201))
      .mockResolvedValueOnce(apiResponse({ items: [photo] }));

    const uploaded = await uploadPhoto({
      filename: "portrait.png",
      mimeType: "image/png",
      sizeBytes: 68,
      dataUrl: "data:image/png;base64,AAAA",
    });
    const uploadRequest = vi.mocked(fetch).mock.calls[0];
    expect(String(uploadRequest[0])).toBe("http://127.0.0.1:4184/api/me/photos");
    expect(uploadRequest[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ filename: "portrait.png", mimeType: "image/png", sizeBytes: 68, dataUrl: "data:image/png;base64,AAAA" }),
    });
    expect(uploaded.photo).toEqual(photo);

    const listed = await getMyPhotos();
    expect(lastRequest()).toMatchObject({ url: "http://127.0.0.1:4184/api/me/photos", init: {} });
    expect(listed.items).toEqual([photo]);
    expectTypeOf(uploaded.photo).toEqualTypeOf<Photo>();
  });

  it("设置主照片并删除照片", async () => {
    const photo = { id: "photo / 1", isPrimary: true } as Photo;
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ photo }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    expect((await setPrimaryPhoto(photo.id)).photo).toEqual(photo);
    expect(lastRequest()).toMatchObject({ url: "http://127.0.0.1:4184/api/me/photos/photo%20%2F%201/primary", init: { method: "POST" } });

    await expect(deletePhoto(photo.id)).resolves.toBeUndefined();
    expect(lastRequest()).toMatchObject({ url: "http://127.0.0.1:4184/api/me/photos/photo%20%2F%201", init: { method: "DELETE" } });
  });

  it("生成、读取并启用 AI 分身档案", async () => {
    const avatarProfile = { userId: "user-1", status: "pending" } as AvatarProfile;
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ avatarProfile }, 201))
      .mockResolvedValueOnce(apiResponse({ avatarProfile }))
      .mockResolvedValueOnce(apiResponse({ avatarProfile: { ...avatarProfile, status: "enabled" } }));

    expect((await generateAvatarProfile()).avatarProfile).toEqual(avatarProfile);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).has("Content-Type")).toBe(false);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("http://127.0.0.1:4184/api/me/avatar-profile/generate");

    expect((await getAvatarProfile()).avatarProfile).toEqual(avatarProfile);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe("http://127.0.0.1:4184/api/me/avatar-profile");

    const enabled = await enableAvatarProfile();
    expect(lastRequest()).toMatchObject({ url: "http://127.0.0.1:4184/api/me/avatar-profile/enable", init: { method: "POST" } });
    expect(enabled.avatarProfile.status).toBe("enabled");
    expectTypeOf(enabled.avatarProfile).toEqualTypeOf<AvatarProfile>();
  });

  it("暂停并撤销 AI 分身档案", async () => {
    const avatarProfile = { userId: "user-1", status: "paused" } as AvatarProfile;
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ avatarProfile }))
      .mockResolvedValueOnce(apiResponse({ avatarProfile: { ...avatarProfile, status: "revoked" } }));

    expect((await pauseAvatarProfile()).avatarProfile.status).toBe("paused");
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("http://127.0.0.1:4184/api/me/avatar-profile/pause");
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ method: "POST" });

    expect((await revokeAvatarProfile()).avatarProfile.status).toBe("revoked");
    expect(lastRequest()).toMatchObject({ url: "http://127.0.0.1:4184/api/me/avatar-profile/revoke", init: { method: "POST" } });
  });

  it("读取推荐和 AI 会话兼容度分析", async () => {
    const recommendation = { score: 90, reasons: ["同城"], member: { id: "member-1" } } as Recommendation;
    const analysis = { readiness: "ready", canRequestChat: true } as CompatibilityAnalysis;
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ items: [recommendation] }))
      .mockResolvedValueOnce(apiResponse({ analysis }));

    const recommendations = await getRecommendations();
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("http://127.0.0.1:4184/api/recommendations");
    expect(recommendations.items).toEqual([recommendation]);

    const result = await getAvatarAnalysis("session / 1");
    expect(lastRequest().url).toBe("http://127.0.0.1:4184/api/avatar-sessions/session%20%2F%201/analysis");
    expect(result.analysis).toEqual(analysis);
    expectTypeOf(result.analysis).toEqualTypeOf<CompatibilityAnalysis>();
  });

  it("AI 回复已进入恢复队列时返回明确提示而不是伪装发送成功", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({
      message: { id: "user-message-1", sessionId: "session-1", sender: "user", text: "周末怎么安排？" },
      failureTask: { id: "failure-1", status: "pending" },
    }, 202));

    await expect(sendAvatarMessage("session-1", "周末怎么安排？", "client-1")).rejects.toMatchObject({
      name: "ApiError",
      code: "AVATAR_REPLY_RECOVERY_PENDING",
      status: 202,
      message: "这条问题已进入恢复队列，请稍后刷新查看回复。",
    });
  });

  it("读取单个会员并保留聊天拒绝契约", async () => {
    const member = { id: "member / 1", nickname: "测试会员" } as Recommendation["member"];
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ member }));

    const result = await getMember(member.id);
    expect(lastRequest().url).toBe("http://127.0.0.1:4184/api/members/member%20%2F%201");
    expect(result.member).toEqual(member);
    expectTypeOf<RejectChatRequestResponse["request"]["status"]>().toEqualTypeOf<"rejected">();
    expectTypeOf<Member["userId"]>().toEqualTypeOf<string | undefined>();
  });

  it("拒绝真人聊天申请", async () => {
    const request = { id: "request / 1", status: "rejected" } as RejectChatRequestResponse["request"];
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ request }));

    const result = await rejectChatRequest(request.id);
    expect(result.request.status).toBe("rejected");
    expect(lastRequest()).toMatchObject({ url: "http://127.0.0.1:4184/api/chat-requests/request%20%2F%201/reject", init: { method: "POST" } });
  });

  it("读取通知并标记已读", async () => {
    const notification = { id: "notice / 1", readAt: null } as Notification;
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ items: [notification], unreadCount: 1 }))
      .mockResolvedValueOnce(apiResponse({ notification: { ...notification, readAt: "2026-08-13T10:00:00.000Z" } }));

    const notices = await getNotifications();
    expect(notices).toMatchObject({ items: [notification], unreadCount: 1 });
    expectTypeOf(notices.items).toEqualTypeOf<Notification[]>();

    const read = await markNotificationRead(notification.id);
    expect(lastRequest()).toMatchObject({
      url: "http://127.0.0.1:4184/api/notifications/notice%20%2F%201/read",
      init: { method: "POST" },
    });
    expect(read.notification.readAt).not.toBeNull();
  });

  it("标记全部通知已读", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ unreadCount: 0 }));

    await expect(markAllNotificationsRead()).resolves.toEqual({ unreadCount: 0 });
    expect(lastRequest()).toMatchObject({ url: "http://127.0.0.1:4184/api/notifications/read-all", init: { method: "POST" } });
  });

  it("注销当前会话并接受无正文响应", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(logout()).resolves.toBeUndefined();
    expect(lastRequest()).toMatchObject({
      url: "http://127.0.0.1:4184/api/auth/logout",
      init: { method: "POST" },
    });
    expect(new Headers(lastRequest().init?.headers).has("Content-Type")).toBe(false);
  });

  it("提交举报并屏蔽用户", async () => {
    const report = { id: "report-1", status: "pending" } as Report;
    const block = { id: "block-1", blockedUserId: "user / 2" } as Block;
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ report }, 201))
      .mockResolvedValueOnce(apiResponse({ block }, 201));

    const created = await createReport({ targetUserId: "user-2", reason: "其他", description: "需要管理员查看。" });
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ targetUserId: "user-2", reason: "其他", description: "需要管理员查看。" }),
    });
    expect(created.report).toEqual(report);

    const blocked = await blockUser("user / 2");
    expect(lastRequest()).toMatchObject({ url: "http://127.0.0.1:4184/api/users/user%20%2F%202/block", init: { method: "POST" } });
    expect(blocked.block).toEqual(block);
    expectTypeOf(created.report).toEqualTypeOf<Report>();
  });

  it("读取黑名单并解除屏蔽", async () => {
    const block = { id: "block-1", blockerUserId: "user-1", blockedUserId: "user / 2", member: { id: "member-2" } } as Block & { member?: Member };
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ items: [block] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    expect((await getBlocks()).items).toEqual([block]);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("http://127.0.0.1:4184/api/me/blocks");

    await expect(unblockUser(block.blockedUserId)).resolves.toBeUndefined();
    expect(lastRequest()).toMatchObject({ url: "http://127.0.0.1:4184/api/users/user%20%2F%202/block", init: { method: "DELETE" } });
  });

  it("读取管理员审核队列并批准资料和照片", async () => {
    const moderation = { profiles: [{ userId: "user-1" }], photos: [{ id: "photo-1" }] } as AdminModeration;
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse(moderation))
      .mockResolvedValueOnce(apiResponse({ profile: moderation.profiles[0], member: { id: "member-user-1" } }))
      .mockResolvedValueOnce(apiResponse({ photo: moderation.photos[0], member: null }));

    const queue = await getAdminModeration();
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("http://127.0.0.1:4184/api/admin/moderation");
    expect(queue).toEqual(moderation);

    await approveProfile("user / 1");
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe("http://127.0.0.1:4184/api/admin/profiles/user%20%2F%201/approve");
    expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({ method: "POST" });

    await approvePhoto("photo / 1");
    expect(lastRequest()).toMatchObject({ url: "http://127.0.0.1:4184/api/admin/photos/photo%20%2F%201/approve", init: { method: "POST" } });
  });

  it("管理员拒绝资料和照片时提交原因", async () => {
    const profile = { userId: "user / 1", profileStatus: "rejected" } as AdminModeration["profiles"][number];
    const photo = { id: "photo / 1", reviewStatus: "rejected", reviewReason: "照片不清晰" } as Photo;
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ profile }))
      .mockResolvedValueOnce(apiResponse({ photo }));

    expect((await rejectProfile(profile.userId, "资料需要修改")).profile).toEqual(profile);
    expect(vi.mocked(fetch).mock.calls[0]).toMatchObject([
      "http://127.0.0.1:4184/api/admin/profiles/user%20%2F%201/reject",
      { method: "POST", body: JSON.stringify({ reason: "资料需要修改" }) },
    ]);

    expect((await rejectPhoto(photo.id, "照片不清晰")).photo).toEqual(photo);
    expect(lastRequest()).toMatchObject({
      url: "http://127.0.0.1:4184/api/admin/photos/photo%20%2F%201/reject",
      init: { method: "POST", body: JSON.stringify({ reason: "照片不清晰" }) },
    });
  });

  it("读取并处理管理员举报队列", async () => {
    const report = { id: "report / 1", status: "pending" } as Report;
    vi.mocked(fetch)
      .mockResolvedValueOnce(apiResponse({ items: [report] }))
      .mockResolvedValueOnce(apiResponse({ report: { ...report, status: "resolved", resolution: "已处理" } }));

    const reports = await getAdminReports();
    expect(reports.items).toEqual([report]);

    const resolved = await resolveReport(report.id, "已处理");
    expect(lastRequest()).toMatchObject({
      url: "http://127.0.0.1:4184/api/admin/reports/report%20%2F%201/resolve",
      init: { method: "POST", body: JSON.stringify({ resolution: "已处理" }) },
    });
    expect(resolved.report.status).toBe("resolved");
  });

  it("通过管理员内容接口读取包含草稿和下线状态的完整内容库", async () => {
    const items = [
      { id: "draft-1", status: "draft", title: "待发布文章" },
      { id: "offline-1", status: "offline", title: "已下线活动" },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(apiResponse({ items }));

    await expect(getAdminContent()).resolves.toEqual({ items });
    expect(lastRequest()).toMatchObject({
      url: "http://127.0.0.1:4184/api/admin/content",
      init: {},
    });
  });
});
