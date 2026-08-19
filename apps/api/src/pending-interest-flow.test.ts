import { afterEach, describe, expect, it } from "vitest";
import { relationshipQuestions } from "@ai-marriage/shared";
import { OperationsCenter } from "./operations/index.js";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";
import type {
  Store,
  StorePersistence,
  StoredAdminAuditLog,
  StoredInterest,
  StoredMember,
  StoredNotification,
  StoredOnboardingDraft,
  StoredPhoto,
  StoredProfile,
} from "./store/types.js";

const targetUserId = "00000000-0000-4000-8000-000000000042";
const persistedInterestId = "00000000-0000-4000-8000-000000000043";
const secondTargetUserId = "00000000-0000-4000-8000-000000000044";
const completeAnswers = Object.fromEntries(relationshipQuestions.map((question) => [question, "先认真沟通，再一起商量。"]));

const targetMember: StoredMember = {
  id: `member-${targetUserId}`,
  nickname: "正式会员",
  gender: "女性",
  age: 46,
  city: "上海",
  district: "徐汇",
  job: "教育",
  maritalStatus: "离异",
  goal: "认真交往",
  tags: ["真诚"],
  introduction: "已审核通过并公开展示的正式会员。",
  photoUrl: "/api/photos/target/content",
  activeLabel: "近期活跃",
  verified: true,
  ownerUserId: targetUserId,
};

const secondTargetMember = member(`member-${secondTargetUserId}`, secondTargetUserId);

const pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=";

