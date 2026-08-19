import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AvatarKnowledgeState } from "../avatar-knowledge/index.js";
import type { ContentActivityState } from "../content/index.js";
import { createHash } from "node:crypto";
import { createMemoryStore } from "./memory-store.js";
import type { StoredAdminAuditLog, StoredAvatarMessage, StoredAvatarReplyFailureTask, StoredAvatarSession, StoredChatRequest, StoredConversation, StoredInterest, StoredMaintenanceRun, StoredMatchSnapshot, StoredMessage, StoredNotification, StoredOnboardingDraft, StoredProfile, StoredUser } from "./types.js";

const prisma = vi.hoisted(() => {
  const client = {
    user: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    session: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    otpRequest: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    profile: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    onboardingDraft: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    accountAppeal: { findMany: vi.fn(), deleteMany: vi.fn() },
    dataExportJob: { findMany: vi.fn(), deleteMany: vi.fn() },
    contentItem: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    contentLike: { create: vi.fn(), deleteMany: vi.fn() },
    eventRegistration: { create: vi.fn(), deleteMany: vi.fn() },
    avatarKnowledgeItem: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    avatarProfileVersion: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    modelCallLog: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    adminAuditLog: { findMany: vi.fn(), upsert: vi.fn() },
    maintenanceRun: { findMany: vi.fn(), upsert: vi.fn() },
    photo: { findMany: vi.fn(), deleteMany: vi.fn() },
    notification: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    report: { findMany: vi.fn(), deleteMany: vi.fn() },
    block: { findMany: vi.fn(), deleteMany: vi.fn() },
    interest: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    matchSkip: { findMany: vi.fn(), deleteMany: vi.fn() },
    savedMatchFilter: { findMany: vi.fn(), deleteMany: vi.fn() },
    matchSnapshot: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    avatarConversation: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    avatarMessage: { create: vi.fn(), upsert: vi.fn() },
    avatarReplyFailureTask: { findMany: vi.fn(), upsert: vi.fn() },
    chatRequest: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    conversation: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    message: { create: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    messageReceipt: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    $disconnect: vi.fn(),
  };
  const transactionClient = {
    ...client,
    onboardingDraft: { ...client.onboardingDraft, upsert: vi.fn() },
    notification: { ...client.notification, upsert: vi.fn() },
    interest: { ...client.interest, upsert: vi.fn() },
    avatarConversation: { ...client.avatarConversation, upsert: vi.fn() },
    avatarMessage: { ...client.avatarMessage, create: vi.fn(), upsert: vi.fn() },
    avatarReplyFailureTask: { ...client.avatarReplyFailureTask, upsert: vi.fn() },
    messageReceipt: { ...client.messageReceipt, upsert: vi.fn() },
  };

  return { client, transactionClient, transaction: vi.fn() };
});

vi.mock("@prisma/client", () => ({
  DataExportStatus: {
    PENDING: "PENDING",
    READY: "READY",
    FAILED: "FAILED",
    EXPIRED: "EXPIRED",
  },
  PrismaClient: vi.fn(() => ({
    ...prisma.client,
    $transaction: prisma.transaction,
  })),
}));

const { PrismaStore } = await import("./prisma-store.js");

const operationMocks = [
  prisma.client.user.findMany,
  prisma.client.user.findUnique,
  prisma.client.user.upsert,
  prisma.client.user.update,
  prisma.client.session.create,
  prisma.client.session.findFirst,
  prisma.client.session.findMany,
  prisma.client.session.updateMany,
  prisma.client.session.deleteMany,
  prisma.client.otpRequest.create,
  prisma.client.otpRequest.findFirst,
  prisma.client.otpRequest.update,
  prisma.client.otpRequest.updateMany,
  prisma.client.otpRequest.deleteMany,
  prisma.client.profile.findMany,
  prisma.client.profile.upsert,
  prisma.client.profile.deleteMany,
  prisma.client.onboardingDraft.findMany,
  prisma.client.onboardingDraft.upsert,
  prisma.client.onboardingDraft.deleteMany,
  prisma.client.accountAppeal.findMany,
  prisma.client.accountAppeal.deleteMany,
  prisma.client.dataExportJob.findMany,
  prisma.client.dataExportJob.deleteMany,
  prisma.client.contentItem.findMany,
  prisma.client.contentItem.create,
  prisma.client.contentItem.deleteMany,
  prisma.client.contentLike.create,
  prisma.client.contentLike.deleteMany,
  prisma.client.eventRegistration.create,
  prisma.client.eventRegistration.deleteMany,
  prisma.client.avatarKnowledgeItem.findMany,
  prisma.client.avatarKnowledgeItem.create,
  prisma.client.avatarKnowledgeItem.deleteMany,
  prisma.client.avatarProfileVersion.findMany,
  prisma.client.avatarProfileVersion.create,
  prisma.client.avatarProfileVersion.deleteMany,
  prisma.client.modelCallLog.findMany,
  prisma.client.modelCallLog.create,
  prisma.client.modelCallLog.deleteMany,
  prisma.client.adminAuditLog.findMany,
  prisma.client.adminAuditLog.upsert,
  prisma.client.maintenanceRun.findMany,
  prisma.client.maintenanceRun.upsert,
  prisma.client.photo.findMany,
  prisma.client.photo.deleteMany,
  prisma.client.notification.findMany,
  prisma.client.notification.upsert,
  prisma.client.notification.deleteMany,
  prisma.client.report.findMany,
  prisma.client.report.deleteMany,
  prisma.client.block.findMany,
  prisma.client.block.deleteMany,
  prisma.client.interest.findMany,
  prisma.client.interest.upsert,
  prisma.client.interest.deleteMany,
  prisma.transactionClient.onboardingDraft.upsert,
  prisma.transactionClient.notification.upsert,
  prisma.transactionClient.interest.upsert,
  prisma.transactionClient.avatarConversation.upsert,
  prisma.client.matchSkip.findMany,
  prisma.client.matchSkip.deleteMany,
  prisma.client.savedMatchFilter.findMany,
  prisma.client.savedMatchFilter.deleteMany,
  prisma.client.matchSnapshot.findMany,
  prisma.client.matchSnapshot.create,
  prisma.client.matchSnapshot.deleteMany,
  prisma.client.avatarConversation.findMany,
  prisma.client.avatarConversation.upsert,
  prisma.client.avatarConversation.deleteMany,
  prisma.client.avatarMessage.create,
  prisma.client.avatarMessage.upsert,
  prisma.client.avatarReplyFailureTask.findMany,
  prisma.client.avatarReplyFailureTask.upsert,
  prisma.transactionClient.avatarMessage.create,
  prisma.transactionClient.avatarMessage.upsert,
  prisma.transactionClient.avatarReplyFailureTask.upsert,
  prisma.client.chatRequest.findMany,
  prisma.client.chatRequest.upsert,
  prisma.client.chatRequest.deleteMany,
  prisma.client.conversation.findMany,
  prisma.client.conversation.upsert,
  prisma.client.conversation.deleteMany,
  prisma.client.message.create,
  prisma.client.message.upsert,
  prisma.client.message.update,
  prisma.client.messageReceipt.findMany,
  prisma.client.messageReceipt.upsert,
  prisma.client.messageReceipt.deleteMany,
  prisma.transactionClient.messageReceipt.upsert,
  prisma.client.$disconnect,
  prisma.transaction,
];

const hydrateFindManyMocks = [
  prisma.client.user.findMany,
  prisma.client.profile.findMany,
  prisma.client.onboardingDraft.findMany,
  prisma.client.accountAppeal.findMany,
  prisma.client.dataExportJob.findMany,
  prisma.client.adminAuditLog.findMany,
  prisma.client.maintenanceRun.findMany,
  prisma.client.photo.findMany,
  prisma.client.notification.findMany,
  prisma.client.report.findMany,
  prisma.client.block.findMany,
  prisma.client.interest.findMany,
  prisma.client.matchSkip.findMany,
  prisma.client.savedMatchFilter.findMany,
  prisma.client.matchSnapshot.findMany,
  prisma.client.avatarConversation.findMany,
  prisma.client.avatarReplyFailureTask.findMany,
  prisma.client.chatRequest.findMany,
  prisma.client.conversation.findMany,
  prisma.client.messageReceipt.findMany,
];

function createStore() {
  return new PrismaStore("postgresql://unused", "test-encryption-key");
}

function profile(profileStatus: StoredProfile["profileStatus"]): StoredProfile {
  return {
    userId: "user-1",
    nickname: "测试用户",
    gender: "女",
    birthYear: 1978,
    city: "上海",
    district: "徐汇",
    job: "产品测试",
    maritalStatus: "未婚",
    goal: "认真交往",
    introduction: "用于验证审核状态持久化。",
    preference: {},
    answers: { relationship: "认真了解" },
    profileStatus,
    updatedAt: new Date().toISOString(),
  };
}

describe("PrismaStore account privacy deletion", () => {
  it("suspends an account and revokes its sessions in one transaction", async () => {
    const user: StoredUser = {
      id: "user-suspended",
      phone: "13800138000",
      role: "user",
      status: "suspended",
      suspensionSource: "admin",
      createdAt: "2026-08-01T00:00:00.000Z",
    };

    await createStore().suspendUserAndDeleteSessions(user);

    expect(prisma.transaction).toHaveBeenCalledOnce();
    expect(prisma.client.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: expect.objectContaining({ status: "SUSPENDED", suspensionSource: "ADMIN" }),
    });
    expect(prisma.client.session.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("anonymizes login identity and removes private account records in one transaction", async () => {
    const original: StoredUser = {
      id: "user-1",
      phone: "13800138000",
      role: "admin",
      status: "suspended",
      suspensionSource: "self",
      createdAt: "2026-08-01T00:00:00.000Z",
      deletionRequestedAt: "2026-08-07T00:00:00.000Z",
      deletionScheduledAt: "2026-08-14T00:00:00.000Z",
    };
    const deleted: StoredUser = {
      ...original,
      phone: "deleted:user-1",
      role: "user",
      status: "deleted",
      suspensionSource: null,
      deletionRequestedAt: null,
      deletionScheduledAt: null,
    };

    await createStore().deleteAccountPrivateData(original, deleted);

    expect(prisma.transaction).toHaveBeenCalledOnce();
    expect(prisma.client.user.update).toHaveBeenCalledWith({
      where: { id: original.id },
      data: expect.objectContaining({
        phoneEncrypted: null,
        phoneVerified: false,
        role: "USER",
        status: "DELETED",
        suspensionSource: null,
        deletionRequestedAt: null,
        deletionScheduledAt: null,
      }),
    });
    expect(prisma.client.otpRequest.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ userId: original.id }, { phoneHash: { in: expect.arrayContaining([expect.any(String)]) } }] },
    });
    expect(prisma.client.session.deleteMany).toHaveBeenCalledWith({ where: { userId: original.id } });
    expect(prisma.client.profile.deleteMany).toHaveBeenCalledWith({ where: { userId: original.id } });
    expect(prisma.client.onboardingDraft.deleteMany).toHaveBeenCalledWith({ where: { userId: original.id } });
    expect(prisma.client.photo.deleteMany).toHaveBeenCalledWith({ where: { userId: original.id } });
    expect(prisma.client.avatarConversation.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ userId: original.id }, { targetUserId: original.id }] },
    });
    expect(prisma.client.conversation.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ userAId: original.id }, { userBId: original.id }] },
    });
  });
});

