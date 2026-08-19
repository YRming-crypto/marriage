import type { Store, StoredUser } from "../store/index.js";
import type { ObjectStorageProvider } from "../providers/types.js";
import type { CleanupPlan } from "./types.js";

export interface ExpiredResourceCleanupOptions {
  store: Store;
  actorId: string;
  now?: () => number;
  objectStorage?: Pick<ObjectStorageProvider, "delete">;
  removeContentActivity?: (userId: string) => Promise<void>;
  removeAvatarKnowledge?: (userId: string) => Promise<void>;
}

export function createExpiredResourceCleanupPlan(options: ExpiredResourceCleanupOptions): CleanupPlan {
  const now = options.now ?? Date.now;
  return {
    taskName: "expired-resources",
    actorId: options.actorId,
    steps: [
      { target: "accountDeletions", cleanup: () => cleanupAccountDeletions(options.store, now(), options) },
      { target: "otp", cleanup: () => cleanupOtpRequests(options.store, now()) },
      { target: "sessions", cleanup: () => cleanupSessions(options.store, now()) },
      { target: "dataExports", cleanup: () => cleanupDataExports(options.store, now()) },
    ],
  };
}

async function cleanupAccountDeletions(
  store: Store,
  currentTime: number,
  options: Pick<ExpiredResourceCleanupOptions, "objectStorage" | "removeContentActivity" | "removeAvatarKnowledge">,
) {
  let removedCount = 0;
  for (const user of store.users.values()) {
    if (await cleanupExpiredAccount({ store, user, currentTime, ...options })) removedCount += 1;
  }
  return removedCount;
}

export interface ExpiredAccountCleanupOptions {
  store: Store;
  user: StoredUser;
  currentTime: number;
  objectStorage?: Pick<ObjectStorageProvider, "delete">;
  removeContentActivity?: (userId: string) => Promise<void>;
  removeAvatarKnowledge?: (userId: string) => Promise<void>;
}

