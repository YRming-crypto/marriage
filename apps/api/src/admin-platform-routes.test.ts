import type { ApiErrorCode } from "@ai-marriage/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";
import type { Store, StorePersistence, StoredUser } from "./store/types.js";

const adminApiErrorCodes = [
  "ACCOUNT_NOT_FOUND",
  "ACCOUNT_OPERATION_NOT_ALLOWED",
  "REASON_INVALID",
  "APPEAL_NOT_FOUND",
  "APPEAL_DECISION_INVALID",
  "APPEAL_RESOLUTION_INVALID",
  "APPEAL_ALREADY_REVIEWED",
  "REPORT_EVIDENCE_INVALID",
] as const satisfies readonly ApiErrorCode[];

describe("管理员平台能力", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];
  afterEach(async () => { await Promise.all(apps.map((app) => app.close())); apps.length = 0; });

  function addAuthenticatedUser(
    store: Store,
    id: string,
    role: StoredUser["role"] = "user",
    status: StoredUser["status"] = "active",
    suspensionSource: StoredUser["suspensionSource"] = null,
  ) {
    const now = new Date().toISOString();
    const phone = id === "admin" ? "13900139999" : `138${String(store.users.size + 1).padStart(8, "0")}`;
    store.users.set(id, { id, phone, role, status, suspensionSource, createdAt: now });
    store.usersByPhone.set(phone, id);
    store.sessions.set(`token-${id}`, { id: `session-${id}`, userId: id, expiresAt: Date.now() + 60_000, userAgent: "test", createdAt: now, lastUsedAt: now });
    return { cookie: `refresh_token=token-${id}`, userId: id };
  }

  function persistence(overrides: Partial<StorePersistence> = {}) {
    return new Proxy({
      hydrate: vi.fn().mockResolvedValue(undefined),
      loadContentActivityState: vi.fn().mockResolvedValue(undefined),
      loadAvatarKnowledgeState: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    }, {
      get(target, property) {
        return Reflect.get(target, property) ?? vi.fn().mockResolvedValue(undefined);
      },
    }) as StorePersistence;
  }

  async function login(app: ReturnType<typeof buildServer>, phone: string) {
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
    const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone, code: "123456" } });
    return {
      cookie: `refresh_token=${response.cookies.find((item) => item.name === "refresh_token")?.value}`,
      userId: response.json().data.user.id as string,
    };
  }

  it("管理员可以管理账号和申诉，并读取完整内容与脱敏审计记录", async () => {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456", adminPhones: ["13900139999"] });
    apps.push(app);
    const admin = await login(app, "13900139999");
    const member = await login(app, "13800138000");
    store.accountAppeals.set("appeal-1", { id: "appeal-1", userId: member.userId, reason: "希望人工复核账号", evidence: ["已经补充资料"], status: "pending", resolution: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    expect((await app.inject({ method: "GET", url: "/api/admin/accounts", headers: { cookie: member.cookie } })).statusCode).toBe(403);
    const accounts = await app.inject({ method: "GET", url: "/api/admin/accounts", headers: { cookie: admin.cookie } });
    const suspended = await app.inject({ method: "POST", url: `/api/admin/accounts/${member.userId}/suspend`, headers: { cookie: admin.cookie }, payload: { reason: "需要人工复核资料" } });
    const restored = await app.inject({ method: "POST", url: `/api/admin/accounts/${member.userId}/restore`, headers: { cookie: admin.cookie }, payload: { reason: "人工复核已经通过" } });
    const reviewed = await app.inject({ method: "POST", url: "/api/admin/appeals/appeal-1/review", headers: { cookie: admin.cookie }, payload: { decision: "approved", resolution: "补充资料完整，申诉通过" } });
    const draft = await app.inject({ method: "POST", url: "/api/admin/content", headers: { cookie: admin.cookie }, payload: { type: "article", title: "关系课堂", summary: "认真沟通的方法", body: "先听清对方的想法，再表达自己的感受。" } });
    const allContent = await app.inject({ method: "GET", url: "/api/admin/content", headers: { cookie: admin.cookie } });
    const audit = await app.inject({ method: "GET", url: "/api/admin/audit-logs", headers: { cookie: admin.cookie } });

    expect(accounts.json().data.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: member.userId, phoneMasked: "138****8000" })]));
    expect(suspended.json().data.user.status).toBe("suspended");
    expect(restored.json().data.user.status).toBe("active");
    expect(reviewed.json().data.appeal).toMatchObject({ status: "approved", resolution: "补充资料完整，申诉通过" });
    expect(allContent.json().data.items).toEqual([expect.objectContaining({ id: draft.json().data.content.id, status: "draft" })]);
    expect(audit.json().data.items.map((item: { action: string }) => item.action)).toEqual(expect.arrayContaining(["account.suspended", "account.restored", "appeal.approved", "content.created"]));
    expect(JSON.stringify(audit.json())).not.toContain("13800138000");
  });

  it("管理员停用账号后旧会话只能识别受限状态且不能访问普通业务", async () => {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456", adminPhones: ["13900139999"] });
    apps.push(app);
    const admin = await login(app, "13900139999");
    const member = await login(app, "13800138000");

    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: member.cookie } })).json().data.user.status).toBe("active");

    const suspended = await app.inject({
      method: "POST",
      url: `/api/admin/accounts/${member.userId}/suspend`,
      headers: { cookie: admin.cookie },
      payload: { reason: "需要人工复核资料" },
    });
    const accountStatus = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: member.cookie } });
    const recommendations = await app.inject({ method: "GET", url: "/api/recommendations", headers: { cookie: member.cookie } });
    const anonymousStatus = await app.inject({ method: "GET", url: "/api/me" });

    expect(suspended.statusCode).toBe(200);
    expect([...store.sessions.values()].some((session) => session.userId === member.userId)).toBe(false);
    expect(accountStatus.statusCode).toBe(200);
    expect(accountStatus.json().data.user).toMatchObject({ id: member.userId, status: "suspended" });
    expect(recommendations.statusCode).toBe(401);
    expect(recommendations.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(anonymousStatus.statusCode).toBe(401);
    expect(anonymousStatus.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
  });

  it("管理员停用在数据库事务失败时不改变账号和会话", async () => {
    const store = createMemoryStore([]);
    const admin = addAuthenticatedUser(store, "admin", "admin");
    const target = addAuthenticatedUser(store, "suspend-transaction-target");
    const suspendUserAndDeleteSessions = vi.fn().mockRejectedValue(new Error("database unavailable"));
    store.persistence = persistence({ suspendUserAndDeleteSessions });
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);

    const response = await app.inject({ method: "POST", url: `/api/admin/accounts/${target.userId}/suspend`, headers: { cookie: admin.cookie }, payload: { reason: "需要人工复核资料" } });

    expect(response.statusCode).toBe(500);
    expect(store.users.get(target.userId)?.status).toBe("active");
    expect(store.sessions.has(`token-${target.userId}`)).toBe(true);
  });

  it("停用已持久化后即使审计失败也立即收紧旧会话", async () => {
    const store = createMemoryStore([]);
    const admin = addAuthenticatedUser(store, "admin", "admin");
    const target = addAuthenticatedUser(store, "suspend-audit-target");
    store.persistence = persistence({
      suspendUserAndDeleteSessions: vi.fn().mockResolvedValue(undefined),
      persistAdminAuditLog: vi.fn().mockRejectedValue(new Error("audit unavailable")),
    });
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);

    const response = await app.inject({ method: "POST", url: `/api/admin/accounts/${target.userId}/suspend`, headers: { cookie: admin.cookie }, payload: { reason: "需要人工复核资料" } });

    expect(response.statusCode).toBe(500);
    expect(store.users.get(target.userId)).toMatchObject({ status: "suspended", suspensionSource: "admin" });
    expect(store.sessions.has(`token-${target.userId}`)).toBe(false);
    expect(store.restrictedSessions.has(`token-${target.userId}`)).toBe(true);
  });

  it("共享错误码契约覆盖后台账号申诉与举报错误", () => {
    expect(adminApiErrorCodes).toHaveLength(8);
  });

  it("moderator 只能处理资料照片和举报，不能访问严格管理员接口", async () => {
    const store = createMemoryStore([]);
    const moderator = addAuthenticatedUser(store, "moderator", "moderator");
    const target = addAuthenticatedUser(store, "target-user");
    const now = new Date().toISOString();
    store.accountAppeals.set("appeal-1", { id: "appeal-1", userId: target.userId, reason: "申请复核", evidence: [], status: "pending", resolution: null, createdAt: now, updatedAt: now });
    store.profiles.set(target.userId, { userId: target.userId, nickname: "待审核用户", gender: "女性", birthYear: 1980, city: "上海", district: "徐汇", job: "教育", maritalStatus: "离异", goal: "认真交往", introduction: "希望认真了解彼此。", preference: {}, answers: {}, profileStatus: "pending_review", reviewReason: null, updatedAt: now });
    store.photos.set("photo-1", { id: "photo-1", userId: target.userId, filename: "photo.png", objectKey: "photos/photo.png", url: "data:image/png;base64,AAAA", mimeType: "image/png", sizeBytes: 68, isPrimary: true, reviewStatus: "pending", reviewReason: null, createdAt: now, updatedAt: now });
    store.reports.set("report-1", { id: "report-1", reporterUserId: target.userId, targetUserId: "moderator", targetAvatarSessionId: null, targetConversationId: null, targetMessageId: null, reason: "其他", description: "请核查", status: "pending", resolution: null, resolvedByUserId: null, createdAt: now, updatedAt: now });
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);

    const strictResponses = [
      await app.inject({ method: "GET", url: "/api/admin/accounts", headers: { cookie: moderator.cookie } }),
      await app.inject({ method: "POST", url: `/api/admin/accounts/${target.userId}/suspend`, headers: { cookie: moderator.cookie }, payload: { reason: "需要管理员人工复核" } }),
      await app.inject({ method: "POST", url: `/api/admin/accounts/${target.userId}/restore`, headers: { cookie: moderator.cookie }, payload: { reason: "管理员复核已经完成" } }),
      await app.inject({ method: "GET", url: "/api/admin/appeals", headers: { cookie: moderator.cookie } }),
      await app.inject({ method: "POST", url: "/api/admin/appeals/appeal-1/review", headers: { cookie: moderator.cookie }, payload: { decision: "approved", resolution: "复核通过" } }),
      await app.inject({ method: "GET", url: "/api/admin/audit-logs", headers: { cookie: moderator.cookie } }),
      await app.inject({ method: "GET", url: "/api/admin/operations", headers: { cookie: moderator.cookie } }),
      await app.inject({ method: "POST", url: "/api/admin/operations/cleanup", headers: { cookie: moderator.cookie } }),
      await app.inject({ method: "GET", url: "/api/admin/content", headers: { cookie: moderator.cookie } }),
      await app.inject({ method: "POST", url: "/api/admin/content", headers: { cookie: moderator.cookie }, payload: { type: "article", title: "管理员内容", summary: "仅管理员可创建", body: "这是只有管理员可以创建的后台内容。" } }),
      await app.inject({ method: "POST", url: "/api/admin/content/missing/publish", headers: { cookie: moderator.cookie } }),
      await app.inject({ method: "POST", url: "/api/admin/content/missing/offline", headers: { cookie: moderator.cookie } }),
    ];

    expect(strictResponses.map((response) => response.statusCode)).toEqual(Array(12).fill(403));
    expect((await app.inject({ method: "GET", url: "/api/admin/moderation", headers: { cookie: moderator.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/admin/profiles/${target.userId}/approve`, headers: { cookie: moderator.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/admin/photos/photo-1/approve", headers: { cookie: moderator.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/admin/reports", headers: { cookie: moderator.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/admin/reports/report-1/resolve", headers: { cookie: moderator.cookie }, payload: { resolution: "已完成核查" } })).statusCode).toBe(200);
  });

  it("维护任务完成后写入审计与维护记录", async () => {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456", adminPhones: ["13900139999"] });
    apps.push(app);
    const admin = await login(app, "13900139999");

    const cleanup = await app.inject({ method: "POST", url: "/api/admin/operations/cleanup", headers: { cookie: admin.cookie } });
    const audit = await app.inject({ method: "GET", url: "/api/admin/audit-logs", headers: { cookie: admin.cookie } });

    expect(cleanup.statusCode).toBe(201);
    expect(store.maintenanceRuns.size).toBe(1);
    expect(audit.json().data.items).toEqual([expect.objectContaining({ action: "maintenance.cleanup" })]);
  });

  it("管理员停用不能被 OTP 自动解除，被停用用户仍可进入申诉通道", async () => {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456", adminPhones: ["13900139999"] });
    apps.push(app);
    const admin = await login(app, "13900139999");
    const member = await login(app, "13800138000");
    await app.inject({ method: "POST", url: `/api/admin/accounts/${member.userId}/suspend`, headers: { cookie: admin.cookie }, payload: { reason: "需要人工复核账号资料" } });

    const reauthApp = buildServer({ store, otpCode: "123456", adminPhones: ["13900139999"] });
    apps.push(reauthApp);
    await reauthApp.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: "13800138000" } });
    const signedIn = await reauthApp.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13800138000", code: "123456" } });
    const restrictedCookie = `refresh_token=${signedIn.cookies.find((item) => item.name === "refresh_token")?.value}`;
    const appeal = await reauthApp.inject({ method: "POST", url: "/api/me/appeals", headers: { cookie: restrictedCookie }, payload: { reason: "希望管理员重新复核账号状态", evidence: [] } });
    const recommendations = await reauthApp.inject({ method: "GET", url: "/api/recommendations", headers: { cookie: restrictedCookie } });

    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json().data.user.status).toBe("suspended");
    expect(store.users.get(member.userId)).toMatchObject({ status: "suspended", suspensionSource: "admin" });
    expect(appeal.statusCode).toBe(201);
    expect(recommendations.statusCode).toBe(401);
  });

  it("管理员不能停用或恢复已注销账号", async () => {
    const store = createMemoryStore([]);
    const admin = addAuthenticatedUser(store, "admin", "admin");
    const deleted = addAuthenticatedUser(store, "deleted-user", "user", "deleted");
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);

    const suspended = await app.inject({ method: "POST", url: `/api/admin/accounts/${deleted.userId}/suspend`, headers: { cookie: admin.cookie }, payload: { reason: "账号已经完成注销流程" } });
    const restored = await app.inject({ method: "POST", url: `/api/admin/accounts/${deleted.userId}/restore`, headers: { cookie: admin.cookie }, payload: { reason: "尝试恢复已注销账号" } });

    expect(suspended.statusCode).toBe(409);
    expect(suspended.json()).toMatchObject({ error: { code: "ACCOUNT_DELETED" } });
    expect(restored.statusCode).toBe(409);
    expect(restored.json()).toMatchObject({ error: { code: "ACCOUNT_DELETED" } });
    expect(store.users.get(deleted.userId)).toMatchObject({ status: "deleted" });
    expect(store.adminAuditLogs.size).toBe(0);
  });

  it("管理员不能恢复其他管理员账号", async () => {
    const persistUser = vi.fn().mockResolvedValue(undefined);
    const store = createMemoryStore([]);
    store.persistence = persistence({ persistUser });
    const admin = addAuthenticatedUser(store, "admin", "admin");
    const targetAdmin = addAuthenticatedUser(store, "target-admin", "admin", "suspended", "admin");
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);

    const restored = await app.inject({
      method: "POST",
      url: `/api/admin/accounts/${targetAdmin.userId}/restore`,
      headers: { cookie: admin.cookie },
      payload: { reason: "尝试恢复其他管理员账号" },
    });

    expect(restored.statusCode).toBe(409);
    expect(restored.json()).toMatchObject({ error: { code: "ACCOUNT_OPERATION_NOT_ALLOWED" } });
    expect(store.users.get(targetAdmin.userId)).toMatchObject({ status: "suspended", suspensionSource: "admin" });
    expect(persistUser).not.toHaveBeenCalled();
    expect(store.adminAuditLogs.size).toBe(0);
  });

  it("资料照片审核和举报处理写入动作与目标明确的管理员审计", async () => {
    const persistAdminAuditLog = vi.fn().mockResolvedValue(undefined);
    const store = createMemoryStore([]);
    store.persistence = persistence({ persistAdminAuditLog });
    const admin = addAuthenticatedUser(store, "admin", "admin");
    for (const id of ["profile-approved", "profile-rejected", "photo-approved", "photo-rejected", "reporter", "reported"]) addAuthenticatedUser(store, id);
    const now = new Date().toISOString();
    for (const [userId, nickname] of [["profile-approved", "资料通过用户"], ["profile-rejected", "资料退回用户"]] as const) {
      store.profiles.set(userId, { userId, nickname, gender: "女性", birthYear: 1980, city: "上海", district: "徐汇", job: "教育", maritalStatus: "离异", goal: "认真交往", introduction: "希望认真了解彼此。", preference: {}, answers: {}, profileStatus: "pending_review", reviewReason: null, updatedAt: now });
    }
    for (const [id, userId] of [["photo-approved", "photo-approved"], ["photo-rejected", "photo-rejected"]] as const) {
      store.photos.set(id, { id, userId, filename: `${id}.png`, objectKey: `photos/${id}.png`, url: `data:image/png;base64,${id}`, mimeType: "image/png", sizeBytes: 68, isPrimary: true, reviewStatus: "pending", reviewReason: null, createdAt: now, updatedAt: now });
    }
    store.reports.set("report-1", { id: "report-1", reporterUserId: "reporter", targetUserId: "reported", targetAvatarSessionId: null, targetConversationId: null, targetMessageId: null, reason: "其他", description: "请管理员核查", status: "pending", resolution: null, resolvedByUserId: null, createdAt: now, updatedAt: now });
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);

    const responses = await Promise.all([
      app.inject({ method: "POST", url: "/api/admin/profiles/profile-approved/approve", headers: { cookie: admin.cookie } }),
      app.inject({ method: "POST", url: "/api/admin/profiles/profile-rejected/reject", headers: { cookie: admin.cookie }, payload: { reason: "请补充清楚的个人介绍" } }),
      app.inject({ method: "POST", url: "/api/admin/photos/photo-approved/approve", headers: { cookie: admin.cookie } }),
      app.inject({ method: "POST", url: "/api/admin/photos/photo-rejected/reject", headers: { cookie: admin.cookie }, payload: { reason: "照片不够清晰" } }),
      app.inject({ method: "POST", url: "/api/admin/reports/report-1/resolve", headers: { cookie: admin.cookie }, payload: { resolution: "已核查并完成处理" } }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(persistAdminAuditLog.mock.calls.map(([entry]) => ({ action: entry.action, targetType: entry.targetType, targetId: entry.targetId }))).toEqual(expect.arrayContaining([
      { action: "profile.approved", targetType: "profile", targetId: "profile-approved" },
      { action: "profile.rejected", targetType: "profile", targetId: "profile-rejected" },
      { action: "photo.approved", targetType: "photo", targetId: "photo-approved" },
      { action: "photo.rejected", targetType: "photo", targetId: "photo-rejected" },
      { action: "report.resolved", targetType: "report", targetId: "report-1" },
    ]));
    expect(store.adminAuditLogs.size).toBe(5);
  });

  it("批准管理员停用申诉时恢复账号，驳回时保持停用", async () => {
    const persistUser = vi.fn().mockResolvedValue(undefined);
    const store = createMemoryStore([]);
    store.persistence = persistence({ persistUser });
    const admin = addAuthenticatedUser(store, "admin", "admin");
    const approvedUser = addAuthenticatedUser(store, "approved-user", "user", "suspended", "admin");
    const rejectedUser = addAuthenticatedUser(store, "rejected-user", "user", "suspended", "admin");
    const now = new Date().toISOString();
    store.accountAppeals.set("approved-appeal", { id: "approved-appeal", userId: approvedUser.userId, reason: "申请复核", evidence: [], status: "pending", resolution: null, createdAt: now, updatedAt: now });
    store.accountAppeals.set("rejected-appeal", { id: "rejected-appeal", userId: rejectedUser.userId, reason: "申请复核", evidence: [], status: "pending", resolution: null, createdAt: now, updatedAt: now });
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);

    const approved = await app.inject({ method: "POST", url: "/api/admin/appeals/approved-appeal/review", headers: { cookie: admin.cookie }, payload: { decision: "approved", resolution: "复核通过，恢复账号" } });
    const rejected = await app.inject({ method: "POST", url: "/api/admin/appeals/rejected-appeal/review", headers: { cookie: admin.cookie }, payload: { decision: "rejected", resolution: "现有材料不足" } });

    expect(approved.statusCode).toBe(200);
    expect(rejected.statusCode).toBe(200);
    expect(store.users.get(approvedUser.userId)).toMatchObject({ status: "active", suspensionSource: null });
    expect(store.users.get(rejectedUser.userId)).toMatchObject({ status: "suspended", suspensionSource: "admin" });
    expect(persistUser).toHaveBeenCalledTimes(1);
    expect(persistUser).toHaveBeenCalledWith(expect.objectContaining({ id: approvedUser.userId, status: "active", suspensionSource: null }));
  });

  it("已完成申诉不可再次裁决且不会恢复后来再次停用的账号", async () => {
    const store = createMemoryStore([]);
    const admin = addAuthenticatedUser(store, "admin", "admin");
    const approvedUser = addAuthenticatedUser(store, "approved-user", "user", "suspended", "admin");
    const rejectedUser = addAuthenticatedUser(store, "rejected-user", "user", "suspended", "admin");
    const now = new Date().toISOString();
    store.accountAppeals.set("approved-appeal", { id: "approved-appeal", userId: approvedUser.userId, reason: "申请复核", evidence: [], status: "pending", resolution: null, createdAt: now, updatedAt: now });
    store.accountAppeals.set("rejected-appeal", { id: "rejected-appeal", userId: rejectedUser.userId, reason: "申请复核", evidence: [], status: "pending", resolution: null, createdAt: now, updatedAt: now });
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);

    expect((await app.inject({ method: "POST", url: "/api/admin/appeals/approved-appeal/review", headers: { cookie: admin.cookie }, payload: { decision: "approved", resolution: "首次复核通过" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/admin/accounts/${approvedUser.userId}/suspend`, headers: { cookie: admin.cookie }, payload: { reason: "出现新的账号风险需要复核" } })).statusCode).toBe(200);
    const repeatedApproval = await app.inject({ method: "POST", url: "/api/admin/appeals/approved-appeal/review", headers: { cookie: admin.cookie }, payload: { decision: "approved", resolution: "重复使用旧申诉" } });

    expect(repeatedApproval.statusCode).toBe(409);
    expect(repeatedApproval.json()).toMatchObject({ error: { code: "APPEAL_ALREADY_REVIEWED" } });
    expect(store.users.get(approvedUser.userId)).toMatchObject({ status: "suspended", suspensionSource: "admin" });
    expect(store.accountAppeals.get("approved-appeal")).toMatchObject({ status: "approved", resolution: "首次复核通过" });

    expect((await app.inject({ method: "POST", url: "/api/admin/appeals/rejected-appeal/review", headers: { cookie: admin.cookie }, payload: { decision: "rejected", resolution: "首次复核驳回" } })).statusCode).toBe(200);
    const repeatedRejection = await app.inject({ method: "POST", url: "/api/admin/appeals/rejected-appeal/review", headers: { cookie: admin.cookie }, payload: { decision: "approved", resolution: "尝试改写终态" } });
    expect(repeatedRejection.statusCode).toBe(409);
    expect(repeatedRejection.json()).toMatchObject({ error: { code: "APPEAL_ALREADY_REVIEWED" } });
    expect(store.users.get(rejectedUser.userId)).toMatchObject({ status: "suspended", suspensionSource: "admin" });
  });
});