describe("PrismaStore keyed credential hashes", () => {
  const legacyHash = (value: string) => createHash("sha256").update(value).digest("hex");

  it("writes keyed phone hashes and upgrades a legacy phone hash after lookup", async () => {
    const item: StoredUser = {
      id: "user-keyed-phone",
      phone: "13800138000",
      role: "user",
      status: "active",
      createdAt: "2026-08-14T00:00:00.000Z",
    };
    const store = createStore();
    await store.persistUser(item);
    const keyedPhoneHash = prisma.client.user.upsert.mock.calls[0][0].create.phoneHash as string;
    expect(keyedPhoneHash).toHaveLength(64);
    expect(keyedPhoneHash).not.toBe(legacyHash(item.phone));

    prisma.client.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: item.id,
        phoneEncrypted: prisma.client.user.upsert.mock.calls[0][0].create.phoneEncrypted,
        role: "USER",
        status: "ACTIVE",
        suspensionSource: null,
        createdAt: new Date(item.createdAt),
        deletionRequestedAt: null,
        deletionScheduledAt: null,
      });

    await expect(store.findUserByPhone(item.phone)).resolves.toMatchObject({ id: item.id, phone: item.phone });
    expect(prisma.client.user.findUnique.mock.calls.map(([query]) => query.where.phoneHash)).toEqual([
      keyedPhoneHash,
      legacyHash(item.phone),
    ]);
    expect(prisma.client.user.update).toHaveBeenCalledWith({
      where: { id: item.id },
      data: { phoneHash: keyedPhoneHash },
    });
  });

  it("accepts legacy OTP hashes while writing new OTP values with keyed hashes", async () => {
    const store = createStore();
    await store.persistOtpRequest({ phone: "13800138000", code: "654321", expiresAt: Date.now() + 60_000 });
    const created = prisma.client.otpRequest.create.mock.calls[0][0].data;
    expect(created.phoneHash).not.toBe(legacyHash("13800138000"));
    expect(created.codeHash).not.toBe(legacyHash("654321"));

    prisma.client.otpRequest.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "legacy-otp", codeHash: legacyHash("654321"), attempts: 0 });
    prisma.client.otpRequest.update.mockResolvedValueOnce(undefined);

    await expect(store.verifyOtp("13800138000", "654321")).resolves.toBe(true);
    expect(prisma.client.otpRequest.findFirst.mock.calls.map(([query]) => query.where.phoneHash)).toEqual([
      created.phoneHash,
      legacyHash("13800138000"),
    ]);
  });

  it("finds and revokes sessions created with the legacy token hash", async () => {
    const store = createStore();
    prisma.client.session.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: "legacy-session-user" });

    await expect(store.findUserIdBySessionToken("legacy-refresh-token")).resolves.toBe("legacy-session-user");
    await store.deleteSession("legacy-refresh-token");

    const lookupHashes = prisma.client.session.findFirst.mock.calls.map(([query]) => query.where.refreshTokenHash);
    expect(lookupHashes[0]).not.toBe(legacyHash("legacy-refresh-token"));
    expect(lookupHashes[1]).toBe(legacyHash("legacy-refresh-token"));
    expect(prisma.client.session.updateMany).toHaveBeenCalledWith({
      where: {
        refreshTokenHash: { in: [lookupHashes[0], legacyHash("legacy-refresh-token")] },
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("finds the owner only when the session was revoked by the current administrator suspension", async () => {
    const store = createStore();
    prisma.client.session.findFirst.mockResolvedValueOnce({
      userId: "restricted-user",
      revokedAt: new Date("2026-08-14T06:00:01.000Z"),
      user: {
        status: "SUSPENDED",
        suspensionSource: "ADMIN",
        updatedAt: new Date("2026-08-14T06:00:00.000Z"),
      },
    });

    await expect(store.findUserIdByRestrictedSessionToken("restricted-refresh-token")).resolves.toBe("restricted-user");

    expect(prisma.client.session.findFirst).toHaveBeenCalledWith({
      include: { user: true },
      where: {
        refreshTokenHash: expect.any(String),
        expiresAt: { gt: expect.any(Date) },
        revokedAt: { not: null },
      },
    });
  });

  it("does not revive a session that was revoked before the account was suspended", async () => {
    const store = createStore();
    prisma.client.session.findFirst
      .mockResolvedValueOnce({
        userId: "restricted-user",
        revokedAt: new Date("2026-08-13T06:00:00.000Z"),
        user: {
          status: "SUSPENDED",
          suspensionSource: "ADMIN",
          updatedAt: new Date("2026-08-14T06:00:00.000Z"),
        },
      })
      .mockResolvedValueOnce(null);

    await expect(store.findUserIdByRestrictedSessionToken("old-refresh-token")).resolves.toBeUndefined();
  });
});

beforeEach(() => {
  for (const mock of operationMocks) mock.mockReset();

  for (const mock of hydrateFindManyMocks) mock.mockResolvedValue([]);
  prisma.client.contentItem.findMany.mockResolvedValue([]);
  prisma.client.avatarKnowledgeItem.findMany.mockResolvedValue([]);
  prisma.client.avatarProfileVersion.findMany.mockResolvedValue([]);
  prisma.client.modelCallLog.findMany.mockResolvedValue([]);
  prisma.transaction.mockImplementation(async (work: unknown) => {
    if (typeof work === "function") {
      return work(prisma.transactionClient);
    }
    if (Array.isArray(work)) {
      return Promise.all(work);
    }
    throw new TypeError("Unsupported Prisma transaction mock input");
  });
});

describe("PrismaStore 资料状态持久化", () => {
  it.each([
    ["draft", "DRAFT"],
    ["pending_review", "PENDING_REVIEW"],
    ["approved", "APPROVED"],
    ["rejected", "REJECTED"],
  ] as const)("保留 %s 状态", async (profileStatus, expected) => {
    await createStore().persistProfile(profile(profileStatus));

    expect(prisma.client.profile.upsert).toHaveBeenCalledOnce();
    expect(prisma.client.profile.upsert.mock.calls[0][0].update.profileStatus).toBe(expected);
    expect(prisma.client.profile.upsert.mock.calls[0][0].create.profileStatus).toBe(expected);
  });

  it("保留先认识了解的交往目标", async () => {
    const item = profile("pending_review");
    item.goal = "先认识了解";

    await createStore().persistProfile(item);

    expect(prisma.client.profile.upsert.mock.calls[0][0].update.goal).toBe("GET_TO_KNOW");
    expect(prisma.client.profile.upsert.mock.calls[0][0].create.goal).toBe("GET_TO_KNOW");
  });
});

describe("PrismaStore 内容活动状态", () => {
  it("从关联记录恢复点赞、有效报名与活动剩余名额", async () => {
    prisma.client.contentItem.findMany.mockResolvedValueOnce([{
      id: "event-1",
      type: "EVENT",
      status: "PUBLISHED",
      title: "周末茶话会",
      summary: "轻松认识新朋友",
      body: "活动正文",
      tags: ["线下", "上海"],
      coverUrl: "/event.jpg",
      createdByUserId: "admin-1",
      eventStartsAt: new Date(1_800_000_000_000),
      eventEndsAt: new Date(1_800_007_200_000),
      location: "徐汇区",
      capacity: 2,
      createdAt: new Date(1_700_000_000_000),
      updatedAt: new Date(1_700_000_100_000),
      publishedAt: new Date(1_700_000_050_000),
      offlineAt: null,
      likes: [{ userId: "user-1" }, { userId: "user-2" }],
      registrations: [
        { id: "registration-1", contentId: "event-1", userId: "user-1", status: "REGISTERED", registeredAt: new Date(1_700_000_200_000), cancelledAt: null, updatedAt: new Date(1_700_000_200_000) },
        { id: "registration-2", contentId: "event-1", userId: "user-2", status: "CANCELLED", registeredAt: new Date(1_700_000_300_000), cancelledAt: new Date(1_700_000_400_000), updatedAt: new Date(1_700_000_400_000) },
      ],
    }]);

    const state = await createStore().loadContentActivityState();

    expect(prisma.client.contentItem.findMany).toHaveBeenCalledWith({
      include: { likes: true, registrations: true },
      orderBy: { createdAt: "asc" },
    });
    expect(state.content[0]).toEqual(expect.objectContaining({
      id: "event-1",
      type: "event",
      status: "published",
      likeCount: 2,
      registrationCount: 1,
      event: {
        startsAt: 1_800_000_000_000,
        endsAt: 1_800_007_200_000,
        location: "徐汇区",
        capacity: 2,
        remainingCapacity: 1,
      },
    }));
    expect(state.likes).toEqual([{ contentId: "event-1", userIds: ["user-1", "user-2"] }]);
    expect(state.registrations).toEqual([
      expect.objectContaining({ id: "registration-1", status: "registered", cancelledAt: null }),
      expect.objectContaining({ id: "registration-2", status: "cancelled", cancelledAt: 1_700_000_400_000 }),
    ]);
  });

  it("在一个事务内先清空旧状态，再写入内容、点赞和报名", async () => {
    const state: ContentActivityState = {
      content: [{
        id: "event-1",
        type: "event",
        status: "offline",
        title: "城市漫步",
        summary: "边走边聊",
        body: "集合后分组出发",
        tags: ["户外"],
        coverImageUrl: null,
        authorId: "admin-1",
        likeCount: 2,
        registrationCount: 1,
        event: { startsAt: 1_800_000_000_000, endsAt: 1_800_007_200_000, location: "滨江步道", capacity: 20, remainingCapacity: 19 },
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_100_000,
        publishedAt: 1_700_000_050_000,
        offlineAt: 1_700_000_150_000,
      }],
      likes: [{ contentId: "event-1", userIds: ["user-1", "user-2"] }],
      registrations: [{ id: "registration-1", contentId: "event-1", userId: "user-1", status: "cancelled", registeredAt: 1_700_000_200_000, cancelledAt: 1_700_000_300_000, updatedAt: 1_700_000_300_000 }],
    };

    await createStore().persistContentActivityState(state);

    expect(prisma.transaction).toHaveBeenCalledOnce();
    expect(prisma.client.eventRegistration.deleteMany).toHaveBeenCalledBefore(prisma.client.contentLike.deleteMany);
    expect(prisma.client.contentLike.deleteMany).toHaveBeenCalledBefore(prisma.client.contentItem.deleteMany);
    expect(prisma.client.contentItem.deleteMany).toHaveBeenCalledBefore(prisma.client.contentItem.create);
    expect(prisma.client.contentItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: "event-1",
      type: "EVENT",
      status: "OFFLINE",
      location: "滨江步道",
      eventStartsAt: new Date(1_800_000_000_000),
      eventEndsAt: new Date(1_800_007_200_000),
      capacity: 20,
      publishedAt: new Date(1_700_000_050_000),
      offlineAt: new Date(1_700_000_150_000),
    }) });
    expect(prisma.client.contentLike.create.mock.calls.map(([call]) => call.data)).toEqual([
      { contentId: "event-1", userId: "user-1" },
      { contentId: "event-1", userId: "user-2" },
    ]);
    expect(prisma.client.eventRegistration.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: "registration-1",
      status: "CANCELLED",
      registeredAt: new Date(1_700_000_200_000),
      cancelledAt: new Date(1_700_000_300_000),
      createdAt: new Date(1_700_000_200_000),
    }) });
  });
});

