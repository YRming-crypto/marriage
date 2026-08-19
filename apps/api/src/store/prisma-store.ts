import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { DataExportStatus, PrismaClient } from "@prisma/client";
import type { AvatarKnowledgeState } from "../avatar-knowledge/index.js";
import type { ContentActivityState } from "../content/index.js";
import type {
  Store,
  StorePersistence,
  StoredAvatarMessage,
  StoredAvatarReplyFailureTask,
  StoredAvatarProfile,
  StoredAvatarSession,
  StoredBlock,
  StoredChatRequest,
  StoredConversation,
  StoredInterest,
  StoredMatchFilter,
  StoredMatchSnapshot,
  StoredMatchSkip,
  StoredAccountAppeal,
  StoredDataExport,
  StoredAdminAuditLog,
  StoredMaintenanceRun,
  StoredMessage,
  StoredMessageReceipt,
  StoredNotification,
  StoredOnboardingDraft,
  StoredOtpRequest,
  StoredPhoto,
  StoredProfile,
  StoredReport,
  StoredSession,
  StoredUser,
} from "./types.js";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function keyedHash(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function compatibleHashes(value: string, secret: string) {
  return [keyedHash(value, secret), hash(value)];
}

function encryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function encrypt(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decrypt(value: string | null, secret: string) {
  if (!value) return "";
  try {
    const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

function mapGender(value: string) {
  return value === "男性" || value === "男" ? "MALE" : "FEMALE";
}

function mapGenderBack(value: string) {
  return value === "MALE" ? "男性" : "女性";
}

function mapMaritalStatus(value: string) {
  if (value === "离异") return "DIVORCED";
  if (value === "丧偶") return "WIDOWED";
  return "SINGLE";
}

function mapMaritalStatusBack(value: string) {
  if (value === "DIVORCED") return "离异";
  if (value === "WIDOWED") return "丧偶";
  return "未婚";
}

function mapGoal(value: string) {
  if (value === "以结婚为目标") return "MARRIAGE";
  if (value === "先认识了解") return "GET_TO_KNOW";
  return "SERIOUS_DATING";
}

function mapGoalBack(value: string) {
  if (value === "MARRIAGE") return "以结婚为目标";
  if (value === "GET_TO_KNOW") return "先认识了解";
  return "认真交往";
}

function mapRoleBack(value: string) {
  if (value === "ADMIN") return "admin" as const;
  if (value === "MODERATOR") return "moderator" as const;
  return "user" as const;
}

function mapStatusBack(value: string) {
  if (value === "SUSPENDED") return "suspended" as const;
  if (value === "DELETED") return "deleted" as const;
  return "active" as const;
}

function mapReviewStatusBack(value: string) {
  if (value === "APPROVED") return "approved" as const;
  if (value === "REJECTED") return "rejected" as const;
  return "pending" as const;
}

function mapProfileStatus(value: StoredProfile["profileStatus"]) {
  if (value === "approved") return "APPROVED" as const;
  if (value === "rejected") return "REJECTED" as const;
  if (value === "draft") return "DRAFT" as const;
  return "PENDING_REVIEW" as const;
}

function mapNotificationTypeBack(value: string): StoredNotification["type"] {
  return value.toLowerCase() as StoredNotification["type"];
}

function toDate(value: string | number) {
  return new Date(value);
}

function mapChatRequestStatus(value: string): StoredChatRequest["status"] {
  if (value === "ACCEPTED") return "accepted";
  if (value === "REJECTED") return "rejected";
  if (value === "EXPIRED") return "expired";
  return "pending";
}

function mapChatRequestStatusBack(value: StoredChatRequest["status"]) {
  if (value === "accepted") return "ACCEPTED" as const;
  if (value === "rejected") return "REJECTED" as const;
  if (value === "expired") return "EXPIRED" as const;
  return "PENDING" as const;
}

function interestUpsertArgs(interest: StoredInterest, targetUserId: string) {
  const status = interest.status === "active" ? "ACTIVE" as const : "REMOVED" as const;
  return {
    where: { fromUserId_toUserId: { fromUserId: interest.userId, toUserId: targetUserId } },
    update: { status },
    create: { id: interest.id, fromUserId: interest.userId, toUserId: targetUserId, status, createdAt: toDate(interest.createdAt), updatedAt: toDate(interest.updatedAt) },
  };
}

function onboardingDraftUpsertArgs(draft: StoredOnboardingDraft, encryptionSecret: string) {
  const status = draft.status === "submitted" ? "SUBMITTED" as const : "IN_PROGRESS" as const;
  const data = { currentStep: draft.currentStep, status, dataCiphertext: encrypt(JSON.stringify(draft.data), encryptionSecret), completedAt: draft.completedAt ? toDate(draft.completedAt) : null };
  return { where: { userId: draft.userId }, update: data, create: { userId: draft.userId, ...data } };
}

function notificationUpsertArgs(notification: StoredNotification) {
  const type = notification.type.toUpperCase() as never;
  return {
    where: { id: notification.id },
    update: { title: notification.title, body: notification.body, relatedResourceType: notification.relatedResourceType, relatedResourceId: notification.relatedResourceId, readAt: notification.readAt ? toDate(notification.readAt) : null },
    create: { id: notification.id, userId: notification.userId, type, title: notification.title, body: notification.body, relatedResourceType: notification.relatedResourceType, relatedResourceId: notification.relatedResourceId, readAt: notification.readAt ? toDate(notification.readAt) : null, createdAt: toDate(notification.createdAt) },
  };
}

function storedInterestFromRow(row: { id: string; fromUserId: string; status: string; createdAt: Date; updatedAt: Date }, memberId: string): StoredInterest {
  return { id: row.id, userId: row.fromUserId, memberId, status: row.status === "ACTIVE" ? "active" : "removed", createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function storedNotificationFromRow(row: { id: string; userId: string; type: string; title: string; body: string; relatedResourceType: string | null; relatedResourceId: string | null; readAt: Date | null; createdAt: Date }): StoredNotification {
  return { id: row.id, userId: row.userId, type: mapNotificationTypeBack(row.type), title: row.title, body: row.body, relatedResourceType: row.relatedResourceType, relatedResourceId: row.relatedResourceId, readAt: row.readAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() };
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function decryptedStringRecord(value: string | null, secret: string) {
  try {
    return stringRecord(JSON.parse(decrypt(value, secret) || "{}"));
  } catch {
    return {};
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function avatarMessageCreateData(message: StoredAvatarMessage, encryptionSecret: string) {
  return {
    id: message.id,
    conversationId: message.sessionId,
    senderType: message.sender === "avatar" ? "AVATAR" as const : "USER" as const,
    contentCiphertext: encrypt(message.text, encryptionSecret),
    clientMessageId: message.clientMessageId ?? null,
    modelName: message.modelName ?? null,
    promptVersion: message.promptVersion ?? null,
    latencyMs: message.latencyMs ?? null,
    moderationStatus: "APPROVED" as const,
    createdAt: toDate(message.createdAt),
  };
}

function avatarReplyFailureTaskUpsertArgs(task: StoredAvatarReplyFailureTask) {
  const status = task.status === "resolved" ? "RESOLVED" as const : "PENDING" as const;
  const data = {
    sessionId: task.sessionId,
    userMessageId: task.userMessageId,
    memberId: task.memberId,
    status,
    attempts: task.attempts,
    lastError: task.lastError,
    resolvedMessageId: task.resolvedMessageId,
    updatedAt: toDate(task.updatedAt),
    resolvedAt: task.resolvedAt ? toDate(task.resolvedAt) : null,
  };
  return {
    where: { id: task.id },
    update: data,
    create: { id: task.id, ...data, createdAt: toDate(task.createdAt) },
  };
}

export class PrismaStore implements StorePersistence {
  private readonly client: PrismaClient;
  private readonly encryptionSecret: string;
  private store?: Store;

  constructor(databaseUrl: string, encryptionSecret: string) {
    this.client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    this.encryptionSecret = encryptionSecret;
  }

  async healthCheck() {
    await this.client.$queryRawUnsafe("SELECT 1");
  }

  async hydrate(store: Store) {
    this.store = store;

    const users = await this.client.user.findMany({
      include: { sessions: { orderBy: { lastUsedAt: "desc" }, take: 1, select: { lastUsedAt: true } } },
    });
    for (const user of users) {
      const item: StoredUser = { id: user.id, phone: decrypt(user.phoneEncrypted, this.encryptionSecret) || `unknown-${user.id}`, role: mapRoleBack(user.role), status: mapStatusBack(user.status), suspensionSource: user.suspensionSource?.toLowerCase() as StoredUser["suspensionSource"] ?? null, createdAt: user.createdAt.toISOString(), lastActiveAt: user.sessions?.[0]?.lastUsedAt?.toISOString(), deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null, deletionScheduledAt: user.deletionScheduledAt?.toISOString() ?? null };
      store.users.set(item.id, item);
      store.usersByPhone.set(item.phone, item.id);
    }

    const profiles = await this.client.profile.findMany();
    for (const profile of profiles) {
      store.profiles.set(profile.userId, {
        userId: profile.userId,
        nickname: profile.nickname,
        gender: mapGenderBack(profile.gender),
        birthYear: profile.birthYear,
        city: profile.city,
        district: profile.district ?? "",
        job: profile.jobCategory ?? "",
        maritalStatus: mapMaritalStatusBack(profile.maritalStatus),
        goal: mapGoalBack(profile.goal),
        introduction: profile.introduction ?? "",
        preference: stringRecord(profile.preference),
        answers: decryptedStringRecord(profile.onboardingAnswersCiphertext, this.encryptionSecret),
        profileStatus: profile.profileStatus.toLowerCase() as StoredProfile["profileStatus"],
        visibility: profile.visibility.toLowerCase() as NonNullable<StoredProfile["visibility"]>,
        reviewReason: profile.reviewReason,
        updatedAt: profile.updatedAt.toISOString(),
      });
      if (profile.aiProfileSummary) {
        const summary = typeof profile.aiProfileSummary === "object" && profile.aiProfileSummary !== null && !Array.isArray(profile.aiProfileSummary) ? profile.aiProfileSummary as Record<string, unknown> : {};
        store.avatarProfiles.set(profile.userId, {
          userId: profile.userId,
          version: profile.aiProfileVersion,
          approvedFacts: Array.isArray(summary.approvedFacts) ? summary.approvedFacts.filter((item): item is { topic: string; fact: string } => typeof item === "object" && item !== null && typeof (item as { topic?: unknown }).topic === "string" && typeof (item as { fact?: unknown }).fact === "string") : [],
          relationshipExpectations: Array.isArray(summary.relationshipExpectations) ? summary.relationshipExpectations.filter((item): item is string => typeof item === "string") : [],
          boundaries: Array.isArray(summary.boundaries) ? summary.boundaries.filter((item): item is string => typeof item === "string") : [],
          unknownResponse: typeof summary.unknownResponse === "string" ? summary.unknownResponse : "这个问题没有得到本人明确授权。",
          status: profile.aiConsentStatus.toLowerCase() as StoredAvatarProfile["status"],
          generatedAt: profile.aiGeneratedAt?.toISOString() ?? profile.updatedAt.toISOString(),
          enabledAt: profile.aiApprovedAt?.toISOString() ?? null,
        });
      }
    }

    const onboardingDrafts = await this.client.onboardingDraft.findMany();
    for (const draft of onboardingDrafts) {
      let data: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(decrypt(draft.dataCiphertext, this.encryptionSecret));
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
      } catch {
        data = {};
      }
      store.onboardingDrafts.set(draft.userId, { userId: draft.userId, currentStep: draft.currentStep, status: draft.status.toLowerCase() as StoredOnboardingDraft["status"], data, updatedAt: draft.updatedAt.toISOString(), completedAt: draft.completedAt?.toISOString() ?? null });
    }

    const appeals = await this.client.accountAppeal.findMany();
    for (const appeal of appeals) {
      store.accountAppeals.set(appeal.id, { id: appeal.id, userId: appeal.userId, reason: appeal.reason, evidence: Array.isArray(appeal.evidence) ? appeal.evidence.filter((item): item is string => typeof item === "string") : [], status: appeal.status.toLowerCase() as StoredAccountAppeal["status"], resolution: appeal.resolution, createdAt: appeal.createdAt.toISOString(), updatedAt: appeal.updatedAt.toISOString() });
    }

    const dataExports = await this.client.dataExportJob.findMany();
    for (const exportJob of dataExports) {
      let payload: Record<string, unknown> | null = null;
      if (exportJob.payloadCiphertext) {
        try {
          const parsed = JSON.parse(decrypt(exportJob.payloadCiphertext, this.encryptionSecret));
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
        } catch {
          payload = null;
        }
      }
      store.dataExports.set(exportJob.id, { id: exportJob.id, userId: exportJob.userId, status: exportJob.status.toLowerCase() as StoredDataExport["status"], payload, createdAt: exportJob.createdAt.toISOString(), readyAt: exportJob.readyAt?.toISOString() ?? null, expiresAt: exportJob.expiresAt?.toISOString() ?? null });
    }

    const auditLogs = await this.client.adminAuditLog.findMany();
    for (const entry of auditLogs) store.adminAuditLogs.set(entry.id, {
      id: entry.id,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      reason: entry.reason,
      metadata: jsonRecord(entry.metadata),
      createdAt: entry.createdAt.toISOString(),
    });

    const maintenanceRuns = await this.client.maintenanceRun.findMany();
    for (const run of maintenanceRuns) {
      const result = jsonRecord(run.result);
      store.maintenanceRuns.set(run.id, {
        id: run.id,
        taskName: run.task,
        actorId: run.triggeredBy,
        status: run.status.toLowerCase() as StoredMaintenanceRun["status"],
        startedAt: run.startedAt.getTime(),
        finishedAt: run.finishedAt?.getTime() ?? null,
        totalRemoved: typeof result.totalRemoved === "number" ? result.totalRemoved : 0,
        results: Array.isArray(result.results) ? result.results as StoredMaintenanceRun["results"] : [],
      });
    }

    const photos = await this.client.photo.findMany();
    for (const photo of photos) store.photos.set(photo.id, { id: photo.id, userId: photo.userId, filename: photo.objectKey.split("/").at(-1) ?? "photo", objectKey: photo.objectKey, url: photo.url ?? "", mimeType: photo.mimeType, sizeBytes: photo.sizeBytes, isPrimary: photo.isPrimary, reviewStatus: mapReviewStatusBack(photo.reviewStatus), reviewReason: photo.reviewReason, createdAt: photo.createdAt.toISOString(), updatedAt: photo.updatedAt.toISOString() });

    const notifications = await this.client.notification.findMany();
    for (const item of notifications) store.notifications.set(item.id, { id: item.id, userId: item.userId, type: mapNotificationTypeBack(item.type), title: item.title, body: item.body, relatedResourceType: item.relatedResourceType, relatedResourceId: item.relatedResourceId, readAt: item.readAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString() });

    const reports = await this.client.report.findMany();
    for (const item of reports) store.reports.set(item.id, { id: item.id, reporterUserId: item.reporterUserId, targetUserId: item.targetUserId, targetAvatarSessionId: item.targetAvatarConversationId, targetConversationId: item.targetConversationId, targetMessageId: item.targetMessageId, reason: item.reason, description: item.description, status: item.status.toLowerCase() as StoredReport["status"], resolution: item.resolution, resolvedByUserId: item.resolvedByUserId, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() });

    const blocks = await this.client.block.findMany();
    for (const item of blocks) store.blocks.set(`${item.blockerUserId}:${item.blockedUserId}`, { id: item.id, blockerUserId: item.blockerUserId, blockedUserId: item.blockedUserId, createdAt: item.createdAt.toISOString() });

    const interests = await this.client.interest.findMany();
    for (const interest of interests) {
      const memberId = `member-${interest.toUserId}`;
      store.interests.set(`${interest.fromUserId}:${memberId}`, { id: interest.id, userId: interest.fromUserId, memberId, status: interest.status === "ACTIVE" ? "active" : "removed", createdAt: interest.createdAt.toISOString(), updatedAt: interest.updatedAt.toISOString() });
    }

    const matchSkips = await this.client.matchSkip.findMany();
    for (const skip of matchSkips) store.matchSkips.set(`${skip.userId}:${skip.targetUserId}`, { id: skip.id, userId: skip.userId, targetUserId: skip.targetUserId, createdAt: skip.createdAt.toISOString() });

    const matchFilters = await this.client.savedMatchFilter.findMany();
    for (const filter of matchFilters) store.matchFilters.set(filter.id, { id: filter.id, userId: filter.userId, name: filter.name, criteria: typeof filter.criteria === "object" && filter.criteria !== null && !Array.isArray(filter.criteria) ? filter.criteria as Record<string, unknown> : {}, isDefault: filter.isDefault, createdAt: filter.createdAt.toISOString(), updatedAt: filter.updatedAt.toISOString() });

    const matchSnapshots = await this.client.matchSnapshot.findMany();
    for (const snapshot of matchSnapshots) store.matchSnapshots.set(snapshot.id, {
      id: snapshot.id,
      userId: snapshot.userId,
      targetUserId: snapshot.targetUserId,
      algorithmVersion: snapshot.algorithmVersion,
      score: snapshot.score,
      reasons: stringArray(snapshot.reasons),
      factors: Array.isArray(snapshot.factors) ? snapshot.factors.filter((item): item is StoredMatchSnapshot["factors"][number] => typeof item === "object" && item !== null && typeof (item as { factor?: unknown }).factor === "string") : [],
      createdAt: snapshot.createdAt.toISOString(),
    });

    const avatarSessions = await this.client.avatarConversation.findMany({ include: { messages: true } });
    for (const session of avatarSessions) {
      const memberId = `member-${session.targetUserId}`;
      const completedTopics = Array.isArray(session.completedTopics) ? session.completedTopics.filter((topic): topic is string => typeof topic === "string") : [];
      const storedSession: StoredAvatarSession = { id: session.id, userId: session.userId, memberId, completedTopics, status: session.status === "BLOCKED" ? "paused" : "active", createdAt: session.createdAt.toISOString(), updatedAt: session.updatedAt.toISOString() };
      store.avatarSessions.set(storedSession.id, storedSession);
      for (const message of session.messages) {
        store.avatarMessages.set(message.id, { id: message.id, sessionId: message.conversationId, sender: message.senderType === "AVATAR" ? "avatar" : "user", text: decrypt(message.contentCiphertext, this.encryptionSecret), clientMessageId: message.clientMessageId, topic: null, modelName: message.modelName, promptVersion: message.promptVersion, latencyMs: message.latencyMs, createdAt: message.createdAt.toISOString() });
      }
    }

    const avatarReplyFailureTasks = await this.client.avatarReplyFailureTask.findMany();
    for (const task of avatarReplyFailureTasks) {
      store.avatarReplyFailureTasks.set(task.id, {
        id: task.id,
        sessionId: task.sessionId,
        userMessageId: task.userMessageId,
        memberId: task.memberId,
        status: task.status === "RESOLVED" ? "resolved" : "pending",
        attempts: task.attempts,
        lastError: task.lastError,
        resolvedMessageId: task.resolvedMessageId,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        resolvedAt: task.resolvedAt?.toISOString() ?? null,
      });
    }

    const requests = await this.client.chatRequest.findMany();
    for (const request of requests) {
      const memberId = `member-${request.targetUserId}`;
      store.chatRequests.set(request.id, {
        id: request.id,
        avatarSessionId: request.sourceAvatarConversationId ?? "",
        fromUserId: request.requesterId,
        toUserId: request.targetUserId,
        memberId,
        status: mapChatRequestStatus(request.status),
        expiresAt: request.expiresAt?.toISOString() ?? null,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      });
    }

    const conversations = await this.client.conversation.findMany({ include: { messages: true } });
    for (const conversation of conversations) {
      const storedConversation: StoredConversation = { id: conversation.id, chatRequestId: conversation.chatRequestId ?? "", participantIds: [conversation.userAId, conversation.userBId], status: conversation.status === "BLOCKED" ? "blocked" : conversation.status === "ARCHIVED" ? "archived" : "active", archivedAt: conversation.archivedAt?.toISOString() ?? null, createdAt: conversation.createdAt.toISOString() };
      store.conversations.set(storedConversation.id, storedConversation);
      for (const message of conversation.messages) {
        store.messages.set(message.id, { id: message.id, conversationId: message.conversationId, senderId: message.senderId ?? "", text: message.deletedAt ? "此消息已撤回" : decrypt(message.contentCiphertext, this.encryptionSecret), clientMessageId: message.clientMessageId, deletedAt: message.deletedAt?.toISOString() ?? null, createdAt: message.createdAt.toISOString() });
      }
    }

    const messageReceipts = await this.client.messageReceipt.findMany();
    for (const receipt of messageReceipts) {
      store.messageReceipts.set(`${receipt.messageId}:${receipt.userId}`, {
        id: receipt.id,
        messageId: receipt.messageId,
        userId: receipt.userId,
        deliveredAt: receipt.deliveredAt?.toISOString() ?? null,
        readAt: receipt.readAt?.toISOString() ?? null,
        createdAt: receipt.createdAt.toISOString(),
      });
    }
  }

  async loadContentActivityState(): Promise<ContentActivityState> {
    const rows = await this.client.contentItem.findMany({
      include: { likes: true, registrations: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      content: rows.map((row) => {
        const registrationCount = row.registrations.filter((item) => item.status === "REGISTERED").length;
        const event = row.type === "EVENT"
          && row.eventStartsAt && row.eventEndsAt && row.location && row.capacity
          ? {
              startsAt: row.eventStartsAt.getTime(),
              endsAt: row.eventEndsAt.getTime(),
              location: row.location,
              capacity: row.capacity,
              remainingCapacity: Math.max(0, row.capacity - registrationCount),
            }
          : null;
        return {
          id: row.id,
          type: row.type === "EVENT" ? "event" as const : "article" as const,
          status: row.status.toLowerCase() as "draft" | "published" | "offline",
          title: row.title,
          summary: row.summary,
          body: row.body,
          tags: [...row.tags],
          coverImageUrl: row.coverUrl,
          imageUrls: [...(row.imageUrls ?? [])],
          authorId: row.createdByUserId,
          likeCount: row.likes.length,
          registrationCount,
          event,
          createdAt: row.createdAt.getTime(),
          updatedAt: row.updatedAt.getTime(),
          publishedAt: row.publishedAt?.getTime() ?? null,
          offlineAt: row.offlineAt?.getTime() ?? null,
        };
      }),
      likes: rows.map((row) => ({ contentId: row.id, userIds: row.likes.map((like) => like.userId) })),
      registrations: rows.flatMap((row) => row.registrations.map((registration) => ({
        id: registration.id,
        contentId: registration.contentId,
        userId: registration.userId,
        status: registration.status === "REGISTERED" ? "registered" as const : "cancelled" as const,
        registeredAt: registration.registeredAt.getTime(),
        cancelledAt: registration.cancelledAt?.getTime() ?? null,
        updatedAt: registration.updatedAt.getTime(),
      }))),
    };
  }

  async persistContentActivityState(state: ContentActivityState): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.eventRegistration.deleteMany();
      await transaction.contentLike.deleteMany();
      await transaction.contentItem.deleteMany();
      for (const item of state.content) {
        await transaction.contentItem.create({ data: {
          id: item.id,
          type: item.type === "event" ? "EVENT" : "POST",
          status: item.status === "published" ? "PUBLISHED" : item.status === "offline" ? "OFFLINE" : "DRAFT",
          title: item.title,
          summary: item.summary,
          body: item.body,
          tags: item.tags,
          coverUrl: item.coverImageUrl,
          imageUrls: item.imageUrls ?? [],
          location: item.event?.location ?? null,
          eventStartsAt: item.event ? new Date(item.event.startsAt) : null,
          eventEndsAt: item.event ? new Date(item.event.endsAt) : null,
          capacity: item.event?.capacity ?? null,
          publishedAt: item.publishedAt === null ? null : new Date(item.publishedAt),
          offlineAt: item.offlineAt === null ? null : new Date(item.offlineAt),
          createdByUserId: item.authorId,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        } });
      }
      for (const entry of state.likes) {
        for (const userId of entry.userIds) {
          await transaction.contentLike.create({ data: { contentId: entry.contentId, userId } });
        }
      }
      for (const registration of state.registrations) {
        await transaction.eventRegistration.create({ data: {
          id: registration.id,
          contentId: registration.contentId,
          userId: registration.userId,
          status: registration.status === "registered" ? "REGISTERED" : "CANCELLED",
          registeredAt: new Date(registration.registeredAt),
          cancelledAt: registration.cancelledAt === null ? null : new Date(registration.cancelledAt),
          createdAt: new Date(registration.registeredAt),
          updatedAt: new Date(registration.updatedAt),
        } });
      }
    });
  }

  async loadAvatarKnowledgeState(): Promise<AvatarKnowledgeState> {
    const [knowledgeRows, versionRows, callRows] = await Promise.all([
      this.client.avatarKnowledgeItem.findMany({ include: { profile: true }, orderBy: { createdAt: "asc" } }),
      this.client.avatarProfileVersion.findMany({ include: { profile: true }, orderBy: { createdAt: "asc" } }),
      this.client.modelCallLog.findMany({ where: { userId: { not: null } }, orderBy: { createdAt: "asc" } }),
    ]);
    const versions = versionRows.map((row) => {
      const summary = jsonRecord(row.summary);
      return {
        id: row.id,
        ownerId: row.profile.userId,
        versionNumber: row.version,
        status: row.status.toLowerCase() as "draft" | "active" | "stale" | "archived",
        note: row.note,
        items: Array.isArray(summary.items) ? summary.items as AvatarKnowledgeState["versions"][number]["items"] : [],
        createdAt: row.createdAt.getTime(),
        activatedAt: row.activatedAt?.getTime() ?? null,
      };
    });
    return {
      items: knowledgeRows.map((row) => ({
        id: row.id,
        ownerId: row.profile.userId,
        title: row.title,
        content: row.content,
        topic: row.topic,
        keywords: [...row.keywords],
        status: row.governanceStatus.toLowerCase() as "allowed" | "sensitive" | "prohibited",
        moderationReason: row.moderationReason,
        revision: row.revision,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
      })),
      versions,
      currentVersions: versions
        .filter((version) => version.status === "active" || version.status === "stale")
        .map((version) => ({ ownerId: version.ownerId, versionId: version.id })),
      callLogs: callRows.flatMap((row) => {
        const metadata = jsonRecord(row.metadata);
        const versionId = typeof metadata.versionId === "string" ? metadata.versionId : null;
        if (!row.userId || !versionId) return [];
        return [{
          id: row.id,
          ownerId: row.userId,
          versionId,
          model: row.modelName,
          status: row.status === "succeeded" ? "succeeded" as const : "failed" as const,
          latencyMs: row.latencyMs ?? 0,
          inputTokens: row.inputTokens ?? 0,
          outputTokens: row.outputTokens ?? 0,
          errorCode: row.error === "MODEL_CALL_FAILED" ? "MODEL_CALL_FAILED" as const : null,
          createdAt: row.createdAt.getTime(),
        }];
      }),
    };
  }

  async persistAvatarKnowledgeState(state: AvatarKnowledgeState): Promise<void> {
    const profiles = await this.client.profile.findMany({ select: { id: true, userId: true } });
    const profileIds = new Map(profiles.map((profile) => [profile.userId, profile.id]));
    await this.client.$transaction(async (transaction) => {
      await transaction.avatarProfileVersion.deleteMany();
      await transaction.avatarKnowledgeItem.deleteMany();
      await transaction.modelCallLog.deleteMany({ where: { provider: "avatar-knowledge" } });
      for (const item of state.items) {
        const profileId = profileIds.get(item.ownerId);
        if (!profileId) continue;
        await transaction.avatarKnowledgeItem.create({ data: {
          id: item.id,
          profileId,
          title: item.title,
          content: item.content,
          topic: item.topic,
          keywords: item.keywords,
          governanceStatus: item.status === "sensitive" ? "SENSITIVE" : item.status === "prohibited" ? "PROHIBITED" : "ALLOWED",
          moderationReason: item.moderationReason,
          revision: item.revision,
          source: "manual",
          enabled: item.status !== "prohibited",
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        } });
      }
      for (const version of state.versions) {
        const profileId = profileIds.get(version.ownerId);
        if (!profileId) continue;
        await transaction.avatarProfileVersion.create({ data: {
          id: version.id,
          profileId,
          version: version.versionNumber,
          status: version.status === "active" ? "ACTIVE" : version.status === "stale" ? "STALE" : version.status === "archived" ? "ARCHIVED" : "DRAFT",
          note: version.note,
          summary: { items: version.items } as never,
          forbiddenTopics: [],
          promptVersion: "knowledge-governance-v1",
          activatedAt: version.activatedAt === null ? null : new Date(version.activatedAt),
          createdAt: new Date(version.createdAt),
        } });
      }
      for (const log of state.callLogs) {
        await transaction.modelCallLog.create({ data: {
          id: log.id,
          userId: log.ownerId,
          provider: "avatar-knowledge",
          modelName: log.model,
          promptVersion: "knowledge-governance-v1",
          status: log.status,
          latencyMs: log.latencyMs,
          inputTokens: log.inputTokens,
          outputTokens: log.outputTokens,
          error: log.errorCode,
          metadata: { versionId: log.versionId },
          createdAt: new Date(log.createdAt),
        } });
      }
    });
  }

  async persistUser(user: StoredUser) {
    const role = user.role === "admin" ? "ADMIN" : user.role === "moderator" ? "MODERATOR" : "USER";
    const status = user.status === "suspended" ? "SUSPENDED" : user.status === "deleted" ? "DELETED" : "ACTIVE";
    const lifecycle = { suspensionSource: user.suspensionSource === "admin" ? "ADMIN" as const : user.suspensionSource === "self" ? "SELF" as const : null, deletionRequestedAt: user.deletionRequestedAt ? toDate(user.deletionRequestedAt) : null, deletionScheduledAt: user.deletionScheduledAt ? toDate(user.deletionScheduledAt) : null };
    const phoneHash = keyedHash(user.phone, this.encryptionSecret);
    await this.client.user.upsert({ where: { id: user.id }, update: { phoneHash, phoneEncrypted: encrypt(user.phone, this.encryptionSecret), phoneVerified: true, role, status, ...lifecycle }, create: { id: user.id, phoneHash, phoneEncrypted: encrypt(user.phone, this.encryptionSecret), phoneVerified: true, role, status, createdAt: toDate(user.createdAt), ...lifecycle } });
  }

  async suspendUserAndDeleteSessions(user: StoredUser) {
    const role = user.role === "admin" ? "ADMIN" : user.role === "moderator" ? "MODERATOR" : "USER";
    await this.client.$transaction([
      this.client.user.update({
        where: { id: user.id },
        data: {
          role,
          status: "SUSPENDED",
          suspensionSource: user.suspensionSource === "self" ? "SELF" : "ADMIN",
          deletionRequestedAt: user.deletionRequestedAt ? toDate(user.deletionRequestedAt) : null,
          deletionScheduledAt: user.deletionScheduledAt ? toDate(user.deletionScheduledAt) : null,
        },
      }),
      this.client.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async findUserByPhone(phone: string) {
    const [currentHash, legacyHash] = compatibleHashes(phone, this.encryptionSecret);
    let user = await this.client.user.findUnique({ where: { phoneHash: currentHash } });
    if (!user) {
      user = await this.client.user.findUnique({ where: { phoneHash: legacyHash } });
      if (user) await this.client.user.update({ where: { id: user.id }, data: { phoneHash: currentHash } });
    }
    if (!user) return undefined;
    return { id: user.id, phone: decrypt(user.phoneEncrypted, this.encryptionSecret) || phone, role: mapRoleBack(user.role), status: mapStatusBack(user.status), suspensionSource: user.suspensionSource?.toLowerCase() as StoredUser["suspensionSource"] ?? null, createdAt: user.createdAt.toISOString(), deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null, deletionScheduledAt: user.deletionScheduledAt?.toISOString() ?? null } satisfies StoredUser;
  }

  async deleteAccountPrivateData(originalUser: StoredUser, deletedUser: StoredUser) {
    await this.client.$transaction(async (transaction) => {
      const userId = originalUser.id;
      const involvingUser = { OR: [{ userId }, { targetUserId: userId }] };

      await transaction.conversation.deleteMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] } });
      await transaction.chatRequest.deleteMany({ where: { OR: [{ requesterId: userId }, { targetUserId: userId }] } });
      await transaction.avatarConversation.deleteMany({ where: involvingUser });
      await transaction.interest.deleteMany({ where: { OR: [{ fromUserId: userId }, { toUserId: userId }] } });
      await transaction.messageReceipt.deleteMany({ where: { userId } });
      await transaction.notification.deleteMany({ where: { userId } });
      await transaction.block.deleteMany({ where: { OR: [{ blockerUserId: userId }, { blockedUserId: userId }] } });
      await transaction.report.deleteMany({ where: { OR: [{ reporterUserId: userId }, { targetUserId: userId }] } });
      await transaction.savedMatchFilter.deleteMany({ where: { userId } });
      await transaction.matchSkip.deleteMany({ where: { OR: [{ userId }, { targetUserId: userId }] } });
      await transaction.matchSnapshot.deleteMany({ where: { OR: [{ userId }, { targetUserId: userId }] } });
      await transaction.contentLike.deleteMany({ where: { userId } });
      await transaction.eventRegistration.deleteMany({ where: { userId } });
      await transaction.modelCallLog.deleteMany({ where: { userId } });
      await transaction.dataExportJob.deleteMany({ where: { userId } });
      await transaction.accountAppeal.deleteMany({ where: { userId } });
      await transaction.onboardingDraft.deleteMany({ where: { userId } });
      await transaction.profile.deleteMany({ where: { userId } });
      await transaction.photo.deleteMany({ where: { userId } });
      await transaction.session.deleteMany({ where: { userId } });
      await transaction.otpRequest.deleteMany({ where: { OR: [{ userId }, { phoneHash: { in: compatibleHashes(originalUser.phone, this.encryptionSecret) } }] } });
      await transaction.user.update({
        where: { id: userId },
        data: {
          phoneHash: keyedHash(deletedUser.phone, this.encryptionSecret),
          phoneEncrypted: null,
          phoneVerified: false,
          role: "USER",
          status: "DELETED",
          suspensionSource: null,
          deletionRequestedAt: null,
          deletionScheduledAt: null,
        },
      });
    });
  }

  async persistProfile(profile: StoredProfile) {
    const extendedData = { preference: profile.preference, onboardingAnswersCiphertext: encrypt(JSON.stringify(profile.answers), this.encryptionSecret), onboardingAnswersVersion: 1, onboardingDraftStatus: "SUBMITTED" as const, onboardingCompletedAt: new Date() };
    const profileStatus = mapProfileStatus(profile.profileStatus);
    const visibility = profile.visibility === "private" ? "PRIVATE" : profile.visibility === "public" ? "PUBLIC" : "APPROVED_ONLY";
    await this.client.profile.upsert({ where: { userId: profile.userId }, update: { nickname: profile.nickname, gender: mapGender(profile.gender) as never, birthYear: profile.birthYear, city: profile.city, district: profile.district || null, jobCategory: profile.job || null, maritalStatus: mapMaritalStatus(profile.maritalStatus) as never, goal: mapGoal(profile.goal) as never, introduction: profile.introduction, profileStatus, visibility, reviewReason: profile.reviewReason ?? null, ...extendedData }, create: { userId: profile.userId, nickname: profile.nickname, gender: mapGender(profile.gender) as never, birthYear: profile.birthYear, city: profile.city, district: profile.district || null, jobCategory: profile.job || null, maritalStatus: mapMaritalStatus(profile.maritalStatus) as never, goal: mapGoal(profile.goal) as never, introduction: profile.introduction, profileStatus, visibility, reviewReason: profile.reviewReason ?? null, ...extendedData } });
  }

  async persistProfileSubmission(profile: StoredProfile, avatarProfile?: StoredAvatarProfile, draft?: StoredOnboardingDraft) {
    const extendedData = { preference: profile.preference, onboardingAnswersCiphertext: encrypt(JSON.stringify(profile.answers), this.encryptionSecret), onboardingAnswersVersion: 1, onboardingDraftStatus: "SUBMITTED" as const, onboardingCompletedAt: new Date() };
    const profileStatus = mapProfileStatus(profile.profileStatus);
    await this.client.$transaction(async (transaction) => {
      const visibility = profile.visibility === "private" ? "PRIVATE" : profile.visibility === "public" ? "PUBLIC" : "APPROVED_ONLY";
      await transaction.profile.upsert({ where: { userId: profile.userId }, update: { nickname: profile.nickname, gender: mapGender(profile.gender) as never, birthYear: profile.birthYear, city: profile.city, district: profile.district || null, jobCategory: profile.job || null, maritalStatus: mapMaritalStatus(profile.maritalStatus) as never, goal: mapGoal(profile.goal) as never, introduction: profile.introduction, profileStatus, visibility, reviewReason: profile.reviewReason ?? null, ...extendedData }, create: { userId: profile.userId, nickname: profile.nickname, gender: mapGender(profile.gender) as never, birthYear: profile.birthYear, city: profile.city, district: profile.district || null, jobCategory: profile.job || null, maritalStatus: mapMaritalStatus(profile.maritalStatus) as never, goal: mapGoal(profile.goal) as never, introduction: profile.introduction, profileStatus, visibility, reviewReason: profile.reviewReason ?? null, ...extendedData } });
      if (avatarProfile) {
        await transaction.profile.update({ where: { userId: avatarProfile.userId }, data: { aiConsentStatus: "PAUSED" } });
      }
      if (draft) await transaction.onboardingDraft.upsert(onboardingDraftUpsertArgs(draft, this.encryptionSecret));
    });
  }

  async persistOtpRequest(request: StoredOtpRequest) {
    await this.client.otpRequest.create({ data: { phoneHash: keyedHash(request.phone, this.encryptionSecret), codeHash: keyedHash(request.code, this.encryptionSecret), purpose: "LOGIN", expiresAt: new Date(request.expiresAt) } });
  }

  async verifyOtp(phone: string, code: string) {
    const [currentPhoneHash, legacyPhoneHash] = compatibleHashes(phone, this.encryptionSecret);
    const conditions = { usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } };
    let request = await this.client.otpRequest.findFirst({ where: { phoneHash: currentPhoneHash, ...conditions }, orderBy: { createdAt: "desc" } });
    if (!request) request = await this.client.otpRequest.findFirst({ where: { phoneHash: legacyPhoneHash, ...conditions }, orderBy: { createdAt: "desc" } });
    if (!request) return false;
    if (!compatibleHashes(code, this.encryptionSecret).includes(request.codeHash)) {
      const attempts = request.attempts + 1;
      await this.client.otpRequest.update({ where: { id: request.id }, data: { attempts, ...(attempts >= 5 ? { usedAt: new Date() } : {}) } });
      return false;
    }
    await this.client.otpRequest.update({ where: { id: request.id }, data: { usedAt: new Date(), attempts: { increment: 1 } } });
    return true;
  }

  async deleteOtpRequest(phone: string) {
    await this.client.otpRequest.updateMany({ where: { phoneHash: { in: compatibleHashes(phone, this.encryptionSecret) }, usedAt: null }, data: { usedAt: new Date() } });
  }

  async persistSession(token: string, session: StoredSession) {
    await this.client.session.create({ data: { id: session.id, userId: session.userId, refreshTokenHash: keyedHash(token, this.encryptionSecret), userAgent: session.userAgent || null, createdAt: toDate(session.createdAt), lastUsedAt: toDate(session.lastUsedAt), expiresAt: new Date(session.expiresAt) } });
  }

  async persistSessionActivity(token: string, lastUsedAt: string) {
    await this.client.session.updateMany({
      where: { refreshTokenHash: { in: compatibleHashes(token, this.encryptionSecret) }, revokedAt: null },
      data: { lastUsedAt: toDate(lastUsedAt) },
    });
  }

  async findUserIdBySessionToken(token: string) {
    const [currentHash, legacyHash] = compatibleHashes(token, this.encryptionSecret);
    let session = await this.client.session.findFirst({ where: { refreshTokenHash: currentHash, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (!session) session = await this.client.session.findFirst({ where: { refreshTokenHash: legacyHash, revokedAt: null, expiresAt: { gt: new Date() } } });
    return session?.userId;
  }

  async findUserIdByRestrictedSessionToken(token: string) {
    for (const refreshTokenHash of compatibleHashes(token, this.encryptionSecret)) {
      const session = await this.client.session.findFirst({
        include: { user: true },
        where: {
          refreshTokenHash,
          revokedAt: { not: null },
          expiresAt: { gt: new Date() },
        },
      });
      if (!session) continue;
      const revokedAt = session.revokedAt?.getTime() ?? 0;
      const suspendedAt = session.user.updatedAt.getTime();
      if (session.user.status === "SUSPENDED"
        && session.user.suspensionSource === "ADMIN"
        && revokedAt >= suspendedAt) return session.userId;
    }
    return undefined;
  }

  async deleteSession(token: string) {
    await this.client.session.updateMany({ where: { refreshTokenHash: { in: compatibleHashes(token, this.encryptionSecret) }, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async deleteSessionById(sessionId: string, userId: string) {
    await this.client.session.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async deleteUserSessions(userId: string, exceptSessionId?: string) {
    await this.client.session.updateMany({ where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) }, data: { revokedAt: new Date() } });
  }

  async listSessions(userId: string, currentToken?: string) {
    const sessions = await this.client.session.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    const currentHashes = currentToken ? compatibleHashes(currentToken, this.encryptionSecret) : [];
    return sessions.map((session) => ({ id: session.id, userId: session.userId, expiresAt: session.expiresAt.getTime(), userAgent: session.userAgent ?? "未知设备", createdAt: session.createdAt.toISOString(), lastUsedAt: session.lastUsedAt?.toISOString() ?? session.createdAt.toISOString(), current: currentHashes.includes(session.refreshTokenHash) }));
  }

  async persistOnboardingDraft(draft: StoredOnboardingDraft) {
    await this.client.onboardingDraft.upsert(onboardingDraftUpsertArgs(draft, this.encryptionSecret));
  }

  async persistProfileVisibility(userId: string, visibility: NonNullable<StoredProfile["visibility"]>) {
    await this.client.profile.update({ where: { userId }, data: { visibility: visibility === "private" ? "PRIVATE" : visibility === "public" ? "PUBLIC" : "APPROVED_ONLY" } });
  }

  async persistAccountAppeal(appeal: StoredAccountAppeal) {
    const status = appeal.status === "reviewing" ? "REVIEWING" : appeal.status === "approved" ? "APPROVED" : appeal.status === "rejected" ? "REJECTED" : "PENDING";
    await this.client.accountAppeal.upsert({ where: { id: appeal.id }, update: { reason: appeal.reason, evidence: appeal.evidence, status, resolution: appeal.resolution }, create: { id: appeal.id, userId: appeal.userId, reason: appeal.reason, evidence: appeal.evidence, status, resolution: appeal.resolution, createdAt: toDate(appeal.createdAt), updatedAt: toDate(appeal.updatedAt) } });
  }

  async persistDataExport(exportJob: StoredDataExport) {
    const status = exportJob.status === "ready" ? DataExportStatus.READY : exportJob.status === "failed" ? DataExportStatus.FAILED : exportJob.status === "expired" ? DataExportStatus.EXPIRED : DataExportStatus.PENDING;
    const data = { status, payloadCiphertext: exportJob.payload ? encrypt(JSON.stringify(exportJob.payload), this.encryptionSecret) : null, readyAt: exportJob.readyAt ? toDate(exportJob.readyAt) : null, expiresAt: exportJob.expiresAt ? toDate(exportJob.expiresAt) : null };
    await this.client.dataExportJob.upsert({ where: { id: exportJob.id }, update: data, create: { id: exportJob.id, userId: exportJob.userId, createdAt: toDate(exportJob.createdAt), ...data } });
  }

  async persistAdminAuditLog(entry: StoredAdminAuditLog) {
    await this.client.adminAuditLog.upsert({
      where: { id: entry.id },
      update: { action: entry.action, targetType: entry.targetType, targetId: entry.targetId, reason: entry.reason, metadata: entry.metadata as never },
      create: { id: entry.id, actorUserId: entry.actorUserId, action: entry.action, targetType: entry.targetType, targetId: entry.targetId, reason: entry.reason, metadata: entry.metadata as never, createdAt: toDate(entry.createdAt) },
    });
  }

  async persistMaintenanceRun(run: StoredMaintenanceRun) {
    const status = run.status === "succeeded" ? "SUCCEEDED" : run.status === "failed" ? "FAILED" : "RUNNING";
    await this.client.maintenanceRun.upsert({
      where: { id: run.id },
      update: { status, result: { totalRemoved: run.totalRemoved, results: run.results } as never, finishedAt: run.finishedAt === null ? null : new Date(run.finishedAt) },
      create: { id: run.id, task: run.taskName, status, triggeredBy: run.actorId, result: { totalRemoved: run.totalRemoved, results: run.results } as never, startedAt: new Date(run.startedAt), finishedAt: run.finishedAt === null ? null : new Date(run.finishedAt) },
    });
  }

  async persistInterest(interest: StoredInterest) {
    const member = this.store && [...this.store.members.values()].find((candidate) => candidate.id === interest.memberId);
    if (!member?.ownerUserId) return;
    await this.client.interest.upsert(interestUpsertArgs(interest, member.ownerUserId));
  }

  async persistPendingInterestFulfillment(interest: StoredInterest, draft: StoredOnboardingDraft, notification: StoredNotification) {
    const member = this.store && [...this.store.members.values()].find((candidate) => candidate.id === interest.memberId);
    if (!member?.ownerUserId) throw new Error("Pending interest target has no persisted user ID");
    const targetUserId = member.ownerUserId;
    return this.client.$transaction(async (transaction) => {
      const savedInterest = await transaction.interest.upsert(interestUpsertArgs(interest, targetUserId));
      await transaction.onboardingDraft.upsert(onboardingDraftUpsertArgs(draft, this.encryptionSecret));
      const stableNotification = { ...notification, id: savedInterest.id, relatedResourceId: targetUserId };
      const savedNotification = await transaction.notification.upsert(notificationUpsertArgs(stableNotification));
      return {
        interest: storedInterestFromRow(savedInterest, interest.memberId),
        notification: storedNotificationFromRow(savedNotification),
      };
    });
  }

  async persistInterestCancellation(interest: StoredInterest | null, draft: StoredOnboardingDraft) {
    const member = interest && this.store && [...this.store.members.values()].find((candidate) => candidate.id === interest.memberId);
    if (interest && !member?.ownerUserId) throw new Error("Interest target has no persisted user ID");
    await this.client.$transaction(async (transaction) => {
      if (interest && member?.ownerUserId) await transaction.interest.upsert(interestUpsertArgs(interest, member.ownerUserId));
      await transaction.onboardingDraft.upsert(onboardingDraftUpsertArgs(draft, this.encryptionSecret));
    });
  }

  async persistMatchSkip(skip: StoredMatchSkip) {
    await this.client.matchSkip.upsert({ where: { userId_targetUserId: { userId: skip.userId, targetUserId: skip.targetUserId } }, update: {}, create: { id: skip.id, userId: skip.userId, targetUserId: skip.targetUserId, createdAt: toDate(skip.createdAt) } });
  }

  async deleteMatchSkip(userId: string, targetUserId: string) {
    await this.client.matchSkip.deleteMany({ where: { userId, targetUserId } });
  }

  async persistMatchFilter(filter: StoredMatchFilter) {
    await this.client.$transaction(async (transaction) => {
      if (filter.isDefault) await transaction.savedMatchFilter.updateMany({ where: { userId: filter.userId, isDefault: true }, data: { isDefault: false } });
      await transaction.savedMatchFilter.upsert({ where: { id: filter.id }, update: { name: filter.name, criteria: filter.criteria as never, isDefault: filter.isDefault, updatedAt: toDate(filter.updatedAt) }, create: { id: filter.id, userId: filter.userId, name: filter.name, criteria: filter.criteria as never, isDefault: filter.isDefault, createdAt: toDate(filter.createdAt), updatedAt: toDate(filter.updatedAt) } });
    });
  }

  async persistMatchSnapshot(snapshot: StoredMatchSnapshot) {
    await this.client.matchSnapshot.create({ data: { id: snapshot.id, userId: snapshot.userId, targetUserId: snapshot.targetUserId, algorithmVersion: snapshot.algorithmVersion, score: snapshot.score, reasons: snapshot.reasons, factors: snapshot.factors, createdAt: toDate(snapshot.createdAt) } });
  }

  async deleteMatchFilter(filterId: string, userId: string) {
    await this.client.savedMatchFilter.deleteMany({ where: { id: filterId, userId } });
  }

  async persistAvatarSession(session: StoredAvatarSession) {
    const member = this.store && [...this.store.members.values()].find((candidate) => candidate.id === session.memberId);
    if (!member?.ownerUserId) return;
    await this.client.avatarConversation.upsert({ where: { id: session.id }, update: { status: session.status === "paused" ? "BLOCKED" : "ACTIVE", completedTopics: session.completedTopics, updatedAt: toDate(session.updatedAt) }, create: { id: session.id, userId: session.userId, targetUserId: member.ownerUserId, status: "ACTIVE", completedTopics: session.completedTopics, createdAt: toDate(session.createdAt), updatedAt: toDate(session.updatedAt) } });
  }

  async persistAvatarMessages(messages: StoredAvatarMessage[]) {
    for (const message of messages) await this.client.avatarMessage.create({ data: avatarMessageCreateData(message, this.encryptionSecret) });
  }

  async persistAvatarReplySuccess(session: StoredAvatarSession, avatarMessage: StoredAvatarMessage, targetUserId?: string) {
    await this.client.$transaction(async (transaction) => {
      await transaction.avatarMessage.create({ data: avatarMessageCreateData(avatarMessage, this.encryptionSecret) });
      if (targetUserId) {
        await transaction.avatarConversation.upsert({
          where: { id: session.id },
          update: { status: session.status === "paused" ? "BLOCKED" : "ACTIVE", completedTopics: session.completedTopics, updatedAt: toDate(session.updatedAt) },
          create: { id: session.id, userId: session.userId, targetUserId, status: session.status === "paused" ? "BLOCKED" : "ACTIVE", completedTopics: session.completedTopics, createdAt: toDate(session.createdAt), updatedAt: toDate(session.updatedAt) },
        });
      }
    });
  }

  async persistAvatarReplyFailureTask(task: StoredAvatarReplyFailureTask) {
    await this.client.avatarReplyFailureTask.upsert(avatarReplyFailureTaskUpsertArgs(task));
  }

  async resolveAvatarReplyFailureTask(task: StoredAvatarReplyFailureTask, avatarMessage: StoredAvatarMessage, session: StoredAvatarSession, targetUserId?: string) {
    await this.client.$transaction(async (transaction) => {
      await transaction.avatarMessage.create({ data: avatarMessageCreateData(avatarMessage, this.encryptionSecret) });
      await transaction.avatarReplyFailureTask.upsert(avatarReplyFailureTaskUpsertArgs(task));
      if (targetUserId) {
        await transaction.avatarConversation.upsert({
          where: { id: session.id },
          update: { status: session.status === "paused" ? "BLOCKED" : "ACTIVE", completedTopics: session.completedTopics, updatedAt: toDate(session.updatedAt) },
          create: { id: session.id, userId: session.userId, targetUserId, status: session.status === "paused" ? "BLOCKED" : "ACTIVE", completedTopics: session.completedTopics, createdAt: toDate(session.createdAt), updatedAt: toDate(session.updatedAt) },
        });
      }
    });
  }

  async persistChatRequest(request: StoredChatRequest) {
    const status = mapChatRequestStatusBack(request.status);
    const expiresAt = request.expiresAt ? toDate(request.expiresAt) : null;
    await this.client.chatRequest.upsert({
      where: { requesterId_targetUserId: { requesterId: request.fromUserId, targetUserId: request.toUserId } },
      update: { status, sourceAvatarConversationId: request.avatarSessionId || null, expiresAt, updatedAt: toDate(request.updatedAt) },
      create: { id: request.id, requesterId: request.fromUserId, targetUserId: request.toUserId, sourceAvatarConversationId: request.avatarSessionId || null, status, expiresAt, createdAt: toDate(request.createdAt), updatedAt: toDate(request.updatedAt) },
    });
  }

  async persistConversation(conversation: StoredConversation): Promise<StoredConversation> {
    const [userAId, userBId] = [...conversation.participantIds].sort();
    const status = conversation.status === "blocked" ? "BLOCKED" : conversation.status === "archived" ? "ARCHIVED" : "ACTIVE";
    const saved = await this.client.conversation.upsert({ where: { userAId_userBId: { userAId, userBId } }, update: { status, archivedAt: conversation.archivedAt ? toDate(conversation.archivedAt) : null }, create: { id: conversation.id, chatRequestId: conversation.chatRequestId || null, userAId, userBId, status, archivedAt: conversation.archivedAt ? toDate(conversation.archivedAt) : null, createdAt: toDate(conversation.createdAt) } });
    return { ...conversation, id: saved.id };
  }

  async persistAcceptedChatRequest(request: StoredChatRequest, conversation: StoredConversation): Promise<StoredConversation> {
    const [userAId, userBId] = [...conversation.participantIds].sort();
    return this.client.$transaction(async (transaction) => {
      await transaction.chatRequest.upsert({ where: { requesterId_targetUserId: { requesterId: request.fromUserId, targetUserId: request.toUserId } }, update: { status: "ACCEPTED", sourceAvatarConversationId: request.avatarSessionId || null, expiresAt: request.expiresAt ? toDate(request.expiresAt) : null, updatedAt: toDate(request.updatedAt) }, create: { id: request.id, requesterId: request.fromUserId, targetUserId: request.toUserId, sourceAvatarConversationId: request.avatarSessionId || null, status: "ACCEPTED", expiresAt: request.expiresAt ? toDate(request.expiresAt) : null, createdAt: toDate(request.createdAt), updatedAt: toDate(request.updatedAt) } });
      const saved = await transaction.conversation.upsert({ where: { userAId_userBId: { userAId, userBId } }, update: { status: "ACTIVE" }, create: { id: conversation.id, chatRequestId: conversation.chatRequestId || null, userAId, userBId, status: "ACTIVE", createdAt: toDate(conversation.createdAt) } });
      return { ...conversation, id: saved.id };
    });
  }

  async persistMessage(message: StoredMessage) {
    if (message.clientMessageId) {
      const saved = await this.client.message.upsert({ where: { conversationId_senderId_clientMessageId: { conversationId: message.conversationId, senderId: message.senderId, clientMessageId: message.clientMessageId } }, update: {}, create: { id: message.id, conversationId: message.conversationId, senderId: message.senderId || null, contentCiphertext: encrypt(message.text, this.encryptionSecret), clientMessageId: message.clientMessageId, moderationStatus: "APPROVED", sentAt: toDate(message.createdAt), createdAt: toDate(message.createdAt) } });
      return { id: saved.id, conversationId: saved.conversationId, senderId: saved.senderId ?? "", text: saved.deletedAt ? "此消息已撤回" : decrypt(saved.contentCiphertext, this.encryptionSecret), clientMessageId: saved.clientMessageId, deletedAt: saved.deletedAt?.toISOString() ?? null, createdAt: saved.createdAt.toISOString() } satisfies StoredMessage;
    }
    const saved = await this.client.message.create({ data: { id: message.id, conversationId: message.conversationId, senderId: message.senderId || null, contentCiphertext: encrypt(message.text, this.encryptionSecret), moderationStatus: "APPROVED", sentAt: toDate(message.createdAt), createdAt: toDate(message.createdAt) } });
    return { id: saved.id, conversationId: saved.conversationId, senderId: saved.senderId ?? "", text: message.text, clientMessageId: saved.clientMessageId, deletedAt: null, createdAt: saved.createdAt.toISOString() } satisfies StoredMessage;
  }

  async persistHumanMessageBundle(message: StoredMessage, receipt: StoredMessageReceipt, notification: StoredNotification) {
    return this.client.$transaction(async (transaction) => {
      const saved = message.clientMessageId
        ? await transaction.message.upsert({
            where: { conversationId_senderId_clientMessageId: { conversationId: message.conversationId, senderId: message.senderId, clientMessageId: message.clientMessageId } },
            update: {},
            create: { id: message.id, conversationId: message.conversationId, senderId: message.senderId || null, contentCiphertext: encrypt(message.text, this.encryptionSecret), clientMessageId: message.clientMessageId, moderationStatus: "APPROVED", sentAt: toDate(message.createdAt), createdAt: toDate(message.createdAt) },
          })
        : await transaction.message.create({ data: { id: message.id, conversationId: message.conversationId, senderId: message.senderId || null, contentCiphertext: encrypt(message.text, this.encryptionSecret), moderationStatus: "APPROVED", sentAt: toDate(message.createdAt), createdAt: toDate(message.createdAt) } });
      const persistedMessage: StoredMessage = {
        id: saved.id,
        conversationId: saved.conversationId,
        senderId: saved.senderId ?? "",
        text: saved.deletedAt ? "此消息已撤回" : decrypt(saved.contentCiphertext, this.encryptionSecret),
        clientMessageId: saved.clientMessageId,
        deletedAt: saved.deletedAt?.toISOString() ?? null,
        createdAt: saved.createdAt.toISOString(),
      };
      const persistedReceipt: StoredMessageReceipt = { ...receipt, messageId: persistedMessage.id };
      await transaction.messageReceipt.upsert({
        where: { messageId_userId: { messageId: persistedReceipt.messageId, userId: persistedReceipt.userId } },
        update: { deliveredAt: persistedReceipt.deliveredAt ? toDate(persistedReceipt.deliveredAt) : null, readAt: persistedReceipt.readAt ? toDate(persistedReceipt.readAt) : null },
        create: { id: persistedReceipt.id, messageId: persistedReceipt.messageId, userId: persistedReceipt.userId, deliveredAt: persistedReceipt.deliveredAt ? toDate(persistedReceipt.deliveredAt) : null, readAt: persistedReceipt.readAt ? toDate(persistedReceipt.readAt) : null, createdAt: toDate(persistedReceipt.createdAt) },
      });
      await transaction.notification.upsert(notificationUpsertArgs(notification));
      return { message: persistedMessage, receipt: persistedReceipt, notification };
    });
  }

  async persistMessageState(message: StoredMessage) {
    await this.client.message.update({
      where: { id: message.id },
      data: {
        contentCiphertext: encrypt(message.text, this.encryptionSecret),
        deletedAt: message.deletedAt ? toDate(message.deletedAt) : null,
      },
    });
  }

  async persistMessageReceipt(receipt: StoredMessageReceipt) {
    await this.client.messageReceipt.upsert({
      where: { messageId_userId: { messageId: receipt.messageId, userId: receipt.userId } },
      update: {
        deliveredAt: receipt.deliveredAt ? toDate(receipt.deliveredAt) : null,
        readAt: receipt.readAt ? toDate(receipt.readAt) : null,
      },
      create: {
        id: receipt.id,
        messageId: receipt.messageId,
        userId: receipt.userId,
        deliveredAt: receipt.deliveredAt ? toDate(receipt.deliveredAt) : null,
        readAt: receipt.readAt ? toDate(receipt.readAt) : null,
        createdAt: toDate(receipt.createdAt),
      },
    });
  }

  async persistPhoto(photo: StoredPhoto) {
    const reviewStatus = photo.reviewStatus === "approved" ? "APPROVED" : photo.reviewStatus === "rejected" ? "REJECTED" : "PENDING";
    await this.client.photo.upsert({ where: { id: photo.id }, update: { objectKey: photo.objectKey, url: photo.url, mimeType: photo.mimeType, sizeBytes: photo.sizeBytes, isPrimary: photo.isPrimary, reviewStatus, reviewReason: photo.reviewReason, updatedAt: toDate(photo.updatedAt) }, create: { id: photo.id, userId: photo.userId, objectKey: photo.objectKey, url: photo.url, mimeType: photo.mimeType, sizeBytes: photo.sizeBytes, isPrimary: photo.isPrimary, reviewStatus, reviewReason: photo.reviewReason, uploadedAt: toDate(photo.createdAt), createdAt: toDate(photo.createdAt), updatedAt: toDate(photo.updatedAt) } });
  }

  async deletePhoto(photoId: string) {
    await this.client.photo.deleteMany({ where: { id: photoId } });
  }

  async persistAvatarProfile(profile: StoredAvatarProfile) {
    const consentStatus = profile.status === "enabled" ? "ENABLED" : profile.status === "paused" ? "PAUSED" : profile.status === "revoked" ? "REVOKED" : "PENDING";
    await this.client.profile.update({ where: { userId: profile.userId }, data: { aiProfileVersion: profile.version, aiProfileSummary: { approvedFacts: profile.approvedFacts, relationshipExpectations: profile.relationshipExpectations, boundaries: profile.boundaries, unknownResponse: profile.unknownResponse }, aiForbiddenTopics: profile.boundaries, aiConsentStatus: consentStatus, aiGeneratedAt: toDate(profile.generatedAt), aiApprovedAt: profile.enabledAt ? toDate(profile.enabledAt) : null } });
  }

  async persistNotification(notification: StoredNotification) {
    await this.client.notification.upsert(notificationUpsertArgs(notification));
  }

  async persistReport(report: StoredReport) {
    const status = report.status === "resolved" ? "RESOLVED" : report.status === "dismissed" ? "DISMISSED" : "PENDING";
    const evidence = { targetAvatarConversationId: report.targetAvatarSessionId, targetConversationId: report.targetConversationId, targetMessageId: report.targetConversationId ? report.targetMessageId : null };
    await this.client.report.upsert({ where: { id: report.id }, update: { status, resolution: report.resolution, resolvedByUserId: report.resolvedByUserId, ...evidence, updatedAt: toDate(report.updatedAt) }, create: { id: report.id, reporterUserId: report.reporterUserId, targetUserId: report.targetUserId, reason: report.reason, description: report.description, status, resolution: report.resolution, resolvedByUserId: report.resolvedByUserId, ...evidence, createdAt: toDate(report.createdAt), updatedAt: toDate(report.updatedAt) } });
  }

  async persistBlockState(block: StoredBlock) {
    const [userAId, userBId] = [block.blockerUserId, block.blockedUserId].sort();
    await this.client.$transaction([
      this.client.block.upsert({ where: { blockerUserId_blockedUserId: { blockerUserId: block.blockerUserId, blockedUserId: block.blockedUserId } }, update: {}, create: { id: block.id, blockerUserId: block.blockerUserId, blockedUserId: block.blockedUserId, createdAt: toDate(block.createdAt) } }),
      this.client.conversation.updateMany({ where: { userAId, userBId }, data: { status: "BLOCKED" } }),
    ]);
  }

  async deleteBlockState(blockerUserId: string, blockedUserId: string) {
    const [userAId, userBId] = [blockerUserId, blockedUserId].sort();
    await this.client.$transaction(async (transaction) => {
      await transaction.block.deleteMany({ where: { blockerUserId, blockedUserId } });
      const remaining = await transaction.block.count({
        where: {
          OR: [
            { blockerUserId, blockedUserId },
            { blockerUserId: blockedUserId, blockedUserId: blockerUserId },
          ],
        },
      });
      if (remaining === 0) await transaction.conversation.updateMany({ where: { userAId, userBId }, data: { status: "ACTIVE" } });
    });
  }

  async close() {
    await this.client.$disconnect();
  }
}

export function createPrismaStore(databaseUrl: string, encryptionSecret: string) {
  return new PrismaStore(databaseUrl, encryptionSecret);
}
