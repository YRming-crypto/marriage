import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../server.js";
import { createMemoryStore } from "../store/index.js";
import type { StorePersistence, StoredUser } from "../store/types.js";
import { cleanupExpiredAccount, createExpiredResourceCleanupPlan } from "./expired-resource-cleanup.js";
import { MaintenanceService } from "./maintenance.js";

const NOW = Date.parse("2026-08-14T08:00:00.000Z");

function persistence(overrides: Partial<StorePersistence>) {
  return new Proxy({
    hydrate: async () => undefined,
    close: async () => undefined,
    ...overrides,
  }, {
    get(target, property) {
      return Reflect.get(target, property) ?? (async () => undefined);
    },
  }) as StorePersistence;
}

function user(overrides: Partial<StoredUser> & Pick<StoredUser, "id" | "phone">): StoredUser {
  return {
    role: "user",
    status: "suspended",
    suspensionSource: "self",
    createdAt: new Date(NOW - 30 * 24 * 60 * 60 * 1_000).toISOString(),
    deletionRequestedAt: new Date(NOW - 8 * 24 * 60 * 60 * 1_000).toISOString(),
    deletionScheduledAt: new Date(NOW - 1).toISOString(),
    ...overrides,
  };
}

describe("expired account deletion cleanup", () => {
  it("deletes only accounts whose cooling-off period expired and revokes their local state", async () => {
    const store = createMemoryStore([]);
    const expired = user({ id: "user-expired", phone: "13800138001" });
    const scheduledLater = user({
      id: "user-scheduled-later",
      phone: "13800138002",
      deletionScheduledAt: new Date(NOW + 1).toISOString(),
    });
    const alreadyDeleted = user({
      id: "user-already-deleted",
      phone: "13800138003",
      status: "deleted",
    });
    for (const storedUser of [expired, scheduledLater, alreadyDeleted]) {
      store.users.set(storedUser.id, storedUser);
      store.usersByPhone.set(storedUser.phone, storedUser.id);
    }
    store.sessions.set("expired-user-current-session", {
      id: "session-current",
      userId: expired.id,
      expiresAt: NOW + 60_000,
      userAgent: "current-device",
      createdAt: new Date(NOW - 1_000).toISOString(),
      lastUsedAt: new Date(NOW - 1_000).toISOString(),
    });
    store.sessions.set("expired-user-other-session", {
      id: "session-other",
      userId: expired.id,
      expiresAt: NOW + 120_000,
      userAgent: "other-device",
      createdAt: new Date(NOW - 2_000).toISOString(),
      lastUsedAt: new Date(NOW - 2_000).toISOString(),
    });
    store.sessions.set("future-user-session", {
      id: "session-future",
      userId: scheduledLater.id,
      expiresAt: NOW + 120_000,
      userAgent: "future-device",
      createdAt: new Date(NOW - 2_000).toISOString(),
      lastUsedAt: new Date(NOW - 2_000).toISOString(),
    });
    store.members.set("member-expired", {
      id: "member-expired",
      nickname: "到期用户",
      gender: "女性",
      age: 45,
      city: "上海",
      district: "徐汇",
      job: "教师",
      maritalStatus: "离异",
      goal: "认真交往",
      tags: ["真诚"],
      introduction: "即将完成注销。",
      photoUrl: "/images/member.jpg",
      activeLabel: "近期活跃",
      verified: true,
      ownerUserId: expired.id,
    });
    store.members.set("member-future", {
      ...store.members.get("member-expired")!,
      id: "member-future",
      ownerUserId: scheduledLater.id,
    });
    store.onboardingDrafts.set(expired.id, {
      userId: expired.id,
      currentStep: 3,
      status: "submitted",
      data: { privateAnswer: "private" },
      updatedAt: new Date(NOW - 1_000).toISOString(),
      completedAt: new Date(NOW - 1_000).toISOString(),
    });
    store.profiles.set(expired.id, {
      userId: expired.id,
      nickname: "Expired user",
      gender: "female",
      birthYear: 1980,
      city: "Shanghai",
      district: "Xuhui",
      job: "Teacher",
      maritalStatus: "divorced",
      goal: "marriage",
      introduction: "private introduction",
      preference: { city: "Shanghai" },
      answers: { family: "private answer" },
      profileStatus: "approved",
      updatedAt: new Date(NOW - 1_000).toISOString(),
    });
    store.avatarProfiles.set(expired.id, {
      userId: expired.id,
      version: 1,
      approvedFacts: [{ topic: "family", fact: "private fact" }],
      relationshipExpectations: ["marriage"],
      boundaries: ["private boundary"],
      unknownResponse: "unknown",
      status: "enabled",
      generatedAt: new Date(NOW - 1_000).toISOString(),
      enabledAt: new Date(NOW - 1_000).toISOString(),
    });
    store.photos.set("photo-expired", {
      id: "photo-expired",
      userId: expired.id,
      filename: "expired.jpg",
      objectKey: "users/user-expired/expired.jpg",
      url: "/api/photos/photo-expired/content",
      mimeType: "image/jpeg",
      sizeBytes: 10,
      isPrimary: true,
      reviewStatus: "approved",
      reviewReason: null,
      createdAt: new Date(NOW - 1_000).toISOString(),
      updatedAt: new Date(NOW - 1_000).toISOString(),
    });
    store.photos.set("photo-future", {
      ...store.photos.get("photo-expired")!,
      id: "photo-future",
      userId: scheduledLater.id,
      objectKey: "users/user-scheduled-later/future.jpg",
      url: "/api/photos/photo-future/content",
    });
    const persistUser = vi.fn().mockResolvedValue(undefined);
    const deleteUserSessions = vi.fn().mockResolvedValue(undefined);
    const deleteAccountPrivateData = vi.fn().mockResolvedValue(undefined);
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const readObject = vi.fn().mockResolvedValue({ data: Buffer.from("image"), mimeType: "image/jpeg" });
    store.persistence = persistence({ persistUser, deleteUserSessions, deleteAccountPrivateData });
    const service = new MaintenanceService({ now: () => NOW, createId: () => "run-account-deletions" });

    const firstRun = await service.runCleanup(createExpiredResourceCleanupPlan({
      store,
      actorId: "admin-1",
      now: () => NOW,
      objectStorage: { delete: deleteObject },
    }));

    expect(firstRun.results[0]).toEqual({
      target: "accountDeletions",
      status: "succeeded",
      removedCount: 1,
    });
    expect(store.users.get(expired.id)).toEqual({
      ...expired,
      phone: `deleted:${expired.id}`,
      role: "user",
      status: "deleted",
      suspensionSource: null,
      deletionRequestedAt: null,
      deletionScheduledAt: null,
    });
    expect(store.users.get(scheduledLater.id)).toEqual(scheduledLater);
    expect(store.users.get(alreadyDeleted.id)).toEqual(alreadyDeleted);
    expect(persistUser).not.toHaveBeenCalled();
    expect(deleteUserSessions).not.toHaveBeenCalled();
    expect(deleteAccountPrivateData).toHaveBeenCalledTimes(1);
    expect(deleteAccountPrivateData).toHaveBeenCalledWith(expired, expect.objectContaining({
      id: expired.id,
      phone: `deleted:${expired.id}`,
      role: "user",
      status: "deleted",
    }));
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith("users/user-expired/expired.jpg");
    expect(store.usersByPhone.has(expired.phone)).toBe(false);
    expect(store.usersByPhone.has(`deleted:${expired.id}`)).toBe(false);
    expect(store.sessions.has("expired-user-current-session")).toBe(false);
    expect(store.sessions.has("expired-user-other-session")).toBe(false);
    expect(store.sessions.has("future-user-session")).toBe(true);
    expect(store.members.has("member-expired")).toBe(false);
    expect(store.members.has("member-future")).toBe(true);
    expect(store.onboardingDrafts.has(expired.id)).toBe(false);
    expect(store.profiles.has(expired.id)).toBe(false);
    expect(store.avatarProfiles.has(expired.id)).toBe(false);
    expect(store.photos.has("photo-expired")).toBe(false);
    expect(store.photos.has("photo-future")).toBe(true);

    const app = buildServer({
      store,
      providers: {
        objectStorage: {
          upload: vi.fn(),
          read: readObject,
          delete: deleteObject,
        },
      },
    });
    const removedPhoto = await app.inject({ method: "GET", url: "/api/photos/photo-expired/content" });
    expect(removedPhoto.statusCode).toBe(404);
    expect(readObject).not.toHaveBeenCalled();
    await app.close();

    const repeatedRun = await new MaintenanceService({
      now: () => NOW,
      createId: () => "run-account-deletions-repeated",
    }).runCleanup(createExpiredResourceCleanupPlan({
      store,
      actorId: "admin-1",
      now: () => NOW,
      objectStorage: { delete: deleteObject },
    }));

    expect(repeatedRun.results[0]).toEqual({
      target: "accountDeletions",
      status: "succeeded",
      removedCount: 0,
    });
    expect(deleteAccountPrivateData).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledTimes(1);
  });

  it("hides profile photos before object deletion so a failed final database cleanup cannot expose broken images", async () => {
    const store = createMemoryStore([]);
    const expired = user({ id: "user-photo-staging", phone: "13800138009" });
    store.users.set(expired.id, expired);
    store.usersByPhone.set(expired.phone, expired.id);
    store.profiles.set(expired.id, {
      userId: expired.id,
      nickname: "Photo staging user",
      gender: "female",
      birthYear: 1980,
      city: "Shanghai",
      district: "Xuhui",
      job: "Teacher",
      maritalStatus: "divorced",
      goal: "marriage",
      introduction: "private introduction",
      preference: {},
      answers: {},
      profileStatus: "approved",
      visibility: "public",
      updatedAt: new Date(NOW - 1_000).toISOString(),
    });
    store.photos.set("photo-staging", {
      id: "photo-staging",
      userId: expired.id,
      filename: "staging.jpg",
      objectKey: "users/user-photo-staging/staging.jpg",
      url: "/api/photos/photo-staging/content",
      mimeType: "image/jpeg",
      sizeBytes: 10,
      isPrimary: true,
      reviewStatus: "approved",
      reviewReason: null,
      createdAt: new Date(NOW - 1_000).toISOString(),
      updatedAt: new Date(NOW - 1_000).toISOString(),
    });
    const persistProfile = vi.fn().mockResolvedValue(undefined);
    const persistPhoto = vi.fn().mockResolvedValue(undefined);
    const deleteAccountPrivateData = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    store.persistence = persistence({ persistProfile, persistPhoto, deleteAccountPrivateData });

    await expect(cleanupExpiredAccount({
      store,
      user: expired,
      currentTime: NOW,
      objectStorage: { delete: deleteObject },
    })).rejects.toThrow("database unavailable");

    expect(deleteObject).toHaveBeenCalledWith("users/user-photo-staging/staging.jpg");
    expect(store.users.get(expired.id)).toEqual(expired);
    expect(store.profiles.get(expired.id)).toMatchObject({ visibility: "private" });
    expect(store.photos.get("photo-staging")).toMatchObject({
      isPrimary: false,
      reviewStatus: "rejected",
      reviewReason: "account-deletion-pending",
    });
    expect(persistProfile).toHaveBeenCalledBefore(deleteAccountPrivateData);
    expect(persistPhoto).toHaveBeenCalledBefore(deleteAccountPrivateData);
  });
});