describe("PrismaStore AI 知识状态", () => {
  it("恢复治理状态、当前版本，并忽略缺少版本元数据的调用日志", async () => {
    prisma.client.avatarKnowledgeItem.findMany.mockResolvedValueOnce([{
      id: "knowledge-1",
      profile: { userId: "owner-1" },
      title: "家庭观念",
      content: "重视沟通",
      topic: "family",
      keywords: ["家庭", "沟通"],
      governanceStatus: "SENSITIVE",
      moderationReason: "需本人授权",
      revision: 2,
      createdAt: new Date(1_700_000_000_000),
      updatedAt: new Date(1_700_000_100_000),
    }]);
    prisma.client.avatarProfileVersion.findMany.mockResolvedValueOnce([{
      id: "version-1",
      profile: { userId: "owner-1" },
      version: 3,
      status: "STALE",
      note: "资料有更新",
      summary: { items: [{ id: "knowledge-1", authorized: true }] },
      createdAt: new Date(1_700_000_200_000),
      activatedAt: new Date(1_700_000_300_000),
    }]);
    prisma.client.modelCallLog.findMany.mockResolvedValueOnce([
      { id: "call-1", userId: "owner-1", modelName: "model-a", status: "failed", latencyMs: null, inputTokens: 10, outputTokens: null, error: "MODEL_CALL_FAILED", metadata: { versionId: "version-1" }, createdAt: new Date(1_700_000_400_000) },
      { id: "call-without-version", userId: "owner-1", modelName: "model-a", status: "succeeded", latencyMs: 8, inputTokens: 3, outputTokens: 4, error: null, metadata: {}, createdAt: new Date(1_700_000_500_000) },
    ]);

    const state = await createStore().loadAvatarKnowledgeState();

    expect(state.items).toEqual([expect.objectContaining({ ownerId: "owner-1", status: "sensitive", revision: 2 })]);
    expect(state.versions).toEqual([expect.objectContaining({ id: "version-1", ownerId: "owner-1", versionNumber: 3, status: "stale", activatedAt: 1_700_000_300_000 })]);
    expect(state.currentVersions).toEqual([{ ownerId: "owner-1", versionId: "version-1" }]);
    expect(state.callLogs).toEqual([expect.objectContaining({
      id: "call-1",
      versionId: "version-1",
      status: "failed",
      latencyMs: 0,
      outputTokens: 0,
      errorCode: "MODEL_CALL_FAILED",
    })]);
  });

  it("在一个事务内映射知识、版本和模型日志，并跳过不存在的资料归属", async () => {
    prisma.client.profile.findMany.mockResolvedValueOnce([{ id: "profile-1", userId: "owner-1" }]);
    const item = (id: string, status: "allowed" | "sensitive" | "prohibited") => ({
      id,
      ownerId: "owner-1",
      title: `${status} knowledge`,
      content: "知识内容",
      topic: "values",
      keywords: ["价值观"],
      status,
      moderationReason: status === "allowed" ? null : "治理原因",
      revision: 2,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
    });
    const versionItem = {
      id: "knowledge-allowed",
      title: "allowed knowledge",
      content: "知识内容",
      topic: "values",
      keywords: ["价值观"],
      governanceStatus: "allowed" as const,
      authorized: true,
      sourceRevision: 2,
    };
    const state: AvatarKnowledgeState = {
      items: [
        item("knowledge-allowed", "allowed"),
        item("knowledge-sensitive", "sensitive"),
        item("knowledge-prohibited", "prohibited"),
        { ...item("knowledge-orphan", "allowed"), ownerId: "owner-missing" },
      ],
      versions: [
        { id: "version-active", ownerId: "owner-1", versionNumber: 1, status: "active", note: null, items: [versionItem], createdAt: 1_700_000_200_000, activatedAt: 1_700_000_300_000 },
        { id: "version-archived", ownerId: "owner-1", versionNumber: 2, status: "archived", note: "旧版本", items: [versionItem], createdAt: 1_700_000_400_000, activatedAt: null },
        { id: "version-orphan", ownerId: "owner-missing", versionNumber: 1, status: "draft", note: null, items: [], createdAt: 1_700_000_500_000, activatedAt: null },
      ],
      currentVersions: [{ ownerId: "owner-1", versionId: "version-active" }],
      callLogs: [{ id: "call-1", ownerId: "owner-1", versionId: "version-active", model: "model-a", status: "failed", latencyMs: 230, inputTokens: 20, outputTokens: 0, errorCode: "MODEL_CALL_FAILED", createdAt: 1_700_000_600_000 }],
    };

    await createStore().persistAvatarKnowledgeState(state);

    expect(prisma.client.profile.findMany).toHaveBeenCalledWith({ select: { id: true, userId: true } });
    expect(prisma.transaction).toHaveBeenCalledOnce();
    expect(prisma.client.avatarProfileVersion.deleteMany).toHaveBeenCalledBefore(prisma.client.avatarKnowledgeItem.deleteMany);
    expect(prisma.client.avatarKnowledgeItem.deleteMany).toHaveBeenCalledBefore(prisma.client.modelCallLog.deleteMany);
    expect(prisma.client.modelCallLog.deleteMany).toHaveBeenCalledWith({ where: { provider: "avatar-knowledge" } });

    const knowledgeRows = prisma.client.avatarKnowledgeItem.create.mock.calls.map(([call]) => call.data);
    expect(knowledgeRows).toHaveLength(3);
    expect(knowledgeRows.map((row) => [row.id, row.governanceStatus, row.enabled])).toEqual([
      ["knowledge-allowed", "ALLOWED", true],
      ["knowledge-sensitive", "SENSITIVE", true],
      ["knowledge-prohibited", "PROHIBITED", false],
    ]);
    expect(knowledgeRows[0]).toEqual(expect.objectContaining({ profileId: "profile-1", source: "manual", revision: 2 }));

    const versionRows = prisma.client.avatarProfileVersion.create.mock.calls.map(([call]) => call.data);
    expect(versionRows).toHaveLength(2);
    expect(versionRows.map((row) => [row.id, row.status])).toEqual([
      ["version-active", "ACTIVE"],
      ["version-archived", "ARCHIVED"],
    ]);
    expect(versionRows[0]).toEqual(expect.objectContaining({
      profileId: "profile-1",
      summary: { items: [versionItem] },
      promptVersion: "knowledge-governance-v1",
      activatedAt: new Date(1_700_000_300_000),
    }));
    expect(prisma.client.modelCallLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: "call-1",
      userId: "owner-1",
      provider: "avatar-knowledge",
      status: "failed",
      error: "MODEL_CALL_FAILED",
      metadata: { versionId: "version-active" },
      createdAt: new Date(1_700_000_600_000),
    }) });
  });
});