function storedProfile(userId: string, overrides: Partial<StoredProfile> = {}): StoredProfile {
  return {
    userId,
    nickname: "测试用户",
    gender: "男性",
    birthYear: 1978,
    city: "上海",
    district: "静安",
    job: "工程管理",
    maritalStatus: "离异",
    goal: "认真交往",
    introduction: "希望先认真了解，再决定是否进入真人聊天阶段。",
    preference: { preferredGender: "女性", relationshipGoal: "认真交往" },
    answers: { conflict: "先听完对方的想法。" },
    profileStatus: "approved",
    visibility: "approved_only",
    reviewReason: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function member(id: string, ownerUserId?: string): StoredMember {
  return {
    id,
    nickname: id,
    gender: "女性",
    age: 45,
    city: "上海",
    district: "徐汇",
    job: "教育",
    maritalStatus: "离异",
    goal: "认真交往",
    tags: [],
    introduction: "用于待审核心仪恢复测试。",
    photoUrl: "/target.png",
    activeLabel: "活跃",
    verified: true,
    ...(ownerUserId ? { ownerUserId } : {}),
  };
}

function persistence(overrides: Record<string, unknown> = {}) {
  const base = {
    hydrate: async () => undefined,
    close: async () => undefined,
    verifyOtp: async () => true,
    ...overrides,
  };
  return new Proxy(base, {
    get(target, property) {
      return Reflect.get(target, property) ?? (async () => undefined);
    },
  }) as unknown as StorePersistence;
}

function readyPendingUser(store: Store, userId: string, memberId: string, requestedAt = "2026-08-14T08:00:00.000Z") {
  store.profiles.set(userId, storedProfile(userId));
  store.members.set(`member-${userId}`, member(`member-${userId}`, userId));
  store.avatarProfiles.set(userId, {
    userId,
    version: 1,
    approvedFacts: [],
    relationshipExpectations: [],
    boundaries: [],
    unknownResponse: "未授权",
    status: "enabled",
    generatedAt: requestedAt,
    enabledAt: requestedAt,
  });
  store.onboardingDrafts.set(userId, {
    userId,
    currentStep: 5,
    status: "in_progress",
    data: { pendingInterest: { memberId, requestedAt } },
    updatedAt: requestedAt,
    completedAt: null,
  });
}

describe("待审核心仪意图", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  function createStore(seed: StoredMember[] = [targetMember]) {
    const store = createMemoryStore(seed);
    store.profiles.set(targetUserId, storedProfile(targetUserId, { visibility: "public" }));
    return store;
  }

  function createApp(store = createStore(), operationsCenter?: OperationsCenter) {
    const app = buildServer({ otpCode: "123456", store, operationsCenter });
    apps.push(app);
    return app;
  }

  async function login(app: ReturnType<typeof buildServer>, phone: string) {
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
    const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone, code: "123456" } });
    expect(response.statusCode).toBe(200);
    const cookie = response.cookies.find((item) => item.name === "refresh_token");
    expect(cookie?.value).toBeTruthy();
    return { cookie: `${cookie?.name}=${cookie?.value}`, userId: response.json().data.user.id as string };
  }

  async function prepareReview(app: ReturnType<typeof buildServer>, phone: string) {
    const requester = await login(app, phone);
    const admin = await login(app, "13900139999");
    expect((await app.inject({
      method: "POST",
      url: "/api/me/pending-interest",
      headers: { cookie: requester.cookie },
      payload: { memberId: targetMember.id },
    })).statusCode).toBe(202);
    expect((await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: { cookie: requester.cookie },
      payload: {
        nickname: "申请人",
        gender: "男性",
        birthYear: 1978,
        city: "上海",
        district: "静安",
        job: "工程管理",
        maritalStatus: "离异",
        goal: "认真交往",
        introduction: "希望先认真了解，再决定是否进入真人聊天阶段。",
        preference: { preferredGender: "女性", relationshipGoal: "认真交往" },
        answers: completeAnswers,
      },
    })).statusCode).toBe(200);
    const upload = await app.inject({
      method: "POST",
      url: "/api/me/photos",
      headers: { cookie: requester.cookie },
      payload: { filename: "portrait.png", mimeType: "image/png", sizeBytes: 68, dataUrl: pngDataUrl },
    });
    expect(upload.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/me/avatar-profile/generate", headers: { cookie: requester.cookie } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/me/avatar-profile/enable", headers: { cookie: requester.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/admin/profiles/${requester.userId}/approve`, headers: { cookie: admin.cookie } })).statusCode).toBe(200);
    return { requester, admin, photoId: upload.json().data.photo.id as string };
  }

  it("restores a pending interest with a stable notification resource", async () => {
    const store = createStore();
    const app = createApp(store);
    const { requester, admin, photoId } = await prepareReview(app, "13800138000");

    expect((await app.inject({ method: "POST", url: `/api/admin/photos/${photoId}/approve`, headers: { cookie: admin.cookie } })).statusCode).toBe(200);

    const interest = store.interests.get(`${requester.userId}:${targetMember.id}`);
    const memberNotifications = [...store.notifications.values()].filter((item) => item.relatedResourceType === "member");
    expect(interest?.status).toBe("active");
    expect(memberNotifications).toHaveLength(1);
    expect(memberNotifications[0]).toMatchObject({ id: interest?.id, relatedResourceId: targetUserId });
    expect(store.onboardingDrafts.get(requester.userId)?.data).not.toHaveProperty("pendingInterest");

    const targetFromNotificationResource = await app.inject({ method: "GET", url: `/api/members/${targetUserId}`, headers: { cookie: requester.cookie } });
    expect(targetFromNotificationResource.statusCode).toBe(200);
    expect(targetFromNotificationResource.json().data.member.id).toBe(targetMember.id);
  });

  it("serializes concurrent restoration and uses the database interest ID in memory and notification state", async () => {
    let atomicCalls = 0;
    const persistedState: { interest: StoredInterest | null; notification: StoredNotification | null } = { interest: null, notification: null };
    const store = createStore();
    store.persistence = persistence({
      persistPendingInterestFulfillment: async (proposedInterest: StoredInterest, draft: StoredOnboardingDraft, proposedNotification: StoredNotification) => {
        atomicCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        persistedState.interest ??= { ...proposedInterest, id: persistedInterestId };
        persistedState.notification ??= { ...proposedNotification, id: persistedState.interest.id, relatedResourceId: targetUserId };
        return { interest: structuredClone(persistedState.interest), notification: structuredClone(persistedState.notification) };
      },
    });
    const app = createApp(store);
    const requester = await login(app, "13800138002");
    readyPendingUser(store, requester.userId, targetMember.id);

    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/api/me", headers: { cookie: requester.cookie } }),
      app.inject({ method: "GET", url: "/api/me", headers: { cookie: requester.cookie } }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(atomicCalls).toBe(1);
    expect(store.interests.get(`${requester.userId}:${targetMember.id}`)?.id).toBe(persistedInterestId);
    expect(persistedState.interest?.id).toBe(persistedInterestId);
    expect([...store.notifications.values()].filter((item) => item.relatedResourceType === "member")).toEqual([
      expect.objectContaining({ id: persistedInterestId, relatedResourceId: targetUserId }),
    ]);
  });

  it("preserves a newly submitted pending intent while an older restoration is being persisted", async () => {
    let releaseRestoration!: () => void;
    let restorationStarted!: () => void;
    const restorationGate = new Promise<void>((resolve) => { releaseRestoration = resolve; });
    const restorationEntered = new Promise<void>((resolve) => { restorationStarted = resolve; });
    const persistedDrafts = new Map<string, StoredOnboardingDraft>();
    const store = createStore([targetMember, secondTargetMember]);
    store.persistence = persistence({
      persistOnboardingDraft: async (draft: StoredOnboardingDraft) => persistedDrafts.set(draft.userId, structuredClone(draft)),
      persistPendingInterestFulfillment: async (interest: StoredInterest, draft: StoredOnboardingDraft, notification: StoredNotification) => {
        restorationStarted();
        await restorationGate;
        persistedDrafts.set(draft.userId, structuredClone(draft));
        return { interest, notification };
      },
    });
    const app = createApp(store);
    const requester = await login(app, "13800138007");
    readyPendingUser(store, requester.userId, targetMember.id);
    persistedDrafts.set(requester.userId, structuredClone(store.onboardingDrafts.get(requester.userId)!));

    const restoration = app.inject({ method: "GET", url: "/api/me", headers: { cookie: requester.cookie } });
    await restorationEntered;
    store.profiles.get(requester.userId)!.profileStatus = "pending_review";
    const submitNewIntent = app.inject({
      method: "POST",
      url: "/api/me/pending-interest",
      headers: { cookie: requester.cookie },
      payload: { memberId: secondTargetMember.id },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseRestoration();

    const [restorationResponse, submitResponse] = await Promise.all([restoration, submitNewIntent]);

    expect(restorationResponse.statusCode).toBe(200);
    expect(submitResponse.statusCode).toBe(202);
    expect(store.onboardingDrafts.get(requester.userId)?.data.pendingInterest).toMatchObject({ memberId: secondTargetMember.id });
    expect(persistedDrafts.get(requester.userId)?.data.pendingInterest).toMatchObject({ memberId: secondTargetMember.id });
  });

  it("does not let an older restoration overwrite cancellation of a newly submitted intent", async () => {
    let releaseRestoration!: () => void;
    let restorationStarted!: () => void;
    const restorationGate = new Promise<void>((resolve) => { releaseRestoration = resolve; });
    const restorationEntered = new Promise<void>((resolve) => { restorationStarted = resolve; });
    const drafts: { persisted: StoredOnboardingDraft | null; canceled: StoredOnboardingDraft | null } = {
      persisted: null,
      canceled: null,
    };
    const store = createStore([targetMember, secondTargetMember]);
    store.persistence = persistence({
      persistOnboardingDraft: async (draft: StoredOnboardingDraft) => { drafts.persisted = structuredClone(draft); },
      persistInterestCancellation: async (_interest: StoredInterest | null, draft: StoredOnboardingDraft) => {
        drafts.canceled = structuredClone(draft);
        drafts.persisted = structuredClone(draft);
      },
      persistPendingInterestFulfillment: async (interest: StoredInterest, draft: StoredOnboardingDraft, notification: StoredNotification) => {
        restorationStarted();
        await restorationGate;
        drafts.persisted = structuredClone(draft);
        return { interest, notification };
      },
    });
    const app = createApp(store);
    const requester = await login(app, "13800138008");
    readyPendingUser(store, requester.userId, targetMember.id);

    const restoration = app.inject({ method: "GET", url: "/api/me", headers: { cookie: requester.cookie } });
    await restorationEntered;
    store.profiles.get(requester.userId)!.profileStatus = "pending_review";
    const submitNewIntent = app.inject({
      method: "POST",
      url: "/api/me/pending-interest",
      headers: { cookie: requester.cookie },
      payload: { memberId: secondTargetMember.id },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cancelNewIntent = app.inject({
      method: "DELETE",
      url: `/api/members/${secondTargetMember.id}/interest`,
      headers: { cookie: requester.cookie },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseRestoration();

    const [restorationResponse, submitResponse, cancelResponse] = await Promise.all([restoration, submitNewIntent, cancelNewIntent]);

    expect(restorationResponse.statusCode).toBe(200);
    expect(submitResponse.statusCode).toBe(202);
    expect(cancelResponse.statusCode).toBe(204);
    expect(drafts.canceled).not.toBeNull();
    expect(store.onboardingDrafts.get(requester.userId)?.data).not.toHaveProperty("pendingInterest");
    expect(drafts.persisted?.data).not.toHaveProperty("pendingInterest");
    expect(store.onboardingDrafts.get(requester.userId)?.updatedAt).toBe(drafts.canceled?.updatedAt);
    expect(drafts.persisted?.updatedAt).toBe(drafts.canceled?.updatedAt);
  });

  it("keeps photo approval, member sync, audit and review notification successful when restoration fails", async () => {
    const persisted = {
      drafts: new Map<string, StoredOnboardingDraft>(),
      photos: new Map<string, StoredPhoto>(),
      audits: new Map<string, StoredAdminAuditLog>(),
      notifications: new Map<string, StoredNotification>(),
    };
    const store = createStore();
    store.persistence = persistence({
      persistOnboardingDraft: async (draft: StoredOnboardingDraft) => persisted.drafts.set(draft.userId, structuredClone(draft)),
      persistPhoto: async (photo: StoredPhoto) => persisted.photos.set(photo.id, structuredClone(photo)),
      persistAdminAuditLog: async (audit: StoredAdminAuditLog) => persisted.audits.set(audit.id, structuredClone(audit)),
      persistNotification: async (notification: StoredNotification) => persisted.notifications.set(notification.id, structuredClone(notification)),
      persistPendingInterestFulfillment: async () => { throw new Error("simulated pending-interest transaction failure"); },
    });
    const operations = new OperationsCenter();
    const app = createApp(store, operations);
    const { requester, admin, photoId } = await prepareReview(app, "13800138003");

    const response = await app.inject({ method: "POST", url: `/api/admin/photos/${photoId}/approve`, headers: { cookie: admin.cookie } });

    expect(response.statusCode).toBe(200);
    expect(store.photos.get(photoId)?.reviewStatus).toBe("approved");
    expect(persisted.photos.get(photoId)?.reviewStatus).toBe("approved");
    expect(store.members.has(`member-${requester.userId}`)).toBe(true);
    expect([...store.adminAuditLogs.values()].some((item) => item.action === "photo.approved" && item.targetId === photoId)).toBe(true);
    expect([...persisted.audits.values()].some((item) => item.action === "photo.approved" && item.targetId === photoId)).toBe(true);
    expect([...store.notifications.values()].some((item) => item.type === "photo_reviewed" && item.relatedResourceId === photoId)).toBe(true);
    expect([...persisted.notifications.values()].some((item) => item.type === "photo_reviewed" && item.relatedResourceId === photoId)).toBe(true);
    expect(store.onboardingDrafts.get(requester.userId)?.data).toHaveProperty("pendingInterest");
    expect(store.interests.has(`${requester.userId}:${targetMember.id}`)).toBe(false);
    expect(operations.logger.list({ level: "error", event: "pending_interest.fulfillment.failed" })).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ userId: requester.userId, memberId: targetMember.id }) }),
    ]);
  });

  it("clears a matching pending intent when the user cancels before activation", async () => {
    const persistedDrafts = new Map<string, StoredOnboardingDraft>();
    const store = createStore();
    store.persistence = persistence({
      persistOnboardingDraft: async (draft: StoredOnboardingDraft) => persistedDrafts.set(draft.userId, structuredClone(draft)),
      persistInterestCancellation: async (_interest: StoredInterest | null, draft: StoredOnboardingDraft) => persistedDrafts.set(draft.userId, structuredClone(draft)),
    });
    const app = createApp(store);
    const requester = await login(app, "13800138004");
    expect((await app.inject({
      method: "POST",
      url: "/api/me/pending-interest",
      headers: { cookie: requester.cookie },
      payload: { memberId: targetMember.id },
    })).statusCode).toBe(202);

    expect((await app.inject({ method: "DELETE", url: `/api/members/${targetMember.id}/interest`, headers: { cookie: requester.cookie } })).statusCode).toBe(204);

    expect(store.onboardingDrafts.get(requester.userId)?.data).not.toHaveProperty("pendingInterest");
    expect(persistedDrafts.get(requester.userId)?.data).not.toHaveProperty("pendingInterest");
  });

  it("does not restore a pending intent older than a removed interest", async () => {
    let atomicCalls = 0;
    const store = createStore();
    store.persistence = persistence({
      persistPendingInterestFulfillment: async () => { atomicCalls += 1; },
    });
    const app = createApp(store);
    const requester = await login(app, "13800138005");
    readyPendingUser(store, requester.userId, targetMember.id, "2026-08-14T08:00:00.000Z");
    store.interests.set(`${requester.userId}:${targetMember.id}`, {
      id: persistedInterestId,
      userId: requester.userId,
      memberId: targetMember.id,
      status: "removed",
      createdAt: "2026-08-14T07:00:00.000Z",
      updatedAt: "2026-08-14T09:00:00.000Z",
    });

    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: requester.cookie } })).statusCode).toBe(200);

    expect(atomicCalls).toBe(0);
    expect(store.interests.get(`${requester.userId}:${targetMember.id}`)?.status).toBe("removed");
    expect(store.onboardingDrafts.get(requester.userId)?.data).not.toHaveProperty("pendingInterest");
    expect([...store.notifications.values()].filter((item) => item.relatedResourceType === "member")).toHaveLength(0);
  });

  it("leaves an ownerless target pending and keeps /api/me available", async () => {
    let atomicCalls = 0;
    const ownerless = member("ownerless-member");
    const store = createStore([ownerless]);
    store.persistence = persistence({
      persistPendingInterestFulfillment: async () => { atomicCalls += 1; throw new Error("must not be called"); },
    });
    const app = createApp(store);
    const requester = await login(app, "13800138006");
    readyPendingUser(store, requester.userId, ownerless.id);

    const response = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: requester.cookie } });

    expect(response.statusCode).toBe(200);
    expect(atomicCalls).toBe(0);
    expect(store.interests.has(`${requester.userId}:${ownerless.id}`)).toBe(false);
    expect(store.onboardingDrafts.get(requester.userId)?.data).toHaveProperty("pendingInterest");
    expect([...store.notifications.values()].filter((item) => item.relatedResourceType === "member")).toHaveLength(0);
  });

  it("resolves UUID resource parameters only by ownerUserId when a member ID collides", async () => {
    const collisionOwnerId = "00000000-0000-4000-8000-000000000099";
    const collidingMember = member(targetUserId, collisionOwnerId);
    const store = createStore([targetMember, collidingMember]);
    store.profiles.set(targetUserId, storedProfile(targetUserId, { visibility: "public" }));
    store.profiles.set(collisionOwnerId, storedProfile(collisionOwnerId, { visibility: "public" }));
    const app = createApp(store);

    const uuidResponse = await app.inject({ method: "GET", url: `/api/members/${targetUserId}` });
    const memberIdResponse = await app.inject({ method: "GET", url: `/api/members/${targetMember.id}` });

    expect(uuidResponse.statusCode).toBe(200);
    expect(uuidResponse.json().data.member.id).toBe(targetMember.id);
    expect(memberIdResponse.statusCode).toBe(200);
    expect(memberIdResponse.json().data.member.id).toBe(targetMember.id);
  });
});