export async function cleanupExpiredAccount(options: ExpiredAccountCleanupOptions) {
  const { store, user, currentTime, objectStorage } = options;
  if (
    user.status === "deleted"
    || user.deletionScheduledAt === undefined
    || user.deletionScheduledAt === null
    || new Date(user.deletionScheduledAt).getTime() > currentTime
  ) {
    return false;
  }

    const photos = [...store.photos.values()].filter((photo) => photo.userId === user.id);
    if (photos.length > 0 && !objectStorage) {
      throw new Error("Object storage is required to delete account photos.");
    }
    const stagedAt = new Date(currentTime).toISOString();
    const profile = store.profiles.get(user.id);
    if (profile) {
      const stagedProfile = { ...profile, visibility: "private" as const, updatedAt: stagedAt };
      await store.persistence?.persistProfile(stagedProfile);
      store.profiles.set(user.id, stagedProfile);
    }
    for (const photo of photos) {
      const stagedPhoto = {
        ...photo,
        isPrimary: false,
        reviewStatus: "rejected" as const,
        reviewReason: "account-deletion-pending",
        updatedAt: stagedAt,
      };
      await store.persistence?.persistPhoto(stagedPhoto);
      store.photos.set(photo.id, stagedPhoto);
    }
    for (const photo of photos) await objectStorage?.delete(photo.objectKey);
    await options.removeContentActivity?.(user.id);

    const deletedUser = {
      ...user,
      phone: `deleted:${user.id}`,
      role: "user" as const,
      status: "deleted" as const,
      suspensionSource: null,
      deletionRequestedAt: null,
      deletionScheduledAt: null,
    };
    await store.persistence?.deleteAccountPrivateData(user, deletedUser);
    await options.removeAvatarKnowledge?.(user.id);

    const removedMemberIds = new Set(
      [...store.members.values()]
        .filter((member) => member.ownerUserId === user.id)
        .map((member) => member.id),
    );
    const removedAvatarSessionIds = new Set(
      [...store.avatarSessions.values()]
        .filter((session) => session.userId === user.id || removedMemberIds.has(session.memberId))
        .map((session) => session.id),
    );
    const removedChatRequestIds = new Set(
      [...store.chatRequests.values()]
        .filter((request) => request.fromUserId === user.id || request.toUserId === user.id || removedAvatarSessionIds.has(request.avatarSessionId))
        .map((request) => request.id),
    );
    const removedConversationIds = new Set(
      [...store.conversations.values()]
        .filter((conversation) => conversation.participantIds.includes(user.id) || removedChatRequestIds.has(conversation.chatRequestId))
        .map((conversation) => conversation.id),
    );
    const removedMessageIds = new Set(
      [...store.messages.values()]
        .filter((message) => message.senderId === user.id || removedConversationIds.has(message.conversationId))
        .map((message) => message.id),
    );

    store.users.set(user.id, deletedUser);
    store.usersByPhone.delete(user.phone);
    store.otpRequests.delete(user.phone);
    for (const [token, session] of store.sessions) {
      if (session.userId === user.id) store.sessions.delete(token);
    }
    for (const [memberId, member] of store.members) {
      if (member.ownerUserId === user.id) store.members.delete(memberId);
    }
    store.onboardingDrafts.delete(user.id);
    store.profiles.delete(user.id);
    store.avatarProfiles.delete(user.id);
    for (const [photoId, photo] of store.photos) if (photo.userId === user.id) store.photos.delete(photoId);
    for (const [interestId, interest] of store.interests) {
      if (interest.userId === user.id || removedMemberIds.has(interest.memberId)) store.interests.delete(interestId);
    }
    for (const [skipId, skip] of store.matchSkips) {
      if (skip.userId === user.id || skip.targetUserId === user.id) store.matchSkips.delete(skipId);
    }
    for (const [filterId, filter] of store.matchFilters) if (filter.userId === user.id) store.matchFilters.delete(filterId);
    for (const [snapshotId, snapshot] of store.matchSnapshots) {
      if (snapshot.userId === user.id || snapshot.targetUserId === user.id) store.matchSnapshots.delete(snapshotId);
    }
    for (const sessionId of removedAvatarSessionIds) store.avatarSessions.delete(sessionId);
    for (const [messageId, message] of store.avatarMessages) {
      if (removedAvatarSessionIds.has(message.sessionId)) store.avatarMessages.delete(messageId);
    }
    for (const requestId of removedChatRequestIds) store.chatRequests.delete(requestId);
    for (const conversationId of removedConversationIds) store.conversations.delete(conversationId);
    for (const messageId of removedMessageIds) store.messages.delete(messageId);
    for (const [receiptId, receipt] of store.messageReceipts) {
      if (receipt.userId === user.id || removedMessageIds.has(receipt.messageId)) store.messageReceipts.delete(receiptId);
    }
    for (const [notificationId, notification] of store.notifications) {
      if (notification.userId === user.id) store.notifications.delete(notificationId);
    }
    for (const [reportId, report] of store.reports) {
      if (report.reporterUserId === user.id || report.targetUserId === user.id) store.reports.delete(reportId);
    }
    for (const [blockId, block] of store.blocks) {
      if (block.blockerUserId === user.id || block.blockedUserId === user.id) store.blocks.delete(blockId);
    }
    for (const [appealId, appeal] of store.accountAppeals) if (appeal.userId === user.id) store.accountAppeals.delete(appealId);
    for (const [exportId, exportJob] of store.dataExports) if (exportJob.userId === user.id) store.dataExports.delete(exportId);
    return true;
}

async function cleanupOtpRequests(store: Store, currentTime: number) {
  const expired = [...store.otpRequests.entries()]
    .filter(([, request]) => request.expiresAt <= currentTime);
  for (const [phone] of expired) {
    await store.persistence?.deleteOtpRequest(phone);
    store.otpRequests.delete(phone);
  }
  return expired.length;
}

async function cleanupSessions(store: Store, currentTime: number) {
  const expired = [...store.sessions.entries()]
    .filter(([, session]) => session.expiresAt <= currentTime);
  for (const [token] of expired) {
    await store.persistence?.deleteSession(token);
    store.sessions.delete(token);
  }
  return expired.length;
}

async function cleanupDataExports(store: Store, currentTime: number) {
  const expired = [...store.dataExports.values()].filter((item) => {
    if (!item.expiresAt || new Date(item.expiresAt).getTime() > currentTime) return false;
    return item.status !== "expired" || item.payload !== null;
  });
  for (const item of expired) {
    const cleaned = { ...item, status: "expired" as const, payload: null };
    await store.persistence?.persistDataExport(cleaned);
    store.dataExports.set(cleaned.id, cleaned);
  }
  return expired.length;
}