describe("PrismaStore 管理审计与维护运行", () => {
  it("审计更新不覆盖创建者和创建时间，创建时保留完整上下文", async () => {
    const entry: StoredAdminAuditLog = {
      id: "audit-1",
      actorUserId: "admin-1",
      action: "content.offline",
      targetType: "content",
      targetId: "content-1",
      reason: "内容已过期",
      metadata: { source: "admin-console", nested: { approved: true } },
      createdAt: "2026-08-14T01:02:03.000Z",
    };

    await createStore().persistAdminAuditLog(entry);

    expect(prisma.client.adminAuditLog.upsert).toHaveBeenCalledWith({
      where: { id: "audit-1" },
      update: {
        action: "content.offline",
        targetType: "content",
        targetId: "content-1",
        reason: "内容已过期",
        metadata: entry.metadata,
      },
      create: {
        id: "audit-1",
        actorUserId: "admin-1",
        action: "content.offline",
        targetType: "content",
        targetId: "content-1",
        reason: "内容已过期",
        metadata: entry.metadata,
        createdAt: new Date("2026-08-14T01:02:03.000Z"),
      },
    });
  });

  it.each([
    ["running", "RUNNING", null],
    ["succeeded", "SUCCEEDED", 1_700_000_100_000],
    ["failed", "FAILED", 1_700_000_200_000],
  ] as const)("将 %s 维护状态和结果写入运行记录", async (status, expectedStatus, finishedAt) => {
    const run: StoredMaintenanceRun = {
      id: `run-${status}`,
      taskName: "cleanup-expired-data",
      actorId: "admin-1",
      status,
      startedAt: 1_700_000_000_000,
      finishedAt,
      totalRemoved: 4,
      results: [{ target: "sessions", status: expectedStatus === "FAILED" ? "failed" : "succeeded", removedCount: 4 }],
    };

    await createStore().persistMaintenanceRun(run);

    expect(prisma.client.maintenanceRun.upsert).toHaveBeenCalledWith({
      where: { id: run.id },
      update: {
        status: expectedStatus,
        result: { totalRemoved: 4, results: run.results },
        finishedAt: finishedAt === null ? null : new Date(finishedAt),
      },
      create: {
        id: run.id,
        task: "cleanup-expired-data",
        status: expectedStatus,
        triggeredBy: "admin-1",
        result: { totalRemoved: 4, results: run.results },
        startedAt: new Date(1_700_000_000_000),
        finishedAt: finishedAt === null ? null : new Date(finishedAt),
      },
    });
  });
});

describe("PrismaStore 匹配快照", () => {
  it("保存统一算法的分数、原因和因子", async () => {
    const snapshot: StoredMatchSnapshot = {
      id: "snapshot-1",
      userId: "user-1",
      targetUserId: "user-2",
      algorithmVersion: "bidirectional-rules-v1.0.0",
      score: 88,
      reasons: ["双方关系目标一致"],
      factors: [{ factor: "goal", label: "关系目标", score: 100, explanation: "目标一致" }],
      createdAt: "2026-08-14T08:00:00.000Z",
    };
    await createStore().persistMatchSnapshot(snapshot);
    expect(prisma.client.matchSnapshot.create).toHaveBeenCalledWith({ data: {
      ...snapshot,
      createdAt: new Date(snapshot.createdAt),
    } });
  });
});

describe("PrismaStore match snapshot hydration", () => {
  it("hydrates snapshots and converts persisted JSON and dates", async () => {
    prisma.client.matchSnapshot.findMany.mockResolvedValueOnce([{
      id: "snapshot-hydrated",
      userId: "user-1",
      targetUserId: "user-2",
      algorithmVersion: "bidirectional-rules-v1.0.0",
      score: 86,
      reasons: ["same relationship goal", 42, null],
      factors: [
        { factor: "goal", label: "Relationship goal", score: 100, explanation: "Goals align" },
        { label: "missing factor" },
        "invalid",
        null,
      ],
      createdAt: new Date("2026-08-14T08:00:00.000Z"),
    }]);
    const memoryStore = createMemoryStore([]);

    await createStore().hydrate(memoryStore);

    expect(prisma.client.matchSnapshot.findMany).toHaveBeenCalledOnce();
    expect(memoryStore.matchSnapshots.get("snapshot-hydrated")).toEqual({
      id: "snapshot-hydrated",
      userId: "user-1",
      targetUserId: "user-2",
      algorithmVersion: "bidirectional-rules-v1.0.0",
      score: 86,
      reasons: ["same relationship goal"],
      factors: [
        { factor: "goal", label: "Relationship goal", score: 100, explanation: "Goals align" },
      ],
      createdAt: "2026-08-14T08:00:00.000Z",
    });
  });
});

describe("PrismaStore chat request expiry", () => {
  it("hydrates EXPIRED status and expiresAt without degrading to pending", async () => {
    prisma.client.chatRequest.findMany.mockResolvedValueOnce([{
      id: "request-expired",
      requesterId: "user-a",
      targetUserId: "user-b",
      sourceAvatarConversationId: "avatar-session-1",
      status: "EXPIRED",
      expiresAt: new Date("2026-08-14T08:00:00.000Z"),
      createdAt: new Date("2026-08-07T08:00:00.000Z"),
      updatedAt: new Date("2026-08-14T08:00:00.000Z"),
    }]);
    const memoryStore = createMemoryStore([]);

    await createStore().hydrate(memoryStore);

    expect(memoryStore.chatRequests.get("request-expired")).toEqual({
      id: "request-expired",
      avatarSessionId: "avatar-session-1",
      fromUserId: "user-a",
      toUserId: "user-b",
      memberId: "member-user-b",
      status: "expired",
      expiresAt: "2026-08-14T08:00:00.000Z",
      createdAt: "2026-08-07T08:00:00.000Z",
      updatedAt: "2026-08-14T08:00:00.000Z",
    });
  });

  it("persists expired status and expiry timestamp", async () => {
    const request: StoredChatRequest = {
      id: "request-expired",
      avatarSessionId: "avatar-session-1",
      fromUserId: "user-a",
      toUserId: "user-b",
      memberId: "member-user-b",
      status: "expired",
      expiresAt: "2026-08-14T08:00:00.000Z",
      createdAt: "2026-08-07T08:00:00.000Z",
      updatedAt: "2026-08-14T08:00:00.000Z",
    };

    await createStore().persistChatRequest(request);

    expect(prisma.client.chatRequest.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: "EXPIRED", expiresAt: new Date(request.expiresAt!) }),
      create: expect.objectContaining({ status: "EXPIRED", expiresAt: new Date(request.expiresAt!) }),
    }));
  });
});

describe("PrismaStore session activity", () => {
  it("persists the latest session activity using compatible token hashes", async () => {
    await createStore().persistSessionActivity("session-token", "2026-08-14T10:00:00.000Z");

    expect(prisma.client.session.updateMany).toHaveBeenCalledWith({
      where: { refreshTokenHash: { in: expect.any(Array) }, revokedAt: null },
      data: { lastUsedAt: new Date("2026-08-14T10:00:00.000Z") },
    });
  });
});

describe("PrismaStore conversation lifecycle", () => {
  it("persists archived conversations with their archive timestamp", async () => {
    const conversation: StoredConversation = {
      id: "conversation-archived",
      chatRequestId: "request-1",
      participantIds: ["user-b", "user-a"],
      status: "archived",
      archivedAt: "2026-08-14T08:30:00.000Z",
      createdAt: "2026-08-14T08:00:00.000Z",
    };
    prisma.client.conversation.upsert.mockResolvedValueOnce({ id: conversation.id });

    await createStore().persistConversation(conversation);

    expect(prisma.client.conversation.upsert).toHaveBeenCalledWith({
      where: { userAId_userBId: { userAId: "user-a", userBId: "user-b" } },
      update: { status: "ARCHIVED", archivedAt: new Date(conversation.archivedAt!) },
      create: {
        id: conversation.id,
        chatRequestId: conversation.chatRequestId,
        userAId: "user-a",
        userBId: "user-b",
        status: "ARCHIVED",
        archivedAt: new Date(conversation.archivedAt!),
        createdAt: new Date(conversation.createdAt),
      },
    });
  });

  it("persists recalled message state without retaining plaintext", async () => {
    const message: StoredMessage = {
      id: "message-recalled",
      conversationId: "conversation-1",
      senderId: "user-a",
      text: "此消息已撤回",
      clientMessageId: "client-1",
      deletedAt: "2026-08-14T08:31:00.000Z",
      createdAt: "2026-08-14T08:30:00.000Z",
    };

    await createStore().persistMessageState(message);

    expect(prisma.client.message.update).toHaveBeenCalledWith({
      where: { id: message.id },
      data: {
        contentCiphertext: expect.any(String),
        deletedAt: new Date(message.deletedAt!),
      },
    });
    const call = prisma.client.message.update.mock.calls[0]?.[0];
    expect(call?.data.contentCiphertext).not.toContain("此消息已撤回");
  });
});

describe("PrismaStore human-message transaction", () => {
  it("persists the message, receipt, and notification in one transaction", async () => {
    const message: StoredMessage = {
      id: "message-atomic",
      conversationId: "conversation-atomic",
      senderId: "user-a",
      text: "你好，很高兴认识你。",
      clientMessageId: "client-atomic",
      createdAt: "2026-08-14T08:30:00.000Z",
    };
    const receipt = {
      id: "receipt-atomic",
      messageId: message.id,
      userId: "user-b",
      deliveredAt: null,
      readAt: null,
      createdAt: message.createdAt,
    };
    const notification: StoredNotification = {
      id: "notification-atomic",
      userId: "user-b",
      type: "new_message",
      title: "收到新消息",
      body: "你有一条新的真人聊天消息。",
      relatedResourceType: "conversation",
      relatedResourceId: message.conversationId,
      readAt: null,
      createdAt: message.createdAt,
    };
    prisma.transactionClient.message.upsert.mockResolvedValueOnce({
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      contentCiphertext: "invalid-test-ciphertext",
      clientMessageId: message.clientMessageId,
      deletedAt: null,
      createdAt: new Date(message.createdAt),
    });

    const result = await createStore().persistHumanMessageBundle(message, receipt, notification);

    expect(prisma.transaction).toHaveBeenCalledOnce();
    expect(prisma.transactionClient.message.upsert).toHaveBeenCalledOnce();
    expect(prisma.transactionClient.messageReceipt.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ messageId: message.id, userId: receipt.userId }),
    }));
    expect(prisma.transactionClient.notification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ id: notification.id, userId: notification.userId }),
    }));
    expect(result).toMatchObject({
      message: { id: message.id },
      receipt: { messageId: message.id },
      notification: { id: notification.id },
    });
    expect(prisma.client.messageReceipt.upsert).not.toHaveBeenCalled();
    expect(prisma.client.notification.upsert).not.toHaveBeenCalled();
  });
});

describe("PrismaStore pending-interest fulfillment", () => {
  it("persists the interest, draft, and UUID-backed notification in one transaction", async () => {
    const requesterUserId = "00000000-0000-4000-8000-000000000041";
    const targetUserId = "00000000-0000-4000-8000-000000000042";
    const interest: StoredInterest = {
      id: "00000000-0000-4000-8000-000000000043",
      userId: requesterUserId,
      memberId: `member-${targetUserId}`,
      status: "active",
      createdAt: "2026-08-14T08:00:00.000Z",
      updatedAt: "2026-08-14T08:00:00.000Z",
    };
    const draft: StoredOnboardingDraft = {
      userId: requesterUserId,
      currentStep: 5,
      status: "in_progress",
      data: {},
      updatedAt: "2026-08-14T08:00:00.000Z",
      completedAt: null,
    };
    const notification: StoredNotification = {
      id: "00000000-0000-4000-8000-000000000044",
      userId: requesterUserId,
      type: "system",
      title: "Interest restored",
      body: "Your pending interest is ready.",
      relatedResourceType: "member",
      relatedResourceId: targetUserId,
      readAt: null,
      createdAt: "2026-08-14T08:00:00.000Z",
    };
    const memoryStore = createMemoryStore([{
      id: interest.memberId,
      nickname: "Target",
      gender: "女",
      age: 45,
      city: "Shanghai",
      district: "Xuhui",
      job: "Education",
      maritalStatus: "离异",
      goal: "认真交往",
      tags: [],
      introduction: "Target member",
      photoUrl: "/target.png",
      activeLabel: "active",
      verified: true,
      ownerUserId: targetUserId,
    }]);
    const store = createStore();
    await store.hydrate(memoryStore);
    const persistedInterest = {
      id: "00000000-0000-4000-8000-000000000045",
      fromUserId: requesterUserId,
      toUserId: targetUserId,
      status: "ACTIVE",
      createdAt: new Date("2026-08-14T07:59:00.000Z"),
      updatedAt: new Date("2026-08-14T08:01:00.000Z"),
    };
    const persistedNotification = {
      id: persistedInterest.id,
      userId: requesterUserId,
      type: "SYSTEM",
      title: notification.title,
      body: notification.body,
      relatedResourceType: "member",
      relatedResourceId: targetUserId,
      readAt: null,
      createdAt: new Date("2026-08-14T08:01:00.000Z"),
    };
    prisma.transactionClient.interest.upsert.mockResolvedValueOnce(persistedInterest);
    prisma.transactionClient.notification.upsert.mockResolvedValueOnce(persistedNotification);

    const result = await store.persistPendingInterestFulfillment(interest, draft, notification);

    expect(prisma.transaction).toHaveBeenCalledOnce();
    expect(prisma.transactionClient.interest.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ id: interest.id, fromUserId: requesterUserId, toUserId: targetUserId }),
    }));
    expect(prisma.transactionClient.onboardingDraft.upsert).toHaveBeenCalledOnce();
    expect(prisma.transactionClient.notification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: persistedInterest.id },
      create: expect.objectContaining({ id: persistedInterest.id, relatedResourceType: "member", relatedResourceId: targetUserId }),
    }));
    expect(prisma.client.interest.upsert).not.toHaveBeenCalled();
    expect(prisma.client.onboardingDraft.upsert).not.toHaveBeenCalled();
    expect(prisma.client.notification.upsert).not.toHaveBeenCalled();
    expect(result).toEqual({
      interest: {
        id: persistedInterest.id,
        userId: requesterUserId,
        memberId: interest.memberId,
        status: "active",
        createdAt: persistedInterest.createdAt.toISOString(),
        updatedAt: persistedInterest.updatedAt.toISOString(),
      },
      notification: {
        id: persistedNotification.id,
        userId: requesterUserId,
        type: "system",
        title: notification.title,
        body: notification.body,
        relatedResourceType: "member",
        relatedResourceId: targetUserId,
        readAt: null,
        createdAt: persistedNotification.createdAt.toISOString(),
      },
    });
  });

  it("persists interest cancellation and pending-draft removal through the transaction client", async () => {
    const requesterUserId = "00000000-0000-4000-8000-000000000041";
    const targetUserId = "00000000-0000-4000-8000-000000000042";
    const removedInterest: StoredInterest = {
      id: "00000000-0000-4000-8000-000000000043",
      userId: requesterUserId,
      memberId: `member-${targetUserId}`,
      status: "removed",
      createdAt: "2026-08-14T08:00:00.000Z",
      updatedAt: "2026-08-14T09:00:00.000Z",
    };
    const clearedDraft: StoredOnboardingDraft = {
      userId: requesterUserId,
      currentStep: 5,
      status: "in_progress",
      data: {},
      updatedAt: "2026-08-14T09:00:00.000Z",
      completedAt: null,
    };
    const memoryStore = createMemoryStore([{
      id: removedInterest.memberId,
      nickname: "Target",
      gender: "女性",
      age: 45,
      city: "Shanghai",
      district: "Xuhui",
      job: "Education",
      maritalStatus: "离异",
      goal: "认真交往",
      tags: [],
      introduction: "Target member",
      photoUrl: "/target.png",
      activeLabel: "active",
      verified: true,
      ownerUserId: targetUserId,
    }]);
    const store = createStore();
    await store.hydrate(memoryStore);

    await store.persistInterestCancellation(removedInterest, clearedDraft);

    expect(prisma.transaction).toHaveBeenCalledOnce();
    expect(prisma.transactionClient.interest.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { status: "REMOVED" },
    }));
    expect(prisma.transactionClient.onboardingDraft.upsert).toHaveBeenCalledOnce();
    expect(prisma.client.interest.upsert).not.toHaveBeenCalled();
    expect(prisma.client.onboardingDraft.upsert).not.toHaveBeenCalled();
  });
});

describe("PrismaStore avatar reply failure recovery", () => {
  const task: StoredAvatarReplyFailureTask = {
    id: "00000000-0000-4000-8000-000000000071",
    sessionId: "00000000-0000-4000-8000-000000000072",
    userMessageId: "00000000-0000-4000-8000-000000000073",
    memberId: "lin-wanqing",
    status: "pending",
    attempts: 1,
    lastError: "模型服务调用失败",
    resolvedMessageId: null,
    createdAt: "2026-08-14T10:00:00.000Z",
    updatedAt: "2026-08-14T10:00:00.000Z",
    resolvedAt: null,
  };

  it("persists each avatar conversation round by its session id", async () => {
    const ownerUserId = "00000000-0000-4000-8000-000000000076";
    const memoryStore = createMemoryStore([{
      id: task.memberId,
      nickname: "Target member",
      gender: "female",
      age: 45,
      city: "Shanghai",
      district: "Xuhui",
      job: "Education",
      maritalStatus: "divorced",
      goal: "serious relationship",
      tags: [],
      introduction: "Target member",
      photoUrl: "/target.png",
      activeLabel: "active",
      verified: true,
      ownerUserId,
    }]);
    const store = createStore();
    await store.hydrate(memoryStore);
    const session: StoredAvatarSession = {
      id: task.sessionId,
      userId: "00000000-0000-4000-8000-000000000077",
      memberId: task.memberId,
      completedTopics: [],
      status: "active",
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };

    await store.persistAvatarSession(session);

    expect(prisma.client.avatarConversation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: session.id },
      create: expect.objectContaining({ id: session.id, userId: session.userId, targetUserId: ownerUserId }),
    }));
  });

  it("hydrates persisted failure tasks and converts statuses and timestamps", async () => {
    prisma.client.avatarReplyFailureTask.findMany.mockResolvedValueOnce([{
      id: task.id,
      sessionId: task.sessionId,
      userMessageId: task.userMessageId,
      memberId: task.memberId,
      status: "PENDING",
      attempts: 3,
      lastError: task.lastError,
      resolvedMessageId: null,
      createdAt: new Date(task.createdAt),
      updatedAt: new Date("2026-08-14T10:05:00.000Z"),
      resolvedAt: null,
    }]);
    const memoryStore = createMemoryStore();

    await createStore().hydrate(memoryStore);

    expect(memoryStore.avatarReplyFailureTasks.get(task.id)).toEqual({
      ...task,
      attempts: 3,
      updatedAt: "2026-08-14T10:05:00.000Z",
    });
  });

  it("persists client message ids and failure tasks without plaintext questions", async () => {
    const message: StoredAvatarMessage = {
      id: task.userMessageId,
      sessionId: task.sessionId,
      sender: "user",
      text: "周末通常怎么安排？",
      clientMessageId: "question-id-1",
      topic: "生活习惯",
      modelName: null,
      promptVersion: null,
      latencyMs: null,
      createdAt: task.createdAt,
    };

    await createStore().persistAvatarMessages([message]);
    await createStore().persistAvatarReplyFailureTask(task);

    const messageData = prisma.client.avatarMessage.create.mock.calls[0]?.[0].data;
    expect(messageData).toMatchObject({
      id: message.id,
      conversationId: message.sessionId,
      senderType: "USER",
      clientMessageId: "question-id-1",
    });
    expect(messageData.contentCiphertext).not.toContain(message.text);
    expect(prisma.client.avatarReplyFailureTask.upsert).toHaveBeenCalledWith({
      where: { id: task.id },
      update: expect.objectContaining({ status: "PENDING", attempts: 1, lastError: task.lastError }),
      create: expect.objectContaining({
        id: task.id,
        sessionId: task.sessionId,
        userMessageId: task.userMessageId,
        memberId: task.memberId,
        status: "PENDING",
        attempts: 1,
      }),
    });
    expect(JSON.stringify(prisma.client.avatarReplyFailureTask.upsert.mock.calls[0])).not.toContain(message.text);
  });

  it("atomically persists a successful AI reply with the advanced session", async () => {
    const createdAt = "2026-08-14T10:08:00.000Z";
    const session: StoredAvatarSession = {
      id: task.sessionId,
      userId: "user-requester",
      memberId: task.memberId,
      completedTopics: ["communication"],
      status: "active",
      createdAt: task.createdAt,
      updatedAt: createdAt,
    };
    const avatarMessage: StoredAvatarMessage = {
      id: "00000000-0000-4000-8000-000000000075",
      sessionId: session.id,
      sender: "avatar",
      text: "遇到分歧时，我会先把彼此的想法听完整。",
      clientMessageId: "question-id-2",
      topic: "沟通方式",
      modelName: "avatar-model",
      promptVersion: "avatar-profile-v1",
      latencyMs: 90,
      createdAt,
    };

    await createStore().persistAvatarReplySuccess(session, avatarMessage, "user-member-owner");

    expect(prisma.transaction).toHaveBeenCalledOnce();
    expect(prisma.transactionClient.avatarMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: avatarMessage.id, conversationId: session.id, senderType: "AVATAR" }),
    });
    expect(prisma.transactionClient.avatarConversation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: session.id },
      update: expect.objectContaining({ completedTopics: ["communication"], updatedAt: new Date(createdAt) }),
    }));
    expect(prisma.client.avatarMessage.create).not.toHaveBeenCalled();
  });

  it("atomically appends the AI message, resolves its failure task, and advances the session", async () => {
    const resolvedAt = "2026-08-14T10:10:00.000Z";
    const avatarMessage: StoredAvatarMessage = {
      id: "00000000-0000-4000-8000-000000000074",
      sessionId: task.sessionId,
      sender: "avatar",
      text: "我通常喜欢散步和阅读。",
      clientMessageId: null,
      topic: "生活习惯",
      modelName: "avatar-model",
      promptVersion: "avatar-profile-v1",
      latencyMs: 120,
      createdAt: resolvedAt,
    };
    const resolvedTask: StoredAvatarReplyFailureTask = {
      ...task,
      status: "resolved",
      attempts: 2,
      lastError: null,
      resolvedMessageId: avatarMessage.id,
      updatedAt: resolvedAt,
      resolvedAt,
    };
    const session: StoredAvatarSession = {
      id: task.sessionId,
      userId: "user-requester",
      memberId: task.memberId,
      completedTopics: ["lifestyle"],
      status: "active",
      createdAt: task.createdAt,
      updatedAt: resolvedAt,
    };

    await createStore().resolveAvatarReplyFailureTask(resolvedTask, avatarMessage, session, "user-member-owner");

    expect(prisma.transaction).toHaveBeenCalledOnce();
    const messageData = prisma.transactionClient.avatarMessage.create.mock.calls[0]?.[0].data;
    expect(messageData).toMatchObject({ id: avatarMessage.id, senderType: "AVATAR", modelName: "avatar-model" });
    expect(messageData.contentCiphertext).not.toContain(avatarMessage.text);
    expect(prisma.transactionClient.avatarReplyFailureTask.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: task.id },
      update: expect.objectContaining({
        status: "RESOLVED",
        attempts: 2,
        lastError: null,
        resolvedMessageId: avatarMessage.id,
        resolvedAt: new Date(resolvedAt),
      }),
    }));
    expect(prisma.transactionClient.avatarConversation.upsert).toHaveBeenCalledWith({
      where: { id: session.id },
      update: { status: "ACTIVE", completedTopics: ["lifestyle"], updatedAt: new Date(resolvedAt) },
      create: {
        id: session.id,
        userId: session.userId,
        targetUserId: "user-member-owner",
        status: "ACTIVE",
        completedTopics: ["lifestyle"],
        createdAt: new Date(session.createdAt),
        updatedAt: new Date(resolvedAt),
      },
    });
    expect(prisma.client.avatarMessage.create).not.toHaveBeenCalled();
    expect(prisma.client.avatarReplyFailureTask.upsert).not.toHaveBeenCalled();
  });
});
