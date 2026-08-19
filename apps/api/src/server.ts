import cors from "@fastify/cors";
import Fastify from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { relationshipQuestions, soulTestQuestions, personalityTypes, dailyTasks, vipPlans } from "@ai-marriage/shared";
import { getConfig, type AppConfig } from "./config.js";
import { createProviders, type PlatformProviders } from "./providers/index.js";
import { ContentActivityService, ContentDomainError, type ContentActor, type ContentItem, type PublicContentFilters } from "./content/index.js";
import { AvatarKnowledgeError, InMemoryAvatarKnowledgeService } from "./avatar-knowledge/index.js";
import { ALGORITHM_VERSION, MatchFilterValidationError, matchCandidates, parseMatchFilters, type MatchProfile, type MatchResult } from "./matching/index.js";
import { paginateByStableId, StableCursorError } from "./matching/pagination.js";
import { parsePublicMemberSearchQuery, publicMemberCursorKey, PublicMemberSearchError, searchPublicMembers } from "./matching/public-search.js";
import { findIncompleteLobbyOwner, listIncompleteLobbyMembers } from "./matching/lobby-members.js";
import { cleanupExpiredAccount, createExpiredResourceCleanupPlan, OperationsCenter, registerOperationsHooks } from "./operations/index.js";
import { PresenceTracker, RealtimeEventCenter } from "./realtime/index.js";
import { createId, createMemoryStore, createPrismaStore } from "./store/index.js";
import type {
  Store,
  StoredAvatarMessage,
  StoredAvatarReplyFailureTask,
  StoredAvatarSession,
  StoredAvatarProfile,
  StoredBlock,
  StoredChatRequest,
  StoredConversation,
  StoredMember,
  StoredNotification,
  StoredPhoto,
  StoredProfile,
  StoredReport,
  StoredMessage,
  StoredMessageReceipt,
  StoredOnboardingDraft,
  StoredAccountAppeal,
  StoredDataExport,
  StoredSession,
  StoredUser,
  StoredAdminAuditLog,
  StoredMaintenanceRun,
  StoredMatchSnapshot,
} from "./store/index.js";

interface BuildServerOptions extends Partial<AppConfig> {
  store?: Store;
  providers?: Partial<PlatformProviders>;
  realtimeEventCenter?: RealtimeEventCenter;
  realtimeHeartbeatMs?: number;
  contentService?: ContentActivityService;
  avatarKnowledgeService?: InMemoryAvatarKnowledgeService;
  operationsCenter?: OperationsCenter;
}

const phonePattern = /^1[3-9]\d{9}$/;
const OTP_SEND_COOLDOWN_MS = 60_000;
const OTP_IP_WINDOW_MS = 10 * 60_000;
const OTP_IP_MAX_REQUESTS = 20;
const OTP_MAX_ATTEMPTS = 5;
const MIN_CHAT_COMPATIBILITY_SCORE = 70;
const AVATAR_MESSAGE_WINDOW_MS = 10 * 60_000;
const AVATAR_MESSAGE_WINDOW_LIMIT = 20;
const HUMAN_MESSAGE_WINDOW_MS = 60_000;
const HUMAN_MESSAGE_WINDOW_LIMIT = 30;
const CHAT_REQUEST_TTL_MS = 7 * 24 * 60 * 60_000;
const MESSAGE_RECALL_WINDOW_MS = 2 * 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_MESSAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const FINANCIAL_RISK_PATTERN = /银行卡|银行卡号|卡号|转账|汇款|保证金|打款|收款码|借钱|垫付|充值|提现/;
const MOMENT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_MOMENT_IMAGES = 9;
const MAX_MOMENT_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_MOMENT_IMAGES_TOTAL_BYTES = 32 * 1024 * 1024;

interface MomentImageUploadBody {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  data: Buffer;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePhone(value: unknown): string | null {
  const phone = typeof value === "string" ? value.trim() : "";
  return phonePattern.test(phone) ? phone : null;
}

function maskPhone(phone: string) {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const index = part.indexOf("=");
      if (index < 0) return [];
      return [[part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]];
    }),
  );
}

function setRefreshCookie(reply: { header: (name: string, value: string) => unknown }, token: string, secure: boolean) {
  const attributes = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=2592000"];
  if (secure) attributes.push("Secure");
  reply.header("Set-Cookie", `refresh_token=${encodeURIComponent(token)}; ${attributes.join("; ")}`);
}

function clearRefreshCookie(reply: { header: (name: string, value: string) => unknown }, secure: boolean) {
  const attributes = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) attributes.push("Secure");
  reply.header("Set-Cookie", `refresh_token=; ${attributes.join("; ")}`);
}

function adminAccessCookie(token: string, secure: boolean, maxAgeSeconds: number) {
  const attributes = ["Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSeconds}`];
  if (secure) attributes.push("Secure");
  return `admin_access=${encodeURIComponent(token)}; ${attributes.join("; ")}`;
}

function clearedAdminAccessCookie(secure: boolean) {
  return adminAccessCookie("", secure, 0);
}

function error(code: string, message: string) {
  return { error: { code, message } };
}

function readStringRecord(value: unknown, limits: { entries: number; key: number; value: number }) {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > limits.entries) return null;
  const result: Record<string, string> = {};
  for (const [key, entryValue] of entries) {
    if (key.length > limits.key || typeof entryValue !== "string" || entryValue.length > limits.value) return null;
    result[key] = entryValue;
  }
  return result;
}

function publicMember(member: StoredMember, store?: Store) {
  const soulResult = store && member.ownerUserId ? store.soulTestResults.get(member.ownerUserId) ?? null : null;
  return {
    id: member.id,
    demo: member.demo === true,
    nickname: member.nickname,
    gender: member.gender,
    age: member.age,
    city: member.city,
    district: member.district,
    job: member.job,
    maritalStatus: member.maritalStatus,
    goal: member.goal,
    tags: member.tags,
    introduction: member.introduction,
    photoUrl: member.photoUrl,
    photoUrls: member.photoUrls?.length ? member.photoUrls : [member.photoUrl],
    activeLabel: member.activeLabel,
    smokingStatus: member.smokingStatus,
    childrenStatus: member.childrenStatus,
    joinedAt: member.joinedAt,
    lastActiveAt: member.lastActiveAt,
    voiceIntroUrl: (member as StoredMember & { voiceIntroUrl?: string | null }).voiceIntroUrl ?? null,
    voiceIntroTranscript: (member as StoredMember & { voiceIntroTranscript?: string | null }).voiceIntroTranscript ?? null,
    voiceIntroDuration: (member as StoredMember & { voiceIntroDuration?: number | null }).voiceIntroDuration ?? null,
    verified: member.verified,
    userId: member.ownerUserId,
    lobbyStatus: "verified" as const,
    soulTestResult: soulResult ? {
      personalityType: soulResult.personalityType,
      personalityLabel: soulResult.personalityLabel,
      personalityDescription: soulResult.personalityDescription,
      tags: soulResult.tags,
      matchHint: soulResult.matchHint,
      dimensions: soulResult.dimensions.map((d) => ({
        dimension: d.dimension,
        dimensionLabel: d.dimensionLabel,
        labelA: d.labelA,
        labelB: d.labelB,
        score: d.score,
        polarity: d.polarity,
      })),
    } : null,
  };
}

function photoMatchesMimeType(data: Buffer, mimeType: string) {
  if (mimeType === "image/png") {
    return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg") {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function filenameMatchesMimeType(filename: string, mimeType: string) {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (mimeType === "image/jpeg") return extension === "jpg" || extension === "jpeg";
  if (mimeType === "image/png") return extension === "png";
  if (mimeType === "image/webp") return extension === "webp";
  return false;
}

function parseMomentImages(value: unknown): MomentImageUploadBody[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MOMENT_IMAGES) return null;
  const parsed: MomentImageUploadBody[] = [];
  let totalBytes = 0;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const candidate = item as Record<string, unknown>;
    const filename = typeof candidate.filename === "string" ? candidate.filename.trim() : "";
    const mimeType = typeof candidate.mimeType === "string" ? candidate.mimeType : "";
    const sizeBytes = Number(candidate.sizeBytes);
    const dataUrl = typeof candidate.dataUrl === "string" ? candidate.dataUrl : "";
    if (!filename || !MOMENT_IMAGE_TYPES.has(mimeType) || !filenameMatchesMimeType(filename, mimeType)
      || !Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_MOMENT_IMAGE_BYTES
      || !dataUrl.startsWith(`data:${mimeType};base64,`)) return null;
    const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const data = Buffer.from(encoded, "base64");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || data.length !== sizeBytes || !photoMatchesMimeType(data, mimeType)) return null;
    totalBytes += data.length;
    if (totalBytes > MAX_MOMENT_IMAGES_TOTAL_BYTES) return null;
    parsed.push({ filename, mimeType, sizeBytes, data });
  }
  return parsed;
}

function momentImageUrl(objectKey: string) {
  return `/api/content-images/${Buffer.from(objectKey, "utf8").toString("base64url")}`;
}

function reserveMomentObjectKey(userId: string, mimeType: string) {
  const extension = mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/png" ? ".png" : ".webp";
  return `moments/${userId}/${randomUUID()}${extension}`;
}

function momentObjectKeyFromUrl(url: string): string | null {
  const prefix = "/api/content-images/";
  if (!url.startsWith(prefix)) return null;
  const encoded = url.slice(prefix.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const key = Buffer.from(encoded, "base64url").toString("utf8");
    return key && momentImageUrl(key) === url ? key : null;
  } catch {
    return null;
  }
}

const supportedGenders = new Set(["男性", "女性", "男", "女"]);
const supportedMaritalStatuses = new Set(["未婚", "离异", "丧偶"]);
const supportedRelationshipGoals = new Set(["认真交往", "以结婚为目标", "先认识了解"]);

function publicUser(user: StoredUser) {
  return {
    id: user.id,
    phoneMasked: maskPhone(user.phone),
    role: user.role,
    status: user.status,
    suspensionSource: user.suspensionSource ?? null,
    deletionRequestedAt: user.deletionRequestedAt ?? null,
    deletionScheduledAt: user.deletionScheduledAt ?? null,
  };
}

function publicProfile(profile: StoredProfile | undefined) {
  if (!profile) return null;
  return { ...profile };
}

function publicModerationProfile(profile: StoredProfile) {
  const { answers: _answers, preference: _preference, ...visible } = profile;
  return visible;
}

function adminReportParty(store: Store, userId: string) {
  const profile = store.profiles.get(userId);
  return {
    userId,
    nickname: profile?.nickname ?? null,
    city: profile?.city ?? null,
  };
}

function adminReportEvidence(store: Store, report: StoredReport) {
  if (report.targetConversationId) {
    const conversation = store.conversations.get(report.targetConversationId);
    const validConversation = conversation?.participantIds.includes(report.reporterUserId)
      && conversation.participantIds.includes(report.targetUserId);
    const targetMessages = validConversation
      ? [...store.messages.values()]
        .filter((message) => message.conversationId === report.targetConversationId && message.senderId === report.targetUserId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      : [];
    const selectedMessages = report.targetMessageId
      ? targetMessages.filter((message) => message.id === report.targetMessageId)
      : targetMessages.slice(-5);
    return {
      source: "human_message" as const,
      avatarSessionId: null,
      conversationId: report.targetConversationId,
      messageId: report.targetMessageId,
      messages: selectedMessages.map((message) => ({ id: message.id, sender: "target" as const, text: message.text, createdAt: message.createdAt })),
    };
  }

  if (report.targetAvatarSessionId) {
    const session = store.avatarSessions.get(report.targetAvatarSessionId);
    const member = session ? store.members.get(session.memberId) : undefined;
    const validSession = session?.userId === report.reporterUserId && member?.ownerUserId === report.targetUserId;
    const messages = validSession
      ? [...store.avatarMessages.values()]
        .filter((message) => message.sessionId === report.targetAvatarSessionId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(-5)
      : [];
    return {
      source: "avatar_session" as const,
      avatarSessionId: report.targetAvatarSessionId,
      conversationId: null,
      messageId: report.targetMessageId,
      messages: messages.map((message) => ({ id: message.id, sender: message.sender === "user" ? "reporter" as const : "avatar" as const, text: message.text, createdAt: message.createdAt })),
    };
  }

  return {
    source: "none" as const,
    avatarSessionId: null,
    conversationId: null,
    messageId: null,
    messages: [],
  };
}

function adminReport(store: Store, report: StoredReport) {
  return {
    ...report,
    reporter: adminReportParty(store, report.reporterUserId),
    target: adminReportParty(store, report.targetUserId),
    evidence: adminReportEvidence(store, report),
  };
}

function profileMemberId(userId: string) {
  return `member-${userId}`;
}

function tagsFromProfile(profile: StoredProfile) {
  const qualities = profile.preference.valuedQualities ?? "";
  return qualities.split(/[、,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 3);
}

function toMatchProfile(storedProfile: StoredProfile): MatchProfile {
  return {
    userId: storedProfile.userId,
    gender: storedProfile.gender,
    birthYear: storedProfile.birthYear,
    city: storedProfile.city,
    maritalStatus: storedProfile.maritalStatus,
    goal: storedProfile.goal,
    tags: tagsFromProfile(storedProfile),
    preference: storedProfile.preference,
  };
}

function memberMatchProfile(store: Store, member: StoredMember): MatchProfile {
  const storedProfile = member.ownerUserId ? store.profiles.get(member.ownerUserId) : undefined;
  return storedProfile ? toMatchProfile(storedProfile) : {
    userId: member.ownerUserId ?? member.id,
    gender: member.gender,
    birthYear: new Date().getFullYear() - member.age,
    city: member.city,
    maritalStatus: member.maritalStatus,
    goal: member.goal,
    tags: member.tags,
  };
}

function matchFor(store: Store, userId: string, member: StoredMember): MatchResult | undefined {
  const profile = store.profiles.get(userId);
  if (!profile) {
    if (member.demo !== true) return undefined;
    const fallback = recommendationFor(member, undefined);
    return { member: publicMember(member, store), score: fallback.score, reasons: fallback.reasons, factors: [], algorithmVersion: ALGORITHM_VERSION };
  }
  return matchCandidates({
    currentProfile: toMatchProfile(profile),
    candidates: [{ profile: memberMatchProfile(store, member), member: publicMember(member, store) }],
  })[0];
}

function publicRecommendation(result: MatchResult) {
  return {
    member: result.member,
    score: result.score,
    reasons: result.reasons,
  };
}

function publicMatchSnapshot(snapshot: StoredMatchSnapshot) {
  return {
    id: snapshot.id,
    targetUserId: snapshot.targetUserId,
    score: snapshot.score,
    reasons: snapshot.reasons,
    createdAt: snapshot.createdAt,
  };
}

function latestSessionActivity(store: Store, userId: string) {
  return [...store.sessions.values()]
    .filter((session) => session.userId === userId)
    .map((session) => session.lastUsedAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => right.localeCompare(left))[0];
}

function activityLabel(lastActiveAt: string | undefined) {
  if (!lastActiveAt) return "近期活跃";
  const elapsed = Date.now() - Date.parse(lastActiveAt);
  if (elapsed >= 0 && elapsed < 10 * 60_000) return "刚刚活跃";
  if (elapsed >= 0 && elapsed < 24 * 60 * 60_000) return "今天活跃";
  return "近期活跃";
}

function syncApprovedMember(store: Store, userId: string, activityAt?: string) {
  const user = store.users.get(userId);
  const profile = store.profiles.get(userId);
  const avatarProfile = store.avatarProfiles.get(userId);
  if (!user || user.status !== "active" || !profile || profile.profileStatus !== "approved" || profile.visibility === "private" || avatarProfile?.status !== "enabled") return undefined;
  const approvedPhotos = [...store.photos.values()]
    .filter((item) => item.userId === userId && item.reviewStatus === "approved")
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const photo = approvedPhotos[0];
  if (!photo) return undefined;
  const lastActiveAt = activityAt ?? latestSessionActivity(store, userId) ?? user.lastActiveAt ?? store.members.get(profileMemberId(userId))?.lastActiveAt;
  const member: StoredMember = {
    id: profileMemberId(userId),
    nickname: profile.nickname,
    gender: profile.gender,
    age: new Date().getFullYear() - profile.birthYear,
    city: profile.city,
    district: profile.district,
    job: profile.job,
    maritalStatus: profile.maritalStatus,
    goal: profile.goal,
    tags: tagsFromProfile(profile),
    introduction: profile.introduction,
    photoUrl: photo.url,
    photoUrls: approvedPhotos.map((item) => item.url),
    activeLabel: activityLabel(lastActiveAt),
    smokingStatus: profile.preference.selfSmokingStatus,
    childrenStatus: profile.preference.selfChildrenStatus,
    joinedAt: user.createdAt,
    lastActiveAt,
    verified: true,
    ownerUserId: userId,
  };
  store.members.set(member.id, member);
  return member;
}

function recommendationFor(member: StoredMember, profile: StoredProfile | undefined) {
  let score = member.score ?? 60;
  const reasons: string[] = [];
  if (profile?.city === member.city) {
    score += 12;
    reasons.push("同城生活，日常联系更方便");
  }
  if (profile?.preference.preferredGender === member.gender) {
    score += 10;
    reasons.push("符合你希望认识的对象范围");
  }
  if (profile?.goal === member.goal) {
    score += 8;
    reasons.push("交往目标比较一致");
  }
  const minAge = Number(profile?.preference.minAge);
  const maxAge = Number(profile?.preference.maxAge);
  if (Number.isFinite(minAge) && Number.isFinite(maxAge) && member.age >= minAge && member.age <= maxAge) {
    score += 6;
    reasons.push("年龄符合你的期待范围");
  }
  if (profile?.preference.relationshipGoal === member.goal && profile.goal !== member.goal) {
    score += 6;
    reasons.push("对长期关系的期待相近");
  }
  const valuedQualities = (profile?.preference.valuedQualities ?? "").split(/[、,，\s]+/).filter(Boolean);
  if (valuedQualities.some((quality) => member.tags.some((tag) => tag.includes(quality) || quality.includes(tag)))) {
    score += 4;
    reasons.push("公开资料中有你看重的相处品质");
  }
  const dealBreakers = (profile?.preference.dealBreakers ?? "").split(/[、,，\s和与]+/).filter((item) => item.length >= 2);
  if (dealBreakers.some((boundary) => member.tags.some((tag) => tag.includes(boundary)))) score -= 20;
  if (reasons.length === 0) reasons.push("公开资料完整，可以先从 AI 分身了解");
  return { score: Math.max(0, Math.min(score, 96)), reasons };
}

function isBlockedBetween(store: Store, firstUserId: string, secondUserId: string) {
  return store.blocks.has(`${firstUserId}:${secondUserId}`) || store.blocks.has(`${secondUserId}:${firstUserId}`);
}

function memberForResourceId(store: Store, resourceId: string) {
  return UUID_PATTERN.test(resourceId)
    ? [...store.members.values()].find((candidate) => candidate.ownerUserId === resourceId)
    : store.members.get(resourceId);
}

function hasApprovedPublicProfile(store: Store, userId: string) {
  const profile = store.profiles.get(userId);
  if (!profile) return false;
  return profile.profileStatus === "approved" && store.members.has(profileMemberId(userId));
}

function hasApprovedContactIdentity(store: Store, userId: string) {
  const profile = store.profiles.get(userId);
  return Boolean(
    profile
    && profile.profileStatus === "approved"
    && profile.visibility !== "private"
    && [...store.photos.values()].some((photo) => photo.userId === userId && photo.reviewStatus === "approved"),
  );
}

function contactReviewRequired(store: Store, userId: string, member: StoredMember) {
  return member.demo !== true && !hasApprovedPublicProfile(store, userId);
}

function conversationForPair(store: Store, firstUserId: string, secondUserId: string) {
  return [...store.conversations.values()].find((conversation) =>
    conversation.participantIds.includes(firstUserId) && conversation.participantIds.includes(secondUserId));
}

function chatReadiness(store: Store, session: StoredAvatarSession) {
  const member = store.members.get(session.memberId);
  if (!member) return { canRequestChat: false, score: 0 };
  const recommendation = matchFor(store, session.userId, member);
  return {
    canRequestChat: session.completedTopics.length >= 3 && Boolean(recommendation && recommendation.score >= MIN_CHAT_COMPATIBILITY_SCORE),
    score: recommendation?.score ?? 0,
  };
}

type AvatarTopicKey = "life" | "relationship" | "communication" | "privacy" | "general";

const AVATAR_TOPIC_LABELS: Record<AvatarTopicKey, string> = {
  life: "生活习惯",
  relationship: "关系期待",
  communication: "沟通方式",
  privacy: "隐私边界",
  general: "自由提问",
};

function normalizeAvatarTopic(value: unknown): AvatarTopicKey | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized === "life" || normalized === "生活" || normalized === "生活习惯") return "life";
  if (normalized === "relationship" || normalized === "关系" || normalized === "关系期待") return "relationship";
  if (normalized === "communication" || normalized === "沟通" || normalized === "沟通方式") return "communication";
  if (normalized === "privacy" || normalized === "隐私" || normalized === "隐私边界") return "privacy";
  if (normalized === "general" || normalized === "自由" || normalized === "自由提问") return "general";
  return null;
}

function topicForMessage(text: string): { key: string; label: string } | null {
  if (/周末|生活|兴趣|旅行|做饭|散步|看书/.test(text)) return { key: "life", label: "生活习惯" };
  if (/关系|交往|未来|结婚|家庭|期待/.test(text)) return { key: "relationship", label: "关系期待" };
  if (/沟通|分歧|相处|情绪|冲突|尊重/.test(text)) return { key: "communication", label: "沟通方式" };
  return null;
}

function avatarReply(question: string, member: StoredMember): string {
  if (/周末|生活|兴趣|旅行|做饭|散步|看书/.test(question)) return `${member.nickname}的资料里提到，平时更喜欢规律、舒服的生活，也愿意通过散步、阅读或家常饭慢慢放松下来。`;
  if (/关系|交往|未来|结婚|家庭|期待/.test(question)) return `${member.nickname}希望从认真、坦诚的了解开始。双方都觉得舒服时，再逐步讨论更长期的生活安排。`;
  if (/沟通|分歧|相处|情绪|冲突|尊重/.test(question)) return `${member.nickname}比较看重有事直说、彼此尊重。遇到分歧时，希望先把情绪放平，再一起商量。`;
  return `这个问题建议在真人聊天开启后，由${member.nickname}本人进一步确认。我可以继续介绍档案中已经授权公开的生活、关系和沟通信息。`;
}

function authorizedAvatarReply(question: string, member: StoredMember, store: Store): string {
  const profile = member.ownerUserId ? store.avatarProfiles.get(member.ownerUserId) : undefined;
  if (!profile || profile.status !== "enabled") return avatarReply(question, member);
  const topic = topicForMessage(question);
  const fact = profile.approvedFacts.find((item) => !topic || item.topic.includes(topic.label) || item.fact.includes(topic.label))
    ?? profile.approvedFacts[0];
  return fact ? `${member.nickname}授权的资料里提到：${fact.fact}` : profile.unknownResponse;
}

function publicAvatarSession(session: StoredAvatarSession, store: Store) {
  const readiness = chatReadiness(store, session);
  return {
    id: session.id,
    memberId: session.memberId,
    completedTopics: session.completedTopics,
    completedTopicCount: session.completedTopics.length,
    requiredTopicCount: 3,
    canRequestChat: readiness.canRequestChat,
    status: session.status,
  };
}

function publicAvatarMessage(message: StoredAvatarMessage) {
  return {
    id: message.id,
    sessionId: message.sessionId,
    sender: message.sender,
    text: message.text,
    clientMessageId: message.clientMessageId ?? null,
    topic: message.topic,
    createdAt: message.createdAt,
  };
}

function publicAvatarReplyFailureTask(task: StoredAvatarReplyFailureTask) {
  return { ...task };
}

function sanitizedAvatarModelError(cause: unknown) {
  const message = cause instanceof Error ? `${cause.name} ${cause.message}`.toLowerCase() : "";
  if (/timeout|timed out|abort/.test(message)) return "模型服务超时";
  if (/rate|429|too many/.test(message)) return "模型服务限流";
  if (/auth|unauthorized|forbidden|401|403/.test(message)) return "模型服务鉴权失败";
  return "模型服务调用失败";
}

function publicChatRequest(requestItem: StoredChatRequest, viewerId: string, store: Store) {
  const otherUserId = requestItem.toUserId === viewerId ? requestItem.fromUserId : requestItem.toUserId;
  const member = [...store.members.values()].find((candidate) => candidate.ownerUserId === otherUserId);
  return { ...requestItem, ...(member ? { member: publicMember(member, store) } : {}) };
}

export function buildServer(options: BuildServerOptions = {}) {
  const config = getConfig(options);
  const app = Fastify({ logger: false, bodyLimit: 48 * 1024 * 1024, routerOptions: { maxParamLength: 2_048 }, trustProxy: config.trustProxy });
  const exposeDevOtpCode = config.otpCode !== undefined && process.env.NODE_ENV !== "production";
  const store = options.store ?? createMemoryStore(config.databaseUrl ? [] : undefined);
  const providers = createProviders(config, options.providers, !options.store);
  const persistence = options.store?.persistence ?? (!options.store && config.databaseUrl ? createPrismaStore(config.databaseUrl, config.encryptionKey) : undefined);
  store.persistence = persistence;
  const allowedOrigins = new Set(config.allowedOrigins);
  const otpSendTimes = new Map<string, number>();
  const avatarMessageWindows = new Map<string, number[]>();
  const humanMessageWindows = new Map<string, number[]>();
  const persistedSessionActivity = new Map<string, number>();
  const avatarSessionLockTails = new Map<string, Promise<void>>();
  const humanMessageLockTails = new Map<string, Promise<void>>();
  const avatarRetryQueues = new Map<string, Promise<void>>();
  let contentMutationTail: Promise<void> = Promise.resolve();
  let avatarKnowledgeMutationTail: Promise<void> = Promise.resolve();
  const otpIpWindows = new Map<string, number[]>();
  const adminAccessTokens = new Map<string, { userId: string; refreshToken: string; expiresAt: number }>();
  const adminAccessTtlMs = 30 * 60 * 1_000;
  const realtime = options.realtimeEventCenter ?? new RealtimeEventCenter();
  const realtimeHeartbeatMs = options.realtimeHeartbeatMs ?? 15_000;
  if (!Number.isSafeInteger(realtimeHeartbeatMs) || realtimeHeartbeatMs < 1) {
    throw new RangeError("realtimeHeartbeatMs must be a positive safe integer");
  }
  const contentService = options.contentService ?? new ContentActivityService({ createId: () => createId("content") });
  const avatarModelName = config.avatarModelName ?? `${config.avatarModelProvider}-avatar-provider`;
  const avatarKnowledgeService = options.avatarKnowledgeService ?? new InMemoryAvatarKnowledgeService({
    idFactory: () => createId("avatar_knowledge"),
    modelName: avatarModelName,
    model: async ({ ownerId, question, knowledge }) => {
      const avatarProfile = store.avatarProfiles.get(ownerId);
      const text = await providers.avatarModel.reply({
        question,
        approvedFacts: knowledge.map((item) => ({ topic: item.topic, fact: item.content })),
        expectations: avatarProfile?.relationshipExpectations ?? [],
        boundaries: avatarProfile?.boundaries ?? [],
        unknownResponse: avatarProfile?.unknownResponse ?? "这个问题没有得到本人明确授权。",
      });
      return {
        text,
        usage: {
          inputTokens: Math.max(1, Math.ceil((question.length + knowledge.reduce((total, item) => total + item.content.length, 0)) / 2)),
          outputTokens: Math.max(1, Math.ceil(text.length / 2)),
        },
      };
    },
  });
  const operations = options.operationsCenter ?? new OperationsCenter({ createRunId: () => createId("maintenance") });
  const presenceRecipients = (userId: string) => new Set(
    [...store.conversations.values()]
      .filter((conversation) => conversation.participantIds.includes(userId))
      .flatMap((conversation) => conversation.participantIds)
      .filter((participantId) => participantId !== userId),
  );
  const presence = new PresenceTracker({
    onPresenceChanged(snapshot) {
      for (const recipientId of presenceRecipients(snapshot.userId)) {
        realtime.publish(recipientId, "presence.changed", snapshot);
      }
    },
  });
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  registerOperationsHooks(app, operations);
  operations.health.register("api", () => ({ status: "healthy" }));
  operations.health.register("realtime", () => ({ status: "healthy" }));
  if (persistence) {
    operations.health.register("database", async () => {
      if (!persistence.healthCheck) return { status: "degraded", detail: "数据库未提供主动探测" };
      await persistence.healthCheck();
      return { status: "healthy" };
    });
  } else {
    operations.health.register("store", () => ({ status: "healthy", detail: "内存存储运行中" }));
  }
  operations.health.register("object-storage", async () => {
    if (!providers.objectStorage.healthCheck) return { status: "degraded", detail: "对象存储未提供主动探测" };
    await providers.objectStorage.healthCheck();
    return { status: "healthy" };
  });

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return reply.code(403).send(error("ORIGIN_NOT_ALLOWED", "请求来源不在允许列表中。"));
    }
  });

  app.register(cors, {
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  if (persistence) {
    app.addHook("onReady", async () => {
      await persistence.hydrate(store);
      const [contentState, avatarKnowledgeState] = await Promise.all([
        persistence.loadContentActivityState(),
        persistence.loadAvatarKnowledgeState(),
      ]);
      if (contentState) contentService.restoreState(contentState);
      if (avatarKnowledgeState) avatarKnowledgeService.restoreState(avatarKnowledgeState);
      operations.maintenance.restoreRuns([...store.maintenanceRuns.values()]);
      for (const profile of store.profiles.values()) {
        if (profile.profileStatus === "approved") syncApprovedMember(store, profile.userId);
      }
    });
    app.addHook("onClose", async () => persistence.close());
  }
  app.addHook("onClose", async () => {
    for (const timer of typingTimers.values()) clearTimeout(timer);
    typingTimers.clear();
  });

  app.get("/api/health", async (_request, reply) => {
    const report = await operations.health.checkAll();
    if (report.status === "unhealthy") reply.code(503);
    return { ...report, service: "ai-marriage-api" };
  });

  app.get<{ Querystring: Record<string, unknown> }>("/api/content", async (request, reply) => {
    try {
      const query = request.query;
      const filters: PublicContentFilters = {
        type: query.type === "article" || query.type === "event" ? query.type : query.type as never,
        tag: typeof query.tag === "string" ? query.tag : undefined,
        query: typeof query.query === "string" ? query.query : undefined,
        upcomingOnly: query.upcomingOnly === "true" ? true : query.upcomingOnly === "false" || query.upcomingOnly === undefined ? undefined : query.upcomingOnly as never,
        page: query.page === undefined ? undefined : Number(query.page),
        pageSize: query.pageSize === undefined ? undefined : Number(query.pageSize),
      };
      return { data: contentService.listPublicContent(filters) };
    } catch (cause) { return sendContentError(reply, cause); }
  });

  app.get<{ Params: { contentId: string } }>("/api/content/:contentId", async (request, reply) => {
    try { return { data: { content: contentService.getPublicContent(request.params.contentId) } }; }
    catch (cause) { return sendContentError(reply, cause); }
  });

  app.post<{ Params: { contentId: string } }>("/api/content/:contentId/like", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    try { return { data: await mutateContent(() => contentService.like(contentActor(user), request.params.contentId)) }; }
    catch (cause) { return sendContentError(reply, cause); }
  });

  app.delete<{ Params: { contentId: string } }>("/api/content/:contentId/like", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    try { return { data: await mutateContent(() => contentService.unlike(contentActor(user), request.params.contentId)) }; }
    catch (cause) { return sendContentError(reply, cause); }
  });

  app.post<{ Params: { contentId: string } }>("/api/content/:contentId/register", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    try { return reply.code(201).send({ data: await mutateContent(() => contentService.registerForEvent(contentActor(user), request.params.contentId)) }); }
    catch (cause) { return sendContentError(reply, cause); }
  });

  app.delete<{ Params: { contentId: string } }>("/api/content/:contentId/register", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    try { return { data: await mutateContent(() => contentService.cancelEventRegistration(contentActor(user), request.params.contentId)) }; }
    catch (cause) { return sendContentError(reply, cause); }
  });

  app.get("/api/me/event-registrations", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    try { return { data: { items: contentService.listMyEventRegistrations(contentActor(user)) } }; }
    catch (cause) { return sendContentError(reply, cause); }
  });

  app.post<{ Body: { body?: unknown; images?: unknown } }>("/api/me/moments", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const body = typeof request.body?.body === "string" ? request.body.body.trim() : "";
    if (!body || body.length > 2_000) return reply.code(400).send(error("INVALID_CONTENT_INPUT", "动态内容不能为空，且不能超过 2000 个字符。"));
    const images = parseMomentImages(request.body?.images);
    if (!images) return reply.code(400).send(error("MOMENT_IMAGE_INVALID", "动态最多选择 9 张 JPG、PNG 或 WebP 图片，单张不超过 4MB。"));
    const reservedImages = images.map((image) => {
      const key = reserveMomentObjectKey(user.id, image.mimeType);
      return { image, key, url: momentImageUrl(key) };
    });
    let content: ContentItem;
    try {
      content = await mutateContent(() => contentService.reserveMemberMoment(contentActor(user), {
        body,
        imageUrls: reservedImages.map((item) => item.url),
      }));
    } catch (cause) {
      return sendContentError(reply, cause);
    }
    try {
      for (const item of reservedImages) {
        await providers.objectStorage.upload({
          userId: user.id,
          filename: item.image.filename,
          mimeType: item.image.mimeType,
          data: item.image.data,
          purpose: "moment-image",
          objectKey: item.key,
        });
      }
      content = await mutateContent(() => contentService.completeMemberMomentUpload(contentActor(user), content.id));
      return reply.code(201).send({ data: { content } });
    } catch {
      try {
        await deleteOwnContentWithMomentImages(contentActor(user), content.id);
      } catch {
        return reply.code(503).send(error("MOMENT_IMAGE_CLEANUP_PENDING", "动态图片上传失败，系统已保留清理记录，请稍后在我的动态中重试删除。"));
      }
      return reply.code(502).send(error("MOMENT_IMAGE_STORAGE_FAILED", "动态图片上传失败，请稍后重试。"));
    }
  });

  app.get<{ Params: { imageToken: string } }>("/api/content-images/:imageToken", async (request, reply) => {
    const url = `/api/content-images/${request.params.imageToken}`;
    const objectKey = momentObjectKeyFromUrl(url);
    if (!objectKey) return reply.code(404).send(error("CONTENT_IMAGE_NOT_FOUND", "找不到这张动态图片。"));
    const content = contentService.exportState().content.find((item) => item.tags.includes("动态") && item.imageUrls?.includes(url));
    if (!content) return reply.code(404).send(error("CONTENT_IMAGE_NOT_FOUND", "找不到这张动态图片。"));
    const user = await currentUser(request);
    const canManage = user?.role === "admin" || user?.role === "moderator";
    if (content.status !== "published" && content.authorId !== user?.id && !canManage) {
      return reply.code(404).send(error("CONTENT_IMAGE_NOT_FOUND", "找不到这张动态图片。"));
    }
    try {
      const object = await providers.objectStorage.read(objectKey);
      return reply
        .type(object.mimeType)
        .header("Cache-Control", "private, no-store")
        .send(object.data);
    } catch {
      return reply.code(404).send(error("CONTENT_IMAGE_NOT_FOUND", "找不到这张动态图片。"));
    }
  });

  app.get("/api/me/content", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    try { return { data: { items: contentService.listMyContent(contentActor(user)) } }; }
    catch (cause) { return sendContentError(reply, cause); }
  });

  app.delete<{ Params: { contentId: string } }>("/api/me/content/:contentId", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    try {
      await deleteOwnContentWithMomentImages(contentActor(user), request.params.contentId);
      return reply.code(204).send();
    } catch (cause) { return sendContentError(reply, cause); }
  });

  /* ─── Soul Test ────────────────────────────────────────────────────── */

  app.get("/api/soul-test/questions", async () => {
    return { data: { questions: soulTestQuestions, totalCount: soulTestQuestions.length } };
  });

  app.get("/api/me/soul-test", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const result = store.soulTestResults.get(user.id);
    return { data: { completed: Boolean(result), result: result ?? null, totalCount: soulTestQuestions.length, answeredCount: result ? soulTestQuestions.length : 0 } };
  });

  app.post<{ Body: { answers?: unknown } }>("/api/me/soul-test/submit", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const answers = request.body?.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      return reply.code(400).send(error("INVALID_ANSWERS", "请提交完整的答题记录。"));
    }
    const answerRecord = answers as Record<string, unknown>;
    const dimensionTotals: Record<string, number> = { social: 0, expression: 0, pace: 0, decision: 0, intimacy: 0 };
    const dimensionMaxes: Record<string, number> = { social: 0, expression: 0, pace: 0, decision: 0, intimacy: 0 };

    for (const question of soulTestQuestions) {
      const raw = answerRecord[question.id];
      if (raw !== "A" && raw !== "B") {
        return reply.code(400).send(error("INVALID_ANSWER", `题目 ${question.id} 的答案无效。`));
      }
      const choice = raw === "A" ? question.optionA : question.optionB;
      dimensionTotals[question.dimension] += choice.value;
      dimensionMaxes[question.dimension] += 2;
    }

    const dimensionMeta: Record<string, { labelA: string; labelB: string; polarityA: string; polarityB: string; descriptionA: string; descriptionB: string }> = {
      social: { labelA: "外向", labelB: "内向", polarityA: "extrovert", polarityB: "introvert", descriptionA: "你喜欢热闹，善于在社交中获取能量。", descriptionB: "你享受独处，在安静中找到内心的力量。" },
      expression: { labelA: "直接", labelB: "含蓄", polarityA: "direct", polarityB: "reserved", descriptionA: "你习惯坦率表达感受，不喜欢猜来猜去。", descriptionB: "你更习惯用行动代替言语，在细节中传递温度。" },
      pace: { labelA: "随性", labelB: "规律", polarityA: "spontaneous", polarityB: "structured", descriptionA: "你随遇而安，享受生活中的不确定性和惊喜。", descriptionB: "你喜欢井井有条的生活，稳定的节奏让你安心。" },
      decision: { labelA: "感性", labelB: "理性", polarityA: "emotional", polarityB: "rational", descriptionA: "你习惯跟着感觉走，重视内心的体验和共鸣。", descriptionB: "你善于分析和权衡，做决定时更看重逻辑和事实。" },
      intimacy: { labelA: "紧密", labelB: "独立", polarityA: "attached", polarityB: "independent", descriptionA: "你希望和对方紧密联结，一起分享生活的每个角落。", descriptionB: "你重视彼此空间，在相互支持的同时保持独立。" },
    };

    const dimensionScores = Object.entries(dimensionTotals).map(([dimension, total]) => {
      const max = dimensionMaxes[dimension];
      const meta = dimensionMeta[dimension];
      const ratio = max > 0 ? total / max : 0.5;
      const isA = ratio >= 0.5;
      const questionCount = soulTestQuestions.filter((q) => q.dimension === dimension).length;
      return {
        dimension: dimension as "social" | "expression" | "pace" | "decision" | "intimacy",
        dimensionLabel: soulTestQuestions.find((q) => q.dimension === dimension)?.dimensionLabel ?? dimension,
        labelA: meta.labelA,
        labelB: meta.labelB,
        score: Math.round(ratio * 100),
        polarity: (isA ? meta.polarityA : meta.polarityB) as "introvert" | "extrovert" | "reserved" | "direct" | "structured" | "spontaneous" | "rational" | "emotional" | "independent" | "attached",
        description: isA ? meta.descriptionA : meta.descriptionB,
        _questionCount: questionCount,
      };
    });

    // Determine personality type based on dominant dimensions
    const polaritySet = new Set(dimensionScores.map((d) => d.polarity));
    let bestType: typeof personalityTypes[number] = personalityTypes[0];
    let bestScore = -1;
    for (const pt of personalityTypes) {
      let score = 0;
      if (pt.type === "guardian" && polaritySet.has("reserved")) score += 3;
      if (pt.type === "guardian" && polaritySet.has("structured")) score += 2;
      if (pt.type === "explorer" && polaritySet.has("spontaneous")) score += 3;
      if (pt.type === "explorer" && polaritySet.has("emotional")) score += 2;
      if (pt.type === "pioneer" && polaritySet.has("extrovert")) score += 2;
      if (pt.type === "pioneer" && polaritySet.has("rational")) score += 2;
      if (pt.type === "pioneer" && polaritySet.has("structured")) score += 2;
      if (pt.type === "dreamer" && polaritySet.has("introvert")) score += 2;
      if (pt.type === "dreamer" && polaritySet.has("emotional")) score += 3;
      if (pt.type === "anchor" && polaritySet.has("reserved")) score += 2;
      if (pt.type === "anchor" && polaritySet.has("structured")) score += 3;
      if (pt.type === "spark" && polaritySet.has("extrovert")) score += 3;
      if (pt.type === "spark" && polaritySet.has("direct")) score += 2;
      if (score > bestScore) { bestScore = score; bestType = pt; }
    }

    const result: import("./store/types.js").StoredSoulTestResult = {
      userId: user.id,
      completedAt: nowIso(),
      dimensions: dimensionScores.map(({ _questionCount, ...rest }) => rest),
      personalityType: bestType.type,
      personalityLabel: bestType.label,
      personalityDescription: bestType.description,
      tags: [...bestType.tags],
      matchHint: "matchHint" in bestType ? (bestType as { matchHint?: string }).matchHint ?? null : null,
    };

    store.soulTestResults.set(user.id, result);
    return { data: { result, personalityType: bestType } };
  });

  /* ─── Daily Pick ──────────────────────────────────────────────────── */

  function simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function getTodayString(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function generateDailyPickForMember(userId: string, dateStr: string): { memberIds: string[]; reasons: Record<string, string[]>; scores: Record<string, number> } {
    const allMembers = [...store.members.values()].filter((m) => m.verified !== false && (m as { ownerUserId?: string }).ownerUserId === undefined);
    const seed = simpleHash(`${userId}-${dateStr}`);
    const shuffled = allMembers.map((m, i) => ({ member: m, priority: simpleHash(`${seed}-${i}-${m.id}`) }))
      .sort((a, b) => b.priority - a.priority);

    const selected = shuffled.slice(0, 3);
    const reasonTemplates = [
      ["你们的兴趣标签有不少重合", "TA 最近比较活跃，很适合打招呼", "生活节奏可能比较合拍"],
      ["同城且年龄相近", "资料完成度高，认识起来更有诚意", "TA 的自我介绍很有温度"],
      ["双方交往目标一致", "TA 的生活方式和你的期待很接近", "从资料看，有很多可以聊的话题"],
    ];

    const memberIds: string[] = [];
    const reasons: Record<string, string[]> = {};
    const scores: Record<string, number> = {};

    selected.forEach(({ member }, index) => {
      memberIds.push(member.id);
      reasons[member.id] = reasonTemplates[index % reasonTemplates.length];
      scores[member.id] = Math.min(99, 75 + simpleHash(`${member.id}-${dateStr}`) % 20);
    });

    return { memberIds, reasons, scores };
  }

  app.get("/api/me/daily-pick", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const today = getTodayString();
    const pickId = `${user.id}-${today}`;
    let pick = store.dailyPicks.get(pickId);
    if (!pick) {
      const generated = generateDailyPickForMember(user.id, today);
      pick = {
        id: pickId,
        userId: user.id,
        date: today,
        memberIds: generated.memberIds,
        reasons: generated.reasons,
        scores: generated.scores,
        reactions: {},
        createdAt: nowIso(),
      };
      store.dailyPicks.set(pickId, pick);
    }

    const members = pick.memberIds
      .map((memberId) => {
        const member = [...store.members.values()].find((m) => m.id === memberId);
        if (!member) return null;
        const { ownerUserId: _owner, ...publicMember } = member as typeof member & { ownerUserId?: string };
        return {
          memberId,
          member: publicMember,
          reasons: pick!.reasons[memberId] ?? [],
          score: pick!.scores[memberId] ?? 0,
          reaction: pick!.reactions[memberId] ?? null,
        };
      })
      .filter(Boolean);

    return { data: { date: today, members, expiresAt: new Date(new Date(today).getTime() + 24 * 60 * 60 * 1000).toISOString() } };
  });

  app.post<{ Params: { memberId: string }; Body: { reaction?: unknown } }>("/api/me/daily-pick/:memberId/react", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const today = getTodayString();
    const pickId = `${user.id}-${today}`;
    const pick = store.dailyPicks.get(pickId);
    if (!pick) return reply.code(404).send(error("DAILY_PICK_NOT_FOUND", "今天还没有推荐。"));
    if (!pick.memberIds.includes(request.params.memberId)) {
      return reply.code(404).send(error("MEMBER_NOT_IN_PICK", "该会员不在今日推荐中。"));
    }
    const reaction = request.body?.reaction;
    if (reaction !== "interested" && reaction !== "skipped") {
      return reply.code(400).send(error("INVALID_REACTION", "请选择感兴趣或跳过。"));
    }
    pick.reactions[request.params.memberId] = reaction;
    return { data: { memberId: request.params.memberId, reaction } };
  });

  /* ─── Voice Intro Upload ──────────────────────────────────────────── */

  app.post<{ Body: { duration?: unknown; transcript?: unknown } }>("/api/me/voice-intro", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const duration = typeof request.body?.duration === "number" ? request.body.duration : 0;
    const transcript = typeof request.body?.transcript === "string" ? request.body.transcript.trim() : null;
    if (duration <= 0 || duration > 120) {
      return reply.code(400).send(error("INVALID_DURATION", "语音时长需在 1-120 秒之间。"));
    }
    // Find the user's member record
    const member = [...store.members.values()].find((m) => (m as typeof m & { ownerUserId?: string }).ownerUserId === user.id);
    if (!member) {
      return reply.code(404).send(error("MEMBER_NOT_FOUND", "还没有建立会员资料。"));
    }
    (member as typeof member & { voiceIntroDuration?: number; voiceIntroTranscript?: string | null; voiceIntroUrl?: string }).voiceIntroDuration = duration;
    (member as typeof member & { voiceIntroTranscript?: string | null }).voiceIntroTranscript = transcript;
    (member as typeof member & { voiceIntroUrl?: string }).voiceIntroUrl = `demo:voice-${user.id}-${Date.now()}`;
    return { data: { duration, transcript, url: (member as { voiceIntroUrl?: string }).voiceIntroUrl } };
  });

  /* ─── Comments ───────────────────────────────────────────────────── */

  app.get<{ Params: { contentId: string } }>("/api/content/:contentId/comments", async (request, reply) => {
    const comments = [...store.comments.values()]
      .filter((c) => c.contentItemId === request.params.contentId && c.status === "active")
      .sort((a, b) => a.createdAt - b.createdAt);
    return { data: { items: comments } };
  });

  app.post<{ Params: { contentId: string }; Body: { text?: unknown; parentId?: unknown } }>("/api/content/:contentId/comments", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
    if (!text || text.length > 500) {
      return reply.code(400).send(error("INVALID_TEXT", "评论内容需在 1-500 字之间。"));
    }
    const parentId = typeof request.body?.parentId === "string" ? request.body.parentId : null;
    if (parentId && !store.comments.has(parentId)) {
      return reply.code(404).send(error("PARENT_NOT_FOUND", "找不到要回复的评论。"));
    }
    // Get author info
    const member = [...store.members.values()].find((m) => (m as typeof m & { ownerUserId?: string }).ownerUserId === user.id);
    const authorName = member?.nickname ?? "用户";
    const authorPhotoUrl = member?.photoUrl ?? null;
    const now = Date.now();
    const comment: import("./store/types.js").StoredComment = {
      id: createId("comment"),
      contentItemId: request.params.contentId,
      authorId: user.id,
      authorName,
      authorPhotoUrl,
      text,
      parentId,
      likeCount: 0,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    store.comments.set(comment.id, comment);
    return reply.code(201).send({ data: { comment } });
  });

  app.post<{ Params: { commentId: string } }>("/api/comments/:commentId/like", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const comment = store.comments.get(request.params.commentId);
    if (!comment) return reply.code(404).send(error("COMMENT_NOT_FOUND", "找不到这条评论。"));
    comment.likeCount += 1;
    return { data: { comment } };
  });

  app.delete<{ Params: { commentId: string } }>("/api/comments/:commentId", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const comment = store.comments.get(request.params.commentId);
    if (!comment) return reply.code(404).send(error("COMMENT_NOT_FOUND", "找不到这条评论。"));
    if (comment.authorId !== user.id) return reply.code(403).send(error("FORBIDDEN", "只能删除自己的评论。"));
    store.comments.delete(request.params.commentId);
    return reply.code(204).send();
  });

  /* ─── Gamification / Check-in / Tasks ───────────────────────────── */

  function getToday(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function getYesterday(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  function getOrCreateCheckIn(userId: string): import("./store/types.js").StoredCheckIn {
    let checkIn = store.checkIns.get(userId);
    if (!checkIn) {
      checkIn = {
        userId,
        currentStreak: 0,
        longestStreak: 0,
        lastCheckInDate: null,
        totalPoints: 0,
        completedTasks: {},
      };
      store.checkIns.set(userId, checkIn);
    }
    return checkIn;
  }

  app.get("/api/me/checkin", async (request) => {
    const user = await currentUser(request);
    if (!user) return { data: { checkIn: null, tasks: dailyTasks, completions: [] } };
    const checkIn = getOrCreateCheckIn(user.id);
    const today = getToday();
    const hasCheckedInToday = checkIn.lastCheckInDate === today;
    const completions = dailyTasks.map((task) => ({
      taskId: task.id,
      completed: Boolean(checkIn.completedTasks[task.id]),
      completedAt: checkIn.completedTasks[task.id]?.completedAt ?? null,
      pointsAwarded: checkIn.completedTasks[task.id]?.pointsAwarded ?? 0,
    }));
    return { data: { checkIn, hasCheckedInToday, tasks: dailyTasks, completions, today } };
  });

  app.post("/api/me/checkin", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const checkIn = getOrCreateCheckIn(user.id);
    const today = getToday();
    if (checkIn.lastCheckInDate === today) {
      return reply.code(400).send(error("ALREADY_CHECKED_IN", "今天已经签到过了。"));
    }
    const yesterday = getYesterday();
    if (checkIn.lastCheckInDate === yesterday) {
      checkIn.currentStreak += 1;
    } else {
      checkIn.currentStreak = 1;
    }
    if (checkIn.currentStreak > checkIn.longestStreak) {
      checkIn.longestStreak = checkIn.currentStreak;
    }
    checkIn.lastCheckInDate = today;
    // Base check-in: 10 points; bonus for 7-day streak: +50; bonus for 30-day streak: +200
    let pointsEarned = 10;
    if (checkIn.currentStreak > 0 && checkIn.currentStreak % 30 === 0) pointsEarned += 200;
    else if (checkIn.currentStreak > 0 && checkIn.currentStreak % 7 === 0) pointsEarned += 50;
    checkIn.totalPoints += pointsEarned;
    return { data: { checkIn, pointsEarned, streak: checkIn.currentStreak } };
  });

  app.post<{ Body: { taskId?: unknown } }>("/api/me/tasks/complete", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const taskId = typeof request.body?.taskId === "string" ? request.body.taskId : "";
    const task = dailyTasks.find((t) => t.id === taskId);
    if (!task) return reply.code(400).send(error("INVALID_TASK", "找不到该任务。"));
    const checkIn = getOrCreateCheckIn(user.id);
    if (checkIn.completedTasks[taskId]) {
      return reply.code(400).send(error("TASK_ALREADY_COMPLETED", "该任务已完成。"));
    }

    // Validate task completion criteria
    let canComplete = false;
    if (taskId === "daily_checkin") {
      canComplete = checkIn.lastCheckInDate === getToday();
    } else if (taskId === "complete_profile") {
      const profile = [...store.profiles.values()].find((p) => p.userId === user.id);
      canComplete = Boolean(profile && profile.profileStatus !== "draft");
    } else if (taskId === "upload_photo") {
      canComplete = [...store.photos.values()].some((p) => p.userId === user.id);
    } else if (taskId === "first_greeting") {
      canComplete = [...store.interests.values()].some((i) => i.userId === user.id && i.status === "active");
    } else if (taskId === "soul_test") {
      canComplete = store.soulTestResults.has(user.id);
    } else if (taskId === "post_moment") {
      canComplete = [...store.members.values()].some((m) => (m as { ownerUserId?: string }).ownerUserId === user.id);
    }

    if (!canComplete) {
      return reply.code(400).send(error("TASK_NOT_COMPLETED", "任务条件尚未满足。"));
    }

    checkIn.completedTasks[taskId] = {
      completedAt: new Date().toISOString(),
      pointsAwarded: task.points,
    };
    checkIn.totalPoints += task.points;
    return { data: { checkIn, task: { ...task }, pointsAwarded: task.points } };
  });

  /* ─── VIP Membership ──────────────────────────────────────────────── */

  function getVipStatus(userId: string): import("@ai-marriage/shared").VipStatus {
    const sub = store.vipSubscriptions.get(userId);
    if (!sub) return { tier: "free", expiresAt: null, isActive: false, superLikesRemaining: 0, superLikesTotal: 0 };
    const now = new Date();
    const expiresAt = new Date(sub.expiresAt);
    const isActive = expiresAt > now;
    return {
      tier: isActive ? sub.tier : "free",
      expiresAt: sub.expiresAt,
      isActive,
      superLikesRemaining: isActive ? sub.superLikesRemaining : 0,
      superLikesTotal: isActive ? sub.superLikesTotal : 0,
    };
  }

  app.get("/api/me/vip", async (request) => {
    const user = await currentUser(request);
    if (!user) return { data: { vip: { tier: "free", isActive: false, superLikesRemaining: 0, superLikesTotal: 0, expiresAt: null }, plans: vipPlans } };
    const vip = getVipStatus(user.id);
    return { data: { vip, plans: vipPlans } };
  });

  app.post<{ Body: { planId?: unknown; paymentMethod?: unknown } }>("/api/me/vip/subscribe", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const planId = typeof request.body?.planId === "string" ? request.body.planId : "";
    const plan = vipPlans.find((p) => p.id === planId);
    if (!plan) return reply.code(400).send(error("INVALID_PLAN", "无效的会员方案。"));

    // Check existing subscription
    const existing = store.vipSubscriptions.get(user.id);
    const now = new Date();
    const baseDate = existing && new Date(existing.expiresAt) > now ? new Date(existing.expiresAt) : now;
    const expiresAt = new Date(baseDate);
    expiresAt.setDate(expiresAt.getDate() + plan.durationDays);

    // Simulate payment success
    const superLikesTotal = plan.id === "monthly" ? 90 : plan.id === "quarterly" ? 270 : 1095;
    const subscription: import("./store/types.js").StoredVipSubscription = {
      userId: user.id,
      tier: plan.id,
      startsAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      superLikesRemaining: superLikesTotal,
      superLikesTotal,
      createdAt: now.toISOString(),
    };
    store.vipSubscriptions.set(user.id, subscription);
    return { data: { vip: getVipStatus(user.id), plan: { ...plan } } };
  });

  app.post<{ Body: { memberId?: unknown } }>("/api/me/super-like", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const vip = getVipStatus(user.id);
    if (!vip.isActive) return reply.code(403).send(error("VIP_REQUIRED", "需要 VIP 会员才能使用超级喜欢。"));
    if (vip.superLikesRemaining <= 0) return reply.code(400).send(error("NO_SUPER_LIKES", "今日超级喜欢次数已用完。"));
    const sub = store.vipSubscriptions.get(user.id)!;
    sub.superLikesRemaining -= 1;
    return { data: { remaining: sub.superLikesRemaining } };
  });

  /* ─── Video Intro ─────────────────────────────────────────────────── */

  app.get("/api/me/video-intro", async (request) => {
    const user = await currentUser(request);
    if (!user) return { data: { video: null } };
    const video = [...store.videoIntros.values()].find((v) => v.userId === user.id) ?? null;
    return { data: { video } };
  });

  app.post<{ Body: { dataUrl?: unknown; filename?: unknown; durationSeconds?: unknown } }>("/api/me/video-intro", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const dataUrl = typeof request.body?.dataUrl === "string" ? request.body.dataUrl : "";
    const filename = typeof request.body?.filename === "string" ? request.body.filename : "video.webm";
    const durationSeconds = typeof request.body?.durationSeconds === "number" ? request.body.durationSeconds : 30;
    if (!dataUrl.startsWith("data:video/")) {
      return reply.code(400).send(error("INVALID_VIDEO", "请上传有效的视频文件。"));
    }
    if (durationSeconds < 10 || durationSeconds > 90) {
      return reply.code(400).send(error("INVALID_DURATION", "视频时长需在 10-90 秒之间。"));
    }
    // Simulate storing video
    const now = new Date().toISOString();
    const video: import("./store/types.js").StoredVideoIntro = {
      id: createId("video"),
      userId: user.id,
      url: `data:video/webm;base64,${dataUrl.split(",").pop() ?? ""}`,
      thumbnailUrl: null,
      durationSeconds,
      sizeBytes: Math.round(dataUrl.length * 0.75),
      mimeType: "video/webm",
      reviewStatus: "pending",
      reviewReason: null,
      createdAt: now,
      updatedAt: now,
    };
    // Remove existing
    for (const [key, v] of store.videoIntros) {
      if (v.userId === user.id) store.videoIntros.delete(key);
    }
    store.videoIntros.set(video.id, video);
    return reply.code(201).send({ data: { video } });
  });

  app.delete("/api/me/video-intro", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    for (const [key, v] of store.videoIntros) {
      if (v.userId === user.id) store.videoIntros.delete(key);
    }
    return reply.code(204).send();
  });

  app.post<{ Body: Parameters<ContentActivityService["createDraft"]>[1] }>("/api/admin/content", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    try {
      const content = await mutateContent(() => contentService.createDraft(contentActor(auth.user), request.body));
      await writeAdminAudit({ actorUserId: auth.user.id, action: "content.created", targetType: "content", targetId: content.id, reason: null, metadata: { type: content.type } });
      return reply.code(201).send({ data: { content } });
    }
    catch (cause) { return sendContentError(reply, cause); }
  });

  app.get("/api/admin/content", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    return { data: { items: contentService.listAdminContent(contentActor(auth.user)) } };
  });

  app.post<{ Params: { contentId: string } }>("/api/admin/content/:contentId/publish", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    try {
      const content = await mutateContent(() => contentService.publish(contentActor(auth.user), request.params.contentId));
      await writeAdminAudit({ actorUserId: auth.user.id, action: "content.published", targetType: "content", targetId: content.id, reason: null, metadata: {} });
      return { data: { content } };
    }
    catch (cause) { return sendContentError(reply, cause); }
  });

  app.post<{ Params: { contentId: string } }>("/api/admin/content/:contentId/offline", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    try {
      const content = await mutateContent(() => contentService.takeOffline(contentActor(auth.user), request.params.contentId));
      await writeAdminAudit({ actorUserId: auth.user.id, action: "content.offline", targetType: "content", targetId: content.id, reason: null, metadata: {} });
      return { data: { content } };
    }
    catch (cause) { return sendContentError(reply, cause); }
  });

  app.patch<{ Params: { contentId: string }; Body: Parameters<ContentActivityService["updateContent"]>[2] }>("/api/admin/content/:contentId", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    try {
      const existing = contentService.getAdminContent(contentActor(auth.user), request.params.contentId);
      if (existing.tags.includes("动态") && request.body?.imageUrls !== undefined) {
        return reply.code(400).send(error("INVALID_CONTENT_INPUT", "会员动态图片不能在后台替换，请让会员重新提交动态。"));
      }
      const content = await mutateContent(() => contentService.updateContent(contentActor(auth.user), request.params.contentId, request.body));
      await writeAdminAudit({ actorUserId: auth.user.id, action: "content.updated", targetType: "content", targetId: content.id, reason: null, metadata: {} });
      return { data: { content } };
    } catch (cause) { return sendContentError(reply, cause); }
  });

  app.delete<{ Params: { contentId: string } }>("/api/admin/content/:contentId", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    try {
      await deleteAdminContentWithMomentImages(contentActor(auth.user), request.params.contentId);
      await writeAdminAudit({ actorUserId: auth.user.id, action: "content.deleted", targetType: "content", targetId: request.params.contentId, reason: null, metadata: {} });
      return reply.code(204).send();
    } catch (cause) { return sendContentError(reply, cause); }
  });

  app.post<{ Body: { phone?: unknown } }>("/api/auth/otp/request", async (request, reply) => {
    const phone = normalizePhone(request.body?.phone);
    if (!phone) return reply.code(400).send(error("PHONE_INVALID", "请输入正确的手机号。"));

    const now = Date.now();
    const lastSentAt = otpSendTimes.get(phone);
    if (lastSentAt !== undefined && now - lastSentAt < OTP_SEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((OTP_SEND_COOLDOWN_MS - (now - lastSentAt)) / 1_000);
      return reply.header("Retry-After", String(retryAfter)).code(429).send(error("RATE_LIMITED", `请在 ${retryAfter} 秒后重新获取验证码。`));
    }
    const ip = request.ip;
    const recentIpRequests = (otpIpWindows.get(ip) ?? []).filter((sentAt) => now - sentAt < OTP_IP_WINDOW_MS);
    if (recentIpRequests.length >= OTP_IP_MAX_REQUESTS) {
      const retryAfter = Math.max(1, Math.ceil((OTP_IP_WINDOW_MS - (now - recentIpRequests[0])) / 1_000));
      otpIpWindows.set(ip, recentIpRequests);
      return reply.header("Retry-After", String(retryAfter)).code(429).send(error("RATE_LIMITED", "验证码请求过于频繁，请稍后再试。"));
    }

    const code = config.otpCode ?? String(Math.floor(100000 + Math.random() * 900000));
    const otpRequest = { phone, code, expiresAt: now + config.otpTtlSeconds * 1000, attempts: 0 };
    store.otpRequests.delete(phone);
    await persistence?.deleteOtpRequest(phone);
    try {
      await providers.sms.sendCode({ phone, code, expiresInSeconds: config.otpTtlSeconds });
    } catch {
      return reply.code(502).send(error("SMS_SEND_FAILED", "验证码发送失败，请稍后重试。"));
    }
    otpSendTimes.set(phone, now);
    otpIpWindows.set(ip, [...recentIpRequests, now]);
    store.otpRequests.set(phone, otpRequest);
    await persistence?.persistOtpRequest(otpRequest);
    return {
      data: {
        sent: true,
        expiresIn: config.otpTtlSeconds,
        ...(exposeDevOtpCode ? { devCode: config.otpCode } : {}),
      },
    };
  });

  app.post<{ Body: { phone?: unknown; code?: unknown } }>("/api/auth/otp/verify", async (request, reply) => {
    const phone = normalizePhone(request.body?.phone);
    const code = typeof request.body?.code === "string" ? request.body.code.trim() : "";
    const otp = phone ? store.otpRequests.get(phone) : undefined;
    let validOtp = false;
    if (phone && persistence) {
      validOtp = await persistence.verifyOtp(phone, code);
    } else if (phone && otp && otp.expiresAt >= Date.now() && (otp.attempts ?? 0) < OTP_MAX_ATTEMPTS) {
      validOtp = otp.code === code;
      if (!validOtp) {
        otp.attempts = (otp.attempts ?? 0) + 1;
        if (otp.attempts >= OTP_MAX_ATTEMPTS) store.otpRequests.delete(phone);
      }
    }
    if (!phone || !validOtp) {
      return reply.code(400).send(error("OTP_INVALID", "验证码错误或已过期。"));
    }

    let userId = store.usersByPhone.get(phone);
    let user = userId ? store.users.get(userId) : undefined;
    if (!user && persistence) {
      user = await persistence.findUserByPhone(phone);
      if (user) {
        userId = user.id;
        store.users.set(user.id, user);
        store.usersByPhone.set(phone, user.id);
      }
    }
    if (user?.deletionScheduledAt && new Date(user.deletionScheduledAt).getTime() <= Date.now() && user.status !== "deleted") {
      await cleanupExpiredAccount({
        store,
        user,
        currentTime: Date.now(),
        objectStorage: providers.objectStorage,
        removeContentActivity: removeDeletedUserContentActivity,
        removeAvatarKnowledge: removeDeletedUserAvatarKnowledge,
      });
      user = store.users.get(user.id);
    }
    if (!user) {
      user = {
        id: createId("user"),
        phone,
        role: config.adminPhones.includes(phone) ? "admin" : "user",
        status: "active",
        createdAt: nowIso(),
      };
      store.users.set(user.id, user);
      store.usersByPhone.set(phone, user.id);
      await persistence?.persistUser(user);
    } else if (user.status === "deleted") {
      store.otpRequests.delete(phone);
      await persistence?.deleteOtpRequest(phone);
      return reply.code(403).send(error("ACCOUNT_DELETED", "该账号已注销，无法直接恢复。"));
    } else if (user.status === "suspended" && user.suspensionSource !== "admin") {
      user.status = "active";
      user.suspensionSource = null;
      await persistence?.persistUser(user);
    }
    store.otpRequests.delete(phone);
    await persistence?.deleteOtpRequest(phone);
    const token = randomBytes(32).toString("hex");
    const sessionExpiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const timestamp = nowIso();
    const session: StoredSession = {
      id: createId("session"),
      userId: user.id,
      expiresAt: sessionExpiresAt,
      userAgent: String(request.headers["user-agent"] ?? "未知设备").slice(0, 512),
      createdAt: timestamp,
      lastUsedAt: timestamp,
    };
    store.sessions.set(token, session);
    await persistence?.persistSession(token, session);
    user.lastActiveAt = timestamp;
    persistedSessionActivity.set(token, Date.parse(timestamp));
    syncApprovedMember(store, user.id, timestamp);
    setRefreshCookie(reply, token, config.secureCookies);
    return { data: { user: publicUser(user), profile: publicProfile(store.profiles.get(user.id)) } };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies.refresh_token;
    if (token) {
      store.sessions.delete(token);
      await persistence?.deleteSession(token);
    }
    if (cookies.admin_access) adminAccessTokens.delete(cookies.admin_access);
    const refreshAttributes = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
    if (config.secureCookies) refreshAttributes.push("Secure");
    reply.header("Set-Cookie", [
      `refresh_token=; ${refreshAttributes.join("; ")}`,
      clearedAdminAccessCookie(config.secureCookies),
    ]);
    return reply.code(204).send();
  });

  async function currentAccountUser(request: { headers: { cookie?: string } }): Promise<StoredUser | undefined> {
    const token = parseCookies(request.headers.cookie).refresh_token;
    const session = token ? store.sessions.get(token) : undefined;
    if (token && session) {
      const user = store.users.get(session.userId);
      if (session.expiresAt > Date.now() && user && user.status !== "deleted") {
        const activityAt = nowIso();
        session.lastUsedAt = activityAt;
        user.lastActiveAt = activityAt;
        const activityTime = Date.parse(activityAt);
        if (token && persistence?.persistSessionActivity && activityTime - (persistedSessionActivity.get(token) ?? 0) >= 60_000) {
          try {
            await persistence.persistSessionActivity(token, activityAt);
            persistedSessionActivity.set(token, activityTime);
          } catch {
            // Activity tracking must not make an otherwise valid session unusable.
          }
        }
        syncApprovedMember(store, user.id, activityAt);
        return user;
      }
      store.sessions.delete(token);
      await persistence?.deleteSession(token);
    }
    const persistedUserId = token ? await persistence?.findUserIdBySessionToken(token) : undefined;
    const persistedUser = persistedUserId ? store.users.get(persistedUserId) : undefined;
    if (persistedUser && persistedUser.status !== "deleted") {
      const activityAt = nowIso();
      persistedUser.lastActiveAt = activityAt;
      if (token && persistence?.persistSessionActivity) {
        try {
          await persistence.persistSessionActivity(token, activityAt);
          persistedSessionActivity.set(token, Date.parse(activityAt));
        } catch {
          // Activity tracking must not make an otherwise valid session unusable.
        }
      }
      syncApprovedMember(store, persistedUser.id, activityAt);
      return persistedUser;
    }
    if (token && persistedUserId) await persistence?.deleteSession(token);
    const restrictedSession = token ? store.restrictedSessions.get(token) : undefined;
    if (token && restrictedSession) {
      const restrictedUser = store.users.get(restrictedSession.userId);
      if (restrictedSession.expiresAt > Date.now() && restrictedUser?.status === "suspended") return restrictedUser;
      store.restrictedSessions.delete(token);
    }
    const restrictedUserId = token ? await persistence?.findUserIdByRestrictedSessionToken?.(token) : undefined;
    const restrictedUser = restrictedUserId ? store.users.get(restrictedUserId) : undefined;
    if (restrictedUser?.status === "suspended") return restrictedUser;
    return undefined;
  }

  async function currentUser(request: { headers: { cookie?: string } }): Promise<StoredUser | undefined> {
    const user = await currentAccountUser(request);
    return user?.status === "active" ? user : undefined;
  }

  function memorySessionFor(request: { headers: { cookie?: string } }) {
    const token = parseCookies(request.headers.cookie).refresh_token;
    return { token, session: token ? store.sessions.get(token) : undefined };
  }

  function validAdminAccess(request: { headers: { cookie?: string } }, user: StoredUser) {
    if (!config.adminAccessCode) return { verified: true, expiresAt: null as string | null };
    const cookies = parseCookies(request.headers.cookie);
    const access = cookies.admin_access ? adminAccessTokens.get(cookies.admin_access) : undefined;
    if (!access || access.userId !== user.id || access.refreshToken !== cookies.refresh_token) {
      return { verified: false, expiresAt: null as string | null };
    }
    if (access.expiresAt <= Date.now()) {
      adminAccessTokens.delete(cookies.admin_access!);
      return { verified: false, expiresAt: null as string | null };
    }
    return { verified: true, expiresAt: new Date(access.expiresAt).toISOString() };
  }

  function privilegedRole(user: StoredUser) {
    return user.role === "admin" || user.role === "moderator";
  }

  async function currentAdministrator(request: { headers: { cookie?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
    const user = await currentUser(request);
    if (!user) return { response: reply.code(401).send(error("AUTH_REQUIRED", "请先登录。")) };
    if (user.role !== "admin") return { response: reply.code(403).send(error("ADMIN_REQUIRED", "需要管理员权限。")) };
    if (!validAdminAccess(request, user).verified) {
      return { response: reply.code(403).send(error("ADMIN_STEP_UP_REQUIRED", "请先验证后台访问码。")) };
    }
    return { user };
  }

  async function currentReviewer(request: { headers: { cookie?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
    const user = await currentUser(request);
    if (!user) return { response: reply.code(401).send(error("AUTH_REQUIRED", "请先登录。")) };
    if (!privilegedRole(user)) return { response: reply.code(403).send(error("ADMIN_REQUIRED", "需要管理员权限。")) };
    if (!validAdminAccess(request, user).verified) {
      return { response: reply.code(403).send(error("ADMIN_STEP_UP_REQUIRED", "请先验证后台访问码。")) };
    }
    return { user };
  }

  app.get("/api/admin/access", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    if (!privilegedRole(user)) return reply.code(403).send(error("ADMIN_REQUIRED", "需要管理员权限。"));
    const state = validAdminAccess(request, user);
    return { data: { required: Boolean(config.adminAccessCode), ...state } };
  });

  app.post<{ Body: { code?: unknown } }>("/api/admin/access/verify", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    if (!privilegedRole(user)) return reply.code(403).send(error("ADMIN_REQUIRED", "需要管理员权限。"));
    if (!config.adminAccessCode) return { data: { verified: true, expiresAt: null } };
    const code = typeof request.body?.code === "string" ? request.body.code : "";
    if (code !== config.adminAccessCode) {
      return reply.code(403).send(error("ADMIN_ACCESS_CODE_INVALID", "后台访问码不正确。"));
    }
    const refreshToken = parseCookies(request.headers.cookie).refresh_token;
    if (!refreshToken) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const token = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + adminAccessTtlMs;
    adminAccessTokens.set(token, { userId: user.id, refreshToken, expiresAt });
    reply.header("Set-Cookie", adminAccessCookie(token, config.secureCookies, Math.floor(adminAccessTtlMs / 1_000)));
    return { data: { verified: true, expiresAt: new Date(expiresAt).toISOString() } };
  });

  function contentActor(user: StoredUser): ContentActor {
    return { userId: user.id, role: user.role === "admin" || user.role === "moderator" ? "admin" : "member" };
  }

  function sendContentError(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, cause: unknown) {
    if (cause instanceof ContentDomainError) return reply.code(cause.statusCode).send(error(cause.code, cause.message.trim()));
    throw cause;
  }

  function sendAvatarKnowledgeError(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, cause: unknown) {
    if (cause instanceof AvatarKnowledgeError) {
      const status = cause.code === "KNOWLEDGE_NOT_FOUND" || cause.code === "VERSION_NOT_FOUND" ? 404
        : cause.code === "PROHIBITED_KNOWLEDGE" || cause.code === "INVALID_VERSION_STATE" ? 409
          : cause.code === "MODEL_CALL_FAILED" ? 502 : 400;
      return reply.code(status).send(error(cause.code, cause.message.replace(/^[A-Z_]+:\s*/, "")));
    }
    throw cause;
  }

  function serializeContentMutation<T>(operation: () => Promise<T>): Promise<T> {
    const current = contentMutationTail.catch(() => undefined).then(operation);
    contentMutationTail = current.then(() => undefined, () => undefined);
    return current;
  }

  function serializeAvatarKnowledgeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const current = avatarKnowledgeMutationTail.catch(() => undefined).then(operation);
    avatarKnowledgeMutationTail = current.then(() => undefined, () => undefined);
    return current;
  }

  function mutateContent<T>(mutation: () => T | Promise<T>): Promise<T> {
    return serializeContentMutation(async () => {
      const previous = contentService.exportState();
      try {
        const result = await mutation();
        await persistence?.persistContentActivityState(contentService.exportState());
        return result;
      } catch (cause) {
        contentService.restoreState(previous);
        throw cause;
      }
    });
  }

  function deleteContentWithMomentImages<T>(stage: () => ContentItem[], finalize: () => T | Promise<T>): Promise<T> {
    return serializeContentMutation(async () => {
      const original = contentService.exportState();
      let stagedState = original;
      let stagedContent: ContentItem[] = [];
      try {
        stagedContent = stage();
        stagedState = contentService.exportState();
        await persistence?.persistContentActivityState(contentService.exportState());
      } catch (cause) {
        contentService.restoreState(original);
        throw cause;
      }
      await deleteMomentImages(stagedContent);
      try {
        const result = await finalize();
        await persistence?.persistContentActivityState(contentService.exportState());
        return result;
      } catch (cause) {
        contentService.restoreState(stagedState);
        throw cause;
      }
    });
  }

  function deleteOwnContentWithMomentImages(actor: ContentActor, contentId: string) {
    return deleteContentWithMomentImages(
      () => [contentService.stageOwnContentDeletion(actor, contentId)],
      () => contentService.deleteOwnContent(actor, contentId),
    );
  }

  function deleteAdminContentWithMomentImages(actor: ContentActor, contentId: string) {
    return deleteContentWithMomentImages(
      () => [contentService.stageContentDeletion(actor, contentId)],
      () => contentService.deleteContent(actor, contentId),
    );
  }

  async function deleteMomentImages(contentItems: readonly ContentItem[]) {
    const objectKeys = new Set(contentItems
      .filter((item) => item.tags.includes("动态"))
      .flatMap((item) => item.imageUrls ?? [])
      .map(momentObjectKeyFromUrl)
      .filter((key): key is string => Boolean(key)));
    await Promise.all([...objectKeys].map((key) => providers.objectStorage.delete(key)));
  }

  function mutateAvatarKnowledge<T>(mutation: () => T | Promise<T>): Promise<T> {
    return serializeAvatarKnowledgeMutation(async () => {
      const previous = avatarKnowledgeService.exportState();
      try {
        const result = await mutation();
        await persistence?.persistAvatarKnowledgeState(avatarKnowledgeService.exportState());
        return result;
      } catch (cause) {
        avatarKnowledgeService.restoreState(previous);
        throw cause;
      }
    });
  }

  async function removeDeletedUserContentActivity(userId: string): Promise<void> {
    await deleteContentWithMomentImages(
      () => contentService.stageUserContentDeletion(userId),
      () => contentService.removeUserActivity(userId),
    );
  }

  function removeDeletedUserAvatarKnowledge(userId: string) {
    return serializeAvatarKnowledgeMutation(async () => {
      avatarKnowledgeService.removeOwnerData(userId);
    });
  }

  async function writeAdminAudit(input: Omit<StoredAdminAuditLog, "id" | "createdAt">) {
    const entry: StoredAdminAuditLog = {
      ...input,
      id: createId("admin-audit"),
      createdAt: nowIso(),
    };
    store.adminAuditLogs.set(entry.id, entry);
    try {
      await persistence?.persistAdminAuditLog(entry);
    } catch (cause) {
      store.adminAuditLogs.delete(entry.id);
      throw cause;
    }
    return entry;
  }

  async function recordMaintenanceRun(run: StoredMaintenanceRun) {
    store.maintenanceRuns.set(run.id, run);
    try {
      await persistence?.persistMaintenanceRun(run);
    } catch (cause) {
      store.maintenanceRuns.delete(run.id);
      throw cause;
    }
  }

  app.get("/api/admin/operations", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    const summary = await operations.getAdminSummary();
    return { data: { ...summary, operations: summary } };
  });

  app.post("/api/admin/operations/cleanup", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    const run = await operations.maintenance.runCleanup(createExpiredResourceCleanupPlan({
      store,
      actorId: auth.user.id,
      objectStorage: providers.objectStorage,
      removeContentActivity: removeDeletedUserContentActivity,
      removeAvatarKnowledge: removeDeletedUserAvatarKnowledge,
    }));
    if (run.status === "failed") {
      operations.logger.error("maintenance.cleanup.failed", {
        runId: run.id,
        taskName: run.taskName,
        actorId: run.actorId,
        failedTargets: run.results.filter((result) => result.status === "failed").map((result) => result.target),
      });
    }
    await recordMaintenanceRun(run);
    await writeAdminAudit({ actorUserId: auth.user.id, action: "maintenance.cleanup", targetType: "maintenance_run", targetId: run.id, reason: null, metadata: { status: run.status, totalRemoved: run.totalRemoved } });
    return reply.code(201).send({ data: { run } });
  });

  app.get("/api/admin/accounts", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    const items = [...store.users.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((user) => {
        const profile = store.profiles.get(user.id);
        const sessions = [...store.sessions.values()].filter((session) => session.userId === user.id);
        return {
          id: user.id,
          phoneMasked: maskPhone(user.phone),
          status: user.status,
          role: user.role,
          profileCompleted: Boolean(profile),
          nickname: profile?.nickname ?? null,
          city: profile?.city ?? null,
          createdAt: user.createdAt,
          lastLoginAt: sessions.sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt))[0]?.lastUsedAt ?? null,
        };
      });
    return { data: { items } };
  });

  app.post<{ Params: { userId: string }; Body: { reason?: unknown } }>("/api/admin/accounts/:userId/suspend", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    const target = store.users.get(request.params.userId);
    const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
    if (!target) return reply.code(404).send(error("ACCOUNT_NOT_FOUND", "找不到这个账号。"));
    if (target.status === "deleted") return reply.code(409).send(error("ACCOUNT_DELETED", "已注销账号不能停用或恢复。"));
    if (target.id === auth.user.id || target.role === "admin") return reply.code(409).send(error("ACCOUNT_OPERATION_NOT_ALLOWED", "不能停用当前管理员账号。"));
    if (reason.length < 5 || reason.length > 500) return reply.code(400).send(error("REASON_INVALID", "账号处理原因需为 5 至 500 字。"));
    const previous = { status: target.status, suspensionSource: target.suspensionSource };
    target.status = "suspended";
    target.suspensionSource = "admin";
    try {
      await persistence?.suspendUserAndDeleteSessions(target);
    } catch (cause) {
      target.status = previous.status;
      target.suspensionSource = previous.suspensionSource;
      throw cause;
    }
    for (const [token, session] of store.sessions) {
      if (session.userId !== target.id) continue;
      store.restrictedSessions.set(token, session);
      store.sessions.delete(token);
    }
    store.members.delete(profileMemberId(target.id));
    await writeAdminAudit({ actorUserId: auth.user.id, action: "account.suspended", targetType: "user", targetId: target.id, reason, metadata: {} });
    return { data: { user: publicUser(target) } };
  });

  app.post<{ Params: { userId: string }; Body: { reason?: unknown } }>("/api/admin/accounts/:userId/restore", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    const target = store.users.get(request.params.userId);
    const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
    if (!target) return reply.code(404).send(error("ACCOUNT_NOT_FOUND", "找不到这个账号。"));
    if (target.status === "deleted") return reply.code(409).send(error("ACCOUNT_DELETED", "已注销账号不能直接恢复。"));
    if (target.role === "admin") return reply.code(409).send(error("ACCOUNT_OPERATION_NOT_ALLOWED", "不能恢复管理员账号。"));
    if (reason.length < 5 || reason.length > 500) return reply.code(400).send(error("REASON_INVALID", "账号处理原因需为 5 至 500 字。"));
    const previous = { status: target.status, suspensionSource: target.suspensionSource };
    target.status = "active";
    target.suspensionSource = null;
    try {
      await persistence?.persistUser(target);
      await writeAdminAudit({ actorUserId: auth.user.id, action: "account.restored", targetType: "user", targetId: target.id, reason, metadata: {} });
    } catch (cause) {
      target.status = previous.status;
      target.suspensionSource = previous.suspensionSource;
      throw cause;
    }
    for (const [token, session] of store.restrictedSessions) if (session.userId === target.id) store.restrictedSessions.delete(token);
    syncApprovedMember(store, target.id);
    return { data: { user: publicUser(target) } };
  });

  app.get("/api/admin/appeals", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    return { data: { items: [...store.accountAppeals.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)) } };
  });

  app.post<{ Params: { appealId: string }; Body: { decision?: unknown; resolution?: unknown } }>("/api/admin/appeals/:appealId/review", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    const appeal = store.accountAppeals.get(request.params.appealId);
    const decision = request.body?.decision;
    const resolution = typeof request.body?.resolution === "string" ? request.body.resolution.trim() : "";
    if (!appeal) return reply.code(404).send(error("APPEAL_NOT_FOUND", "找不到这条申诉。"));
    if (appeal.status === "approved" || appeal.status === "rejected") return reply.code(409).send(error("APPEAL_ALREADY_REVIEWED", "这条申诉已经完成，不能再次裁决。"));
    if (decision !== "approved" && decision !== "rejected") return reply.code(400).send(error("APPEAL_DECISION_INVALID", "请选择有效的申诉结论。"));
    if (resolution.length < 2 || resolution.length > 1_000) return reply.code(400).send(error("APPEAL_RESOLUTION_INVALID", "请填写 2 至 1000 字的处理说明。"));
    const previous = { ...appeal };
    const target = store.users.get(appeal.userId);
    const shouldRestoreAccount = decision === "approved" && target?.status === "suspended" && target.suspensionSource === "admin";
    const previousTarget = target ? { status: target.status, suspensionSource: target.suspensionSource } : null;
    appeal.status = decision;
    appeal.resolution = resolution;
    appeal.updatedAt = nowIso();
    if (shouldRestoreAccount && target) {
      target.status = "active";
      target.suspensionSource = null;
    }
    try {
      if (shouldRestoreAccount && target) await persistence?.persistUser(target);
      await persistence?.persistAccountAppeal(appeal);
      await writeAdminAudit({ actorUserId: auth.user.id, action: `appeal.${decision}`, targetType: "account_appeal", targetId: appeal.id, reason: resolution, metadata: { userId: appeal.userId, accountRestored: shouldRestoreAccount } });
    } catch (cause) {
      store.accountAppeals.set(appeal.id, previous);
      if (target && previousTarget) {
        target.status = previousTarget.status;
        target.suspensionSource = previousTarget.suspensionSource;
      }
      throw cause;
    }
    if (shouldRestoreAccount && target) syncApprovedMember(store, target.id);
    return { data: { appeal } };
  });

  app.get("/api/admin/audit-logs", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    const items = [...store.adminAuditLogs.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(({ reason: _reason, ...entry }) => entry);
    return { data: { items } };
  });

  function newNotification(notification: Omit<StoredNotification, "id" | "readAt" | "createdAt">): StoredNotification {
    return { ...notification, id: createId("notification"), readAt: null, createdAt: nowIso() };
  }

  function publishNotification(item: StoredNotification) {
    store.notifications.set(item.id, item);
    realtime.publish(item.userId, "notification.created", { notification: item });
  }

  async function createNotification(notification: Omit<StoredNotification, "id" | "readAt" | "createdAt">) {
    const item = newNotification(notification);
    await persistence?.persistNotification(item);
    publishNotification(item);
    return item;
  }

  async function expirePendingChatRequest(requestItem: StoredChatRequest) {
    if (requestItem.status !== "pending") return requestItem.status === "expired";
    const createdAt = new Date(requestItem.createdAt).getTime();
    const storedExpiry = requestItem.expiresAt ? new Date(requestItem.expiresAt).getTime() : Number.NaN;
    const expiryTime = Number.isFinite(storedExpiry)
      ? storedExpiry
      : (Number.isFinite(createdAt) ? createdAt : Date.now()) + CHAT_REQUEST_TTL_MS;
    const expiresAt = new Date(expiryTime).toISOString();
    const expired = expiryTime <= Date.now();
    if (requestItem.expiresAt === expiresAt && !expired) return false;

    const updated: StoredChatRequest = {
      ...requestItem,
      expiresAt,
      ...(expired ? { status: "expired", updatedAt: nowIso() } : {}),
    };
    await persistence?.persistChatRequest(updated);
    Object.assign(requestItem, updated);
    return expired;
  }

  const interestMutationQueues = new Map<string, Promise<unknown>>();

  function pendingInterestFor(userId: string) {
    const value = store.onboardingDrafts.get(userId)?.data.pendingInterest;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const memberId = "memberId" in value && typeof value.memberId === "string" ? value.memberId : "";
    const requestedAt = "requestedAt" in value && typeof value.requestedAt === "string" ? value.requestedAt : null;
    return memberId ? { memberId, requestedAt } : null;
  }

  function draftWithoutPendingInterest(draft: StoredOnboardingDraft) {
    const { pendingInterest: _pendingInterest, ...data } = draft.data;
    return { ...draft, data, updatedAt: nowIso() };
  }

  function serializeInterestMutation<T>(userId: string, operation: () => Promise<T>) {
    const previous = interestMutationQueues.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    let tracked: Promise<T>;
    tracked = current.finally(() => {
      if (interestMutationQueues.get(userId) === tracked) interestMutationQueues.delete(userId);
    });
    interestMutationQueues.set(userId, tracked);
    return tracked;
  }

  async function persistPendingInterest(userId: string, memberId: string) {
    return serializeInterestMutation(userId, async () => {
      const existing = store.onboardingDrafts.get(userId);
      const timestamp = nowIso();
      const draft: StoredOnboardingDraft = {
        userId,
        currentStep: existing?.currentStep ?? 0,
        status: existing?.status ?? "in_progress",
        data: { ...(existing?.data ?? {}), pendingInterest: { memberId, requestedAt: timestamp } },
        updatedAt: timestamp,
        completedAt: existing?.completedAt ?? null,
      };
      await persistence?.persistOnboardingDraft(draft);
      store.onboardingDrafts.set(userId, draft);
    });
  }

  async function activateInterest(userId: string, memberId: string) {
    return serializeInterestMutation(userId, async () => {
      const key = `${userId}:${memberId}`;
      const existing = store.interests.get(key);
      if (existing?.status === "active") return { interest: existing, created: false };
      const timestamp = nowIso();
      const interest = existing
        ? { ...existing, status: "active" as const, updatedAt: timestamp }
        : { id: createId("interest"), userId, memberId, status: "active" as const, createdAt: timestamp, updatedAt: timestamp };
      await persistence?.persistInterest(interest);
      store.interests.set(key, interest);
      return { interest, created: true };
    });
  }

  async function fulfillPendingInterest(userId: string) {
    return serializeInterestMutation(userId, async () => {
      const pending = pendingInterestFor(userId);
      if (!pending) return null;
      const key = `${userId}:${pending.memberId}`;
      try {
        const target = store.members.get(pending.memberId);
        if (!target?.ownerUserId || contactReviewRequired(store, userId, target)) return null;
        if (isBlockedBetween(store, userId, target.ownerUserId)) return null;

        const existingDraft = store.onboardingDrafts.get(userId);
        if (!existingDraft) return null;
        const draft = draftWithoutPendingInterest(existingDraft);
        const existingInterest = store.interests.get(key);
        if (existingInterest?.status === "removed" && pending.requestedAt && Date.parse(existingInterest.updatedAt) > Date.parse(pending.requestedAt)) {
          await persistence?.persistOnboardingDraft(draft);
          store.onboardingDrafts.set(userId, draft);
          return null;
        }
        if (existingInterest?.status === "active") {
          await persistence?.persistOnboardingDraft(draft);
          store.onboardingDrafts.set(userId, draft);
          return existingInterest;
        }

        const timestamp = nowIso();
        const proposedInterest = existingInterest
          ? { ...existingInterest, status: "active" as const, updatedAt: timestamp }
          : { id: createId("interest"), userId, memberId: pending.memberId, status: "active" as const, createdAt: timestamp, updatedAt: timestamp };
        const proposedNotification = {
          ...newNotification({
            userId,
            type: "system",
            title: "心仪对象已保存",
            body: "你的资料已满足联系条件，可以继续通过 AI 分身了解对方。",
            relatedResourceType: "member",
            relatedResourceId: target.ownerUserId,
          }),
          id: proposedInterest.id,
        };
        const persisted = persistence
          ? await persistence.persistPendingInterestFulfillment(proposedInterest, draft, proposedNotification)
          : { interest: proposedInterest, notification: proposedNotification };
        store.interests.set(key, persisted.interest);
        store.onboardingDrafts.set(userId, draft);
        publishNotification(persisted.notification);
        return persisted.interest;
      } catch (cause) {
        operations.logger.error("pending_interest.fulfillment.failed", {
          userId,
          memberId: pending.memberId,
          error: cause instanceof Error ? cause.message : String(cause),
        });
        return null;
      }
    });
  }

  app.get("/api/me", async (request, reply) => {
    const user = await currentAccountUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    if (user.status === "active") await fulfillPendingInterest(user.id);
    return { data: { user: publicUser(user), profile: publicProfile(store.profiles.get(user.id)) } };
  });

  app.get("/api/me/avatar-knowledge", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    return { data: { items: avatarKnowledgeService.listKnowledgeItems(user.id) } };
  });

  app.post<{ Body: { title?: unknown; content?: unknown; topic?: unknown; keywords?: unknown } }>("/api/me/avatar-knowledge", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    try {
      const item = await mutateAvatarKnowledge(() => avatarKnowledgeService.createKnowledgeItem(user.id, {
        title: typeof request.body?.title === "string" ? request.body.title : "",
        content: typeof request.body?.content === "string" ? request.body.content : "",
        topic: typeof request.body?.topic === "string" ? request.body.topic : "",
        keywords: Array.isArray(request.body?.keywords) ? request.body.keywords.filter((item): item is string => typeof item === "string") : [],
      }));
      return reply.code(201).send({ data: { item } });
    } catch (cause) { return sendAvatarKnowledgeError(reply, cause); }
  });

  app.patch<{ Params: { itemId: string }; Body: { title?: string; content?: string; topic?: string; keywords?: string[] } }>("/api/me/avatar-knowledge/:itemId", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    try { return { data: { item: await mutateAvatarKnowledge(() => avatarKnowledgeService.updateKnowledgeItem(user.id, request.params.itemId, request.body ?? {})) } }; }
    catch (cause) { return sendAvatarKnowledgeError(reply, cause); }
  });

  app.delete<{ Params: { itemId: string } }>("/api/me/avatar-knowledge/:itemId", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    try { await mutateAvatarKnowledge(() => avatarKnowledgeService.deleteKnowledgeItem(user.id, request.params.itemId)); return reply.code(204).send(); }
    catch (cause) { return sendAvatarKnowledgeError(reply, cause); }
  });

  app.post<{ Params: { itemId: string }; Body: { status?: unknown; reason?: unknown } }>("/api/me/avatar-knowledge/:itemId/governance", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    try {
      return { data: { item: await mutateAvatarKnowledge(() => avatarKnowledgeService.markKnowledgeItem(user.id, request.params.itemId, { status: request.body?.status as never, reason: typeof request.body?.reason === "string" ? request.body.reason : null })) } };
    } catch (cause) { return sendAvatarKnowledgeError(reply, cause); }
  });

  app.get("/api/me/avatar-versions", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    return { data: { items: avatarKnowledgeService.listVersions(user.id), current: avatarKnowledgeService.getCurrentVersion(user.id), calls: avatarKnowledgeService.listCallLogs(user.id) } };
  });

  app.post<{ Body: { knowledgeItemIds?: unknown; sensitiveItemIds?: unknown; note?: unknown } }>("/api/me/avatar-versions", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    try {
      const version = await mutateAvatarKnowledge(() => avatarKnowledgeService.createDraftVersion(user.id, {
        knowledgeItemIds: Array.isArray(request.body?.knowledgeItemIds) ? request.body.knowledgeItemIds.filter((item): item is string => typeof item === "string") : [],
        sensitiveItemIds: Array.isArray(request.body?.sensitiveItemIds) ? request.body.sensitiveItemIds.filter((item): item is string => typeof item === "string") : [],
        note: typeof request.body?.note === "string" ? request.body.note : null,
      }));
      return reply.code(201).send({ data: { version } });
    } catch (cause) { return sendAvatarKnowledgeError(reply, cause); }
  });

  app.post<{ Params: { versionId: string } }>("/api/me/avatar-versions/:versionId/activate", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    try { return { data: { version: await mutateAvatarKnowledge(() => avatarKnowledgeService.activateVersion(user.id, request.params.versionId)) } }; }
    catch (cause) { return sendAvatarKnowledgeError(reply, cause); }
  });

  app.post<{ Params: { versionId: string } }>("/api/me/avatar-versions/:versionId/rollback", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    try { return { data: { version: await mutateAvatarKnowledge(() => avatarKnowledgeService.rollbackVersion(user.id, request.params.versionId)) } }; }
    catch (cause) { return sendAvatarKnowledgeError(reply, cause); }
  });

  app.get("/api/me/onboarding-draft", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    return { data: { draft: store.onboardingDrafts.get(user.id) ?? null } };
  });

  app.put<{ Body: { currentStep?: unknown; data?: unknown } }>("/api/me/onboarding-draft", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const currentStep = Number(request.body?.currentStep);
    const data = request.body?.data;
    if (!Number.isInteger(currentStep) || currentStep < 1 || currentStep > 15 || typeof data !== "object" || data === null || Array.isArray(data)) {
      return reply.code(400).send(error("ONBOARDING_DRAFT_INVALID", "建档步骤或草稿内容格式不正确。"));
    }
    const existing = store.onboardingDrafts.get(user.id);
    const mergedData = { ...(existing?.data ?? {}), ...(data as Record<string, unknown>) };
    if (JSON.stringify(mergedData).length > 64_000) {
      return reply.code(413).send(error("ONBOARDING_DRAFT_TOO_LARGE", "建档草稿内容过大。"));
    }
    const draft: StoredOnboardingDraft = {
      userId: user.id,
      currentStep,
      status: "in_progress",
      data: mergedData,
      updatedAt: nowIso(),
      completedAt: null,
    };
    await persistence?.persistOnboardingDraft(draft);
    store.onboardingDrafts.set(user.id, draft);
    return { data: { draft } };
  });

  app.patch<{ Body: { visibility?: unknown } }>("/api/me/visibility", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const profile = store.profiles.get(user.id);
    if (!profile) return reply.code(409).send(error("PROFILE_REQUIRED", "请先完成婚恋档案。"));
    const visibility = request.body?.visibility;
    if (visibility !== "private" && visibility !== "approved_only" && visibility !== "public") {
      return reply.code(400).send(error("VISIBILITY_INVALID", "资料可见范围不正确。"));
    }
    profile.visibility = visibility;
    profile.updatedAt = nowIso();
    await persistence?.persistProfileVisibility(user.id, visibility);
    if (visibility === "private") store.members.delete(profileMemberId(user.id));
    else syncApprovedMember(store, user.id);
    return { data: { visibility } };
  });

  app.get("/api/me/sessions", async (request, reply) => {
    const user = await currentAccountUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const { token, session: currentSession } = memorySessionFor(request);
    const items = persistence
      ? await persistence.listSessions(user.id, token)
      : [...store.sessions.values()]
          .filter((session) => session.userId === user.id && session.expiresAt > Date.now())
          .map((session) => ({ ...session, current: session.id === currentSession?.id }))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { data: { items } };
  });

  app.delete<{ Params: { sessionId: string } }>("/api/me/sessions/:sessionId", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const target = [...store.sessions.entries()].find(([, session]) => session.id === request.params.sessionId && session.userId === user.id);
    const persistedItems = target || !persistence ? [] : await persistence.listSessions(user.id, memorySessionFor(request).token);
    if (!target && !persistedItems.some((session) => session.id === request.params.sessionId)) {
      return reply.code(404).send(error("SESSION_NOT_FOUND", "找不到这个登录设备。"));
    }
    if (target) store.sessions.delete(target[0]);
    await persistence?.deleteSessionById(request.params.sessionId, user.id);
    if (target?.[0] === memorySessionFor(request).token) clearRefreshCookie(reply, config.secureCookies);
    return reply.code(204).send();
  });

  app.delete("/api/me/sessions", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const { token, session } = memorySessionFor(request);
    const persistedCurrent = session ?? (persistence ? (await persistence.listSessions(user.id, token)).find((item) => item.current) : undefined);
    for (const [storedToken, storedSession] of store.sessions) {
      if (storedSession.userId === user.id && storedSession.id !== persistedCurrent?.id) store.sessions.delete(storedToken);
    }
    await persistence?.deleteUserSessions(user.id, persistedCurrent?.id);
    return reply.code(204).send();
  });

  app.post<{ Body: { reason?: unknown } }>("/api/me/account/suspend", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
    if (reason.length > 500) return reply.code(400).send(error("REASON_TOO_LONG", "停用原因不能超过 500 字。"));
    const suspendedUser: StoredUser = { ...user, status: "suspended", suspensionSource: "self" };
    if (persistence) await persistence.suspendUserAndDeleteSessions(suspendedUser);
    store.users.set(user.id, suspendedUser);
    for (const [token, session] of store.sessions) if (session.userId === user.id) store.sessions.delete(token);
    store.members.delete(profileMemberId(user.id));
    otpSendTimes.delete(user.phone);
    clearRefreshCookie(reply, config.secureCookies);
    return reply.code(204).send();
  });

  app.post<{ Body: { confirmation?: unknown } }>("/api/me/account/deletion-request", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    if (request.body?.confirmation !== "DELETE") {
      return reply.code(400).send(error("DELETION_CONFIRMATION_REQUIRED", "请确认注销账号。"));
    }
    const requestedAt = nowIso();
    const scheduledAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
    user.deletionRequestedAt = requestedAt;
    user.deletionScheduledAt = scheduledAt;
    await persistence?.persistUser(user);
    return { data: { requestedAt, scheduledAt } };
  });

  app.delete("/api/me/account/deletion-request", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    user.deletionRequestedAt = null;
    user.deletionScheduledAt = null;
    await persistence?.persistUser(user);
    return reply.code(204).send();
  });

  app.post<{ Body: { reason?: unknown; evidence?: unknown } }>("/api/me/appeals", async (request, reply) => {
    const user = await currentAccountUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
    const evidence = Array.isArray(request.body?.evidence) ? request.body.evidence.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
    if (reason.length < 5 || reason.length > 1_000 || evidence.length > 10 || evidence.some((item) => item.length > 500)) {
      return reply.code(400).send(error("APPEAL_INVALID", "请填写 5 至 1000 字的申诉原因，并控制补充说明数量。"));
    }
    const timestamp = nowIso();
    const appeal: StoredAccountAppeal = { id: createId("appeal"), userId: user.id, reason, evidence, status: "pending", resolution: null, createdAt: timestamp, updatedAt: timestamp };
    store.accountAppeals.set(appeal.id, appeal);
    await persistence?.persistAccountAppeal(appeal);
    return reply.code(201).send({ data: { appeal } });
  });

  app.get("/api/me/appeals", async (request, reply) => {
    const user = await currentAccountUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const items = [...store.accountAppeals.values()].filter((item) => item.userId === user.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { data: { items } };
  });

  app.post("/api/me/data-exports", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const existing = [...store.dataExports.values()].find((item) => item.userId === user.id && item.status === "ready" && item.expiresAt && new Date(item.expiresAt).getTime() > Date.now());
    if (existing) return reply.code(409).send(error("DATA_EXPORT_ALREADY_READY", "已有一份可下载的数据文件。"));
    const timestamp = nowIso();
    const avatarKnowledge = avatarKnowledgeService.exportState();
    const contentActivity = contentService.exportState();
    const avatarSessions = [...store.avatarSessions.values()].filter((item) => item.userId === user.id);
    const avatarSessionIds = new Set(avatarSessions.map((item) => item.id));
    const conversations = [...store.conversations.values()].filter((item) => item.participantIds.includes(user.id));
    const conversationIds = new Set(conversations.map((item) => item.id));
    const messages = [...store.messages.values()].filter((item) => conversationIds.has(item.conversationId));
    const messageIds = new Set(messages.map((item) => item.id));
    const exportJob: StoredDataExport = {
      id: createId("data-export"),
      userId: user.id,
      status: "ready",
      payload: {
        exportedAt: timestamp,
        account: publicUser(user),
        profile: publicProfile(store.profiles.get(user.id)),
        onboardingDraft: store.onboardingDrafts.get(user.id) ?? null,
        photos: [...store.photos.values()].filter((item) => item.userId === user.id),
        interests: [...store.interests.values()].filter((item) => item.userId === user.id),
        matchSnapshots: [...store.matchSnapshots.values()].filter((item) => item.userId === user.id).map(publicMatchSnapshot),
        avatarProfile: store.avatarProfiles.get(user.id) ?? null,
        avatarKnowledge: avatarKnowledge.items.filter((item) => item.ownerId === user.id),
        avatarVersions: avatarKnowledge.versions.filter((item) => item.ownerId === user.id),
        avatarModelCalls: avatarKnowledge.callLogs.filter((item) => item.ownerId === user.id),
        avatarSessions,
        avatarMessages: [...store.avatarMessages.values()].filter((item) => avatarSessionIds.has(item.sessionId)),
        chatRequests: [...store.chatRequests.values()].filter((item) => item.fromUserId === user.id || item.toUserId === user.id),
        conversations,
        messages,
        messageReceipts: [...store.messageReceipts.values()].filter((item) => item.userId === user.id || messageIds.has(item.messageId)),
        notifications: [...store.notifications.values()].filter((item) => item.userId === user.id),
        reports: [...store.reports.values()].filter((item) => item.reporterUserId === user.id),
        blocks: [...store.blocks.values()].filter((item) => item.blockerUserId === user.id),
        contentLikes: contentActivity.likes.filter((item) => item.userIds.includes(user.id)),
        eventRegistrations: contentActivity.registrations.filter((item) => item.userId === user.id),
        appeals: [...store.accountAppeals.values()].filter((item) => item.userId === user.id),
      },
      createdAt: timestamp,
      readyAt: timestamp,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
    };
    store.dataExports.set(exportJob.id, exportJob);
    await persistence?.persistDataExport(exportJob);
    const { payload: _payload, ...publicExport } = exportJob;
    return reply.code(201).send({ data: { export: publicExport } });
  });

  app.get("/api/me/data-exports", async (request, reply) => {
    const user = await currentAccountUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const items = [...store.dataExports.values()]
      .filter((item) => item.userId === user.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(({ payload: _payload, ...item }) => item);
    return { data: { items } };
  });

  app.get<{ Params: { exportId: string } }>("/api/me/data-exports/:exportId/download", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const exportJob = store.dataExports.get(request.params.exportId);
    if (!exportJob || exportJob.userId !== user.id) return reply.code(404).send(error("DATA_EXPORT_NOT_FOUND", "找不到这份数据导出。"));
    if (exportJob.status !== "ready" || !exportJob.payload || !exportJob.expiresAt || new Date(exportJob.expiresAt).getTime() <= Date.now()) {
      if (exportJob.status === "ready") {
        exportJob.status = "expired";
        await persistence?.persistDataExport(exportJob);
      }
      return reply.code(410).send(error("DATA_EXPORT_EXPIRED", "这份数据导出已过期。"));
    }
    return reply.header("Content-Disposition", `attachment; filename="personal-data-${exportJob.id}.json"`).send(exportJob.payload);
  });

  app.patch<{ Body: Partial<StoredProfile> & {
    birthYear?: unknown;
    smokingStatus?: unknown;
    childrenStatus?: unknown;
  } }>("/api/me/profile", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));

    const body = request.body ?? {};
    const required = ["nickname", "gender", "birthYear", "city", "district", "job", "maritalStatus", "goal", "introduction"] as const;
    if (required.some((field) => body[field] === undefined || body[field] === "")) {
      return reply.code(400).send(error("PROFILE_INVALID", "请完整填写基本资料。"));
    }
    const birthYear = Number(body.birthYear);
    if (!Number.isInteger(birthYear) || birthYear < 1940 || birthYear > new Date().getFullYear() - 18) {
      return reply.code(400).send(error("PROFILE_INVALID", "出生年份不符合要求。"));
    }
    const preference = readStringRecord(body.preference, { entries: 10, key: 80, value: 500 });
    const rawAnswers = typeof body.answers === "object" && body.answers !== null && !Array.isArray(body.answers)
      ? body.answers as Record<string, unknown>
      : null;
    const answers = rawAnswers
      ? Object.fromEntries(relationshipQuestions.flatMap((question) => {
        const answer = rawAnswers[question];
        return typeof answer === "string" && answer.trim() && answer.length <= 2_000 ? [[question, answer.trim()]] : [];
      }))
      : null;
    if (!preference || !answers || Object.keys(answers).length !== relationshipQuestions.length) {
      return reply.code(400).send(error("PROFILE_INVALID", "交往期待或关系问答格式不符合要求。"));
    }
    if (!supportedGenders.has(String(body.gender))
      || !supportedMaritalStatuses.has(String(body.maritalStatus))
      || !supportedRelationshipGoals.has(String(body.goal))) {
      return reply.code(400).send(error("PROFILE_INVALID", "资料中的性别、婚姻状态或交往目标不受支持。"));
    }
    const smokingStatus = typeof body.smokingStatus === "string" && ["不吸烟", "偶尔吸烟", "吸烟"].includes(body.smokingStatus) ? body.smokingStatus : undefined;
    const childrenStatus = typeof body.childrenStatus === "string" && ["无子女", "有子女", "子女已成年"].includes(body.childrenStatus) ? body.childrenStatus : undefined;
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
    const city = typeof body.city === "string" ? body.city.trim() : "";
    const district = typeof body.district === "string" ? body.district.trim() : "";
    const job = typeof body.job === "string" ? body.job.trim() : "";
    const introduction = typeof body.introduction === "string" ? body.introduction.trim() : "";
    if (!nickname || nickname.length > 40 || !city || city.length > 80 || !district || district.length > 80 || !job || job.length > 80 || !introduction || introduction.length > 1_000) {
      return reply.code(400).send(error("PROFILE_INVALID", "昵称、地区、职业或自我介绍长度不符合要求。"));
    }

    const profile: StoredProfile = {
      userId: user.id,
      nickname,
      gender: String(body.gender),
      birthYear,
      city,
      district,
      job,
      maritalStatus: String(body.maritalStatus),
      goal: String(body.goal),
      introduction,
      preference: {
        ...preference,
        ...(smokingStatus ? { selfSmokingStatus: smokingStatus } : {}),
        ...(childrenStatus ? { selfChildrenStatus: childrenStatus } : {}),
      },
      answers,
      profileStatus: "pending_review",
      visibility: store.profiles.get(user.id)?.visibility ?? "approved_only",
      reviewReason: null,
      updatedAt: nowIso(),
    };
    const existingAvatarProfile = store.avatarProfiles.get(user.id);
    let pausedAvatarProfile: StoredAvatarProfile | undefined;
    if (existingAvatarProfile?.status === "enabled") {
      pausedAvatarProfile = { ...existingAvatarProfile, status: "paused" };
    }
    const completedDraft: StoredOnboardingDraft = {
      userId: user.id,
      currentStep: 15,
      status: "submitted",
      data: store.onboardingDrafts.get(user.id)?.data ?? {},
      updatedAt: nowIso(),
      completedAt: nowIso(),
    };
    if (persistence) await persistence.persistProfileSubmission(profile, pausedAvatarProfile, completedDraft);
    store.members.delete(profileMemberId(user.id));
    if (pausedAvatarProfile) store.avatarProfiles.set(user.id, pausedAvatarProfile);
    store.profiles.set(user.id, profile);
    store.onboardingDrafts.set(user.id, completedDraft);
    return { data: { profile: publicProfile(profile) } };
  });

  app.post<{ Body: { filename?: unknown; mimeType?: unknown; sizeBytes?: unknown; dataUrl?: unknown } }>("/api/me/photos", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const filename = typeof request.body?.filename === "string" ? request.body.filename.trim() : "";
    const mimeType = typeof request.body?.mimeType === "string" ? request.body.mimeType : "";
    const sizeBytes = Number(request.body?.sizeBytes);
    const dataUrl = typeof request.body?.dataUrl === "string" ? request.body.dataUrl : "";
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    const ownPhotos = [...store.photos.values()].filter((item) => item.userId === user.id);
    if (!filename || !allowedTypes.has(mimeType) || !filenameMatchesMimeType(filename, mimeType) || !Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > 8 * 1024 * 1024 || !dataUrl.startsWith(`data:${mimeType};base64,`)) {
      return reply.code(400).send(error("PHOTO_INVALID", "请选择不超过 8MB 的 JPG、PNG 或 WebP 照片。"));
    }
    if (ownPhotos.length >= 6) return reply.code(409).send(error("PHOTO_LIMIT", "最多上传 6 张照片。"));
    const encodedPhoto = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const photoData = Buffer.from(encodedPhoto, "base64");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedPhoto) || photoData.length === 0 || photoData.length > 8 * 1024 * 1024 || photoData.length !== sizeBytes || !photoMatchesMimeType(photoData, mimeType)) {
      return reply.code(400).send(error("PHOTO_INVALID", "请选择不超过 8MB 的 JPG、PNG 或 WebP 照片。"));
    }
    let storedObject: { key: string; url: string };
    try {
      storedObject = await providers.objectStorage.upload({ userId: user.id, filename, mimeType, data: photoData });
    } catch {
      return reply.code(502).send(error("PHOTO_STORAGE_FAILED", "照片上传失败，请稍后重试。"));
    }
    const createdAt = nowIso();
    const photo: StoredPhoto = {
      id: createId("photo"), userId: user.id, filename, objectKey: storedObject.key,
      url: "", mimeType, sizeBytes: photoData.length, isPrimary: ownPhotos.length === 0, reviewStatus: "pending",
      reviewReason: null, createdAt, updatedAt: createdAt,
    };
    photo.url = `/api/photos/${encodeURIComponent(photo.id)}/content`;
    try {
      await persistence?.persistPhoto(photo);
      store.photos.set(photo.id, photo);
    } catch (cause) {
      await providers.objectStorage.delete(storedObject.key).catch(() => undefined);
      throw cause;
    }
    return reply.code(201).send({ data: { photo } });
  });

  app.get("/api/me/photos", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    return { data: { items: [...store.photos.values()].filter((item) => item.userId === user.id) } };
  });

  app.get<{ Params: { photoId: string } }>("/api/photos/:photoId/content", async (request, reply) => {
    const photo = store.photos.get(request.params.photoId);
    const user = await currentUser(request);
    const canReview = user?.role === "admin" || user?.role === "moderator";
    const owner = photo ? store.users.get(photo.userId) : undefined;
    const ownerProfile = photo ? store.profiles.get(photo.userId) : undefined;
    const viewerProfile = user ? store.profiles.get(user.id) : undefined;
    const member = photo ? [...store.members.values()].find((candidate) => candidate.ownerUserId === photo.userId) : undefined;
    const approvedOnlyAccess = Boolean(
      user
      && member
      && user.status === "active"
      && viewerProfile?.profileStatus === "approved"
      && !isBlockedBetween(store, user.id, photo!.userId)
      && matchFor(store, user.id, member),
    );
    const canViewApprovedPhoto = photo?.reviewStatus === "approved"
      && owner?.status === "active"
      && ownerProfile?.profileStatus === "approved"
      && (ownerProfile.visibility === "public"
        || (ownerProfile.visibility === "approved_only" && approvedOnlyAccess));
    const canViewPrivatePhoto = photo?.userId === user?.id || canReview;
    if (!photo || (!canViewApprovedPhoto && !canViewPrivatePhoto)) {
      return reply.code(404).send(error("PHOTO_NOT_FOUND", "找不到这张照片。"));
    }
    try {
      const object = await providers.objectStorage.read(photo.objectKey);
      return reply.type(photo.mimeType || object.mimeType).header("Cache-Control", canViewApprovedPhoto && ownerProfile?.visibility === "public" ? "public, max-age=3600" : "private, no-store").send(object.data);
    } catch {
      return reply.code(404).send(error("PHOTO_NOT_FOUND", "找不到这张照片。"));
    }
  });

  app.post<{ Params: { photoId: string } }>("/api/me/photos/:photoId/primary", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const photo = store.photos.get(request.params.photoId);
    if (!photo || photo.userId !== user.id) return reply.code(404).send(error("PHOTO_NOT_FOUND", "找不到这张照片。"));
    const ownPhotos = [...store.photos.values()].filter((item) => item.userId === user.id);
    for (const item of ownPhotos) {
      item.isPrimary = item.id === photo.id;
      item.updatedAt = nowIso();
      await persistence?.persistPhoto(item);
    }
    syncApprovedMember(store, user.id);
    return { data: { photo } };
  });

  app.delete<{ Params: { photoId: string } }>("/api/me/photos/:photoId", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const photo = store.photos.get(request.params.photoId);
    if (!photo || photo.userId !== user.id) return reply.code(404).send(error("PHOTO_NOT_FOUND", "找不到这张照片。"));
    await persistence?.deletePhoto(photo.id);
    try {
      await providers.objectStorage.delete(photo.objectKey);
    } catch {
      await persistence?.persistPhoto(photo);
      return reply.code(502).send(error("PHOTO_DELETE_FAILED", "照片删除失败，请稍后重试。"));
    }
    store.photos.delete(photo.id);
    const remaining = [...store.photos.values()].filter((item) => item.userId === user.id);
    if (photo.isPrimary && remaining.length > 0) {
      remaining[0].isPrimary = true;
      remaining[0].updatedAt = nowIso();
      await persistence?.persistPhoto(remaining[0]);
    }
    if (!syncApprovedMember(store, user.id)) store.members.delete(profileMemberId(user.id));
    return reply.code(204).send();
  });

  app.post("/api/me/avatar-profile/generate", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const profile = store.profiles.get(user.id);
    if (!profile) return reply.code(409).send(error("PROFILE_REQUIRED", "请先完成婚恋档案。"));
    const approvedFacts = Object.entries(profile.answers).filter(([, answer]) => answer.trim()).map(([topic, fact]) => ({ topic, fact }));
    if (approvedFacts.length === 0) return reply.code(409).send(error("ANSWERS_REQUIRED", "请先完成关系与生活问答。"));
    const current = store.avatarProfiles.get(user.id);
    const avatarProfile: StoredAvatarProfile = {
      userId: user.id,
      version: (current?.version ?? 0) + 1,
      approvedFacts,
      relationshipExpectations: [profile.goal, profile.preference.valuedQualities, profile.preference.relationshipGoal].filter(Boolean),
      boundaries: ["不公开手机号和详细地址", "不替本人作出承诺", profile.preference.dealBreakers ? `明确边界：${profile.preference.dealBreakers}` : ""].filter(Boolean),
      unknownResponse: "这个问题没有得到本人明确授权，建议在双方同意真人聊天后再确认。",
      status: "pending",
      generatedAt: nowIso(),
      enabledAt: null,
    };
    await persistence?.persistAvatarProfile(avatarProfile);
    store.avatarProfiles.set(user.id, avatarProfile);
    return reply.code(201).send({ data: { avatarProfile } });
  });

  app.get("/api/me/avatar-profile", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    return { data: { avatarProfile: store.avatarProfiles.get(user.id) ?? null } };
  });

  app.post("/api/me/avatar-profile/enable", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const avatarProfile = store.avatarProfiles.get(user.id);
    if (!avatarProfile) return reply.code(409).send(error("AVATAR_PROFILE_REQUIRED", "请先生成 AI 分身摘要。"));
    const enabledProfile: StoredAvatarProfile = { ...avatarProfile, status: "enabled", enabledAt: nowIso() };
    await persistence?.persistAvatarProfile(enabledProfile);
    store.avatarProfiles.set(user.id, enabledProfile);
    syncApprovedMember(store, user.id);
    await fulfillPendingInterest(user.id);
    return { data: { avatarProfile: enabledProfile } };
  });

  app.post("/api/me/avatar-profile/pause", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const avatarProfile = store.avatarProfiles.get(user.id);
    if (!avatarProfile || avatarProfile.status === "revoked") return reply.code(409).send(error("AVATAR_PROFILE_REQUIRED", "请先生成 AI 分身摘要。"));
    const pausedProfile: StoredAvatarProfile = { ...avatarProfile, status: "paused" };
    await persistence?.persistAvatarProfile(pausedProfile);
    store.avatarProfiles.set(user.id, pausedProfile);
    store.members.delete(profileMemberId(user.id));
    return { data: { avatarProfile: pausedProfile } };
  });

  app.post("/api/me/avatar-profile/revoke", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const avatarProfile = store.avatarProfiles.get(user.id);
    if (!avatarProfile) return reply.code(409).send(error("AVATAR_PROFILE_REQUIRED", "请先生成 AI 分身摘要。"));
    const revokedProfile: StoredAvatarProfile = { ...avatarProfile, status: "revoked", enabledAt: null };
    await persistence?.persistAvatarProfile(revokedProfile);
    store.avatarProfiles.set(user.id, revokedProfile);
    store.members.delete(profileMemberId(user.id));
    return { data: { avatarProfile: revokedProfile } };
  });

  function isIncompleteLobbyMember(memberId: string) {
    return Boolean(findIncompleteLobbyOwner(store, memberId, config.encryptionKey));
  }

  app.get<{ Querystring: Record<string, unknown> }>("/api/members", async (request, reply) => {
    const viewer = await currentUser(request);
    const hiddenUserIds = viewer ? new Set([...store.blocks.values()].filter((item) => item.blockerUserId === viewer.id || item.blockedUserId === viewer.id).flatMap((item) => [item.blockerUserId, item.blockedUserId])) : new Set<string>();
    try {
      const query = parsePublicMemberSearchQuery(request.query);
      const verifiedMembers = [...store.members.values()]
        .filter((member) => {
          const visibility = member.ownerUserId ? store.profiles.get(member.ownerUserId)?.visibility : undefined;
          const publiclyVisible = visibility ? visibility === "public" : member.demo === true;
          return publiclyVisible && member.ownerUserId !== viewer?.id && !hiddenUserIds.has(member.ownerUserId ?? "");
        })
        .map((member) => publicMember(member, store));
      const profileFiltersActive = Object.entries(query.filters)
        .some(([key, value]) => key !== "sort" && value !== undefined && value !== false);
      const excludedUserIds = new Set(hiddenUserIds);
      if (viewer) excludedUserIds.add(viewer.id);
      const incompleteMembers = query.includeIncomplete && !profileFiltersActive
        ? listIncompleteLobbyMembers(store, config.encryptionKey, excludedUserIds)
        : [];
      const visibleMembers = [...verifiedMembers, ...incompleteMembers];
      const matches = searchPublicMembers(visibleMembers, query.filters);
      const scope = `members:${JSON.stringify(query.filters)}`;
      const page = paginateByStableId(matches, {
        pageSize: query.pageSize,
        secret: config.encryptionKey,
        cursor: query.cursor,
        scope,
        sortKey: (member) => publicMemberCursorKey(member, query.filters.sort ?? "default"),
      });
      const data = { ...page, total: matches.length, pageSize: query.pageSize };
      return { data, items: page.items, notice: "仅返回允许公开的资料，不包含手机号、原始问答、匹配权重或模型提示词。" };
    } catch (cause) {
      if (cause instanceof StableCursorError) return reply.code(400).send(error("INVALID_CURSOR", "分页位置已失效，请重新加载。"));
      if (cause instanceof PublicMemberSearchError) return reply.code(400).send(error(cause.code, "筛选条件不正确，请重新选择。"));
      throw cause;
    }
  });

  app.get<{ Params: { memberId: string } }>("/api/members/:memberId", async (request, reply) => {
    const viewer = await currentUser(request);
    const member = memberForResourceId(store, request.params.memberId);
    if (!member || member.ownerUserId === viewer?.id) return reply.code(404).send(error("MEMBER_NOT_FOUND", "暂时找不到这位用户。"));
    if (viewer && [...store.blocks.values()].some((item) => (item.blockerUserId === viewer.id && item.blockedUserId === member.ownerUserId) || (item.blockedUserId === viewer.id && item.blockerUserId === member.ownerUserId))) {
      return reply.code(404).send(error("MEMBER_NOT_FOUND", "暂时找不到这位用户。"));
    }
    const visibility = member.ownerUserId ? store.profiles.get(member.ownerUserId)?.visibility : undefined;
    if (visibility !== "public" && (!(member.demo === true && !visibility) && (!viewer || visibility !== "approved_only" || !matchFor(store, viewer.id, member)))) {
      return reply.code(404).send(error("MEMBER_NOT_FOUND", "暂时找不到这位用户。"));
    }
    return { data: { member: publicMember(member, store) } };
  });

  app.get<{ Querystring: Record<string, unknown> }>("/api/recommendations", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const profile = store.profiles.get(user.id);
    if (!profile) return reply.code(409).send(error("PROFILE_REQUIRED", "请先完成婚恋档案。"));
    if (store.avatarProfiles.get(user.id)?.status !== "enabled") return reply.code(409).send(error("AVATAR_PROFILE_REQUIRED", "请先生成并启用自己的 AI 分身。"));
    const blockedIds = new Set([...store.blocks.values()].filter((item) => item.blockerUserId === user.id || item.blockedUserId === user.id).flatMap((item) => [item.blockerUserId, item.blockedUserId]));
    let filters;
    let pageSize = 12;
    let cursor: string | undefined;
    try {
      filters = parseMatchFilters(request.query);
      if (request.query.pageSize !== undefined) {
        pageSize = Number(request.query.pageSize);
        if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new StableCursorError("page size is invalid");
      }
      if (request.query.cursor !== undefined) {
        if (typeof request.query.cursor !== "string" || !request.query.cursor.trim()) throw new StableCursorError("cursor is invalid");
        cursor = request.query.cursor.trim();
      }
    } catch (cause) {
      if (cause instanceof StableCursorError) return reply.code(400).send(error("INVALID_CURSOR", "分页位置无效，请重新加载。"));
      if (cause instanceof MatchFilterValidationError) {
        return reply.code(400).send(error(cause.code, "筛选条件不正确，请重新选择。"));
      }
      throw cause;
    }
    const candidates = [...store.members.values()]
      .filter((member) => member.ownerUserId !== user.id
        && !blockedIds.has(member.ownerUserId ?? "")
        && !store.matchSkips.has(`${user.id}:${member.ownerUserId ?? member.id}`))
      .map((member) => {
        return { profile: memberMatchProfile(store, member), member: publicMember(member, store) };
      });
    const items = matchCandidates({ currentProfile: toMatchProfile(profile), candidates, filters });
    let page;
    try {
      const wrapped = items.map((item) => ({ id: item.member.id, item }));
      const sort = filters.sort ?? "default";
      const result = paginateByStableId(wrapped, {
        pageSize,
        secret: config.encryptionKey,
        cursor,
        scope: `recommendations:${user.id}:${JSON.stringify(filters)}`,
        sortKey: (entry) => sort === "age-asc"
          ? [entry.item.member.age]
          : sort === "age-desc"
            ? [-entry.item.member.age]
            : [-entry.item.score],
      });
      page = { items: result.items.map((entry) => entry.item), nextCursor: result.nextCursor, hasMore: result.hasMore };
    } catch (cause) {
      if (cause instanceof StableCursorError) return reply.code(400).send(error("INVALID_CURSOR", "分页位置无效，请重新加载。"));
      throw cause;
    }
    for (const item of page.items) {
      const targetUserId = typeof item.member.userId === "string" ? item.member.userId : item.member.id;
      const snapshot = { id: createId("match-snapshot"), userId: user.id, targetUserId, algorithmVersion: item.algorithmVersion, score: item.score, reasons: item.reasons, factors: item.factors, createdAt: nowIso() };
      store.matchSnapshots.set(snapshot.id, snapshot);
      await persistence?.persistMatchSnapshot(snapshot);
    }
    return { data: { items: page.items.map(publicRecommendation), total: items.length, pageSize, nextCursor: page.nextCursor, hasMore: page.hasMore } };
  });

  app.post<{ Params: { memberId: string } }>("/api/members/:memberId/interest", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const member = store.members.get(request.params.memberId);
    if (!member && isIncompleteLobbyMember(request.params.memberId)) {
      return reply.code(409).send(error("MEMBER_PROFILE_INCOMPLETE", "对方正在完善资料，暂时不能联系。"));
    }
    if (!member) return reply.code(404).send(error("MEMBER_NOT_FOUND", "暂时找不到这位用户。"));
    if (member.ownerUserId === user.id) return reply.code(409).send(error("SELF_NOT_ALLOWED", "不能把自己设为心仪对象。"));
    if (contactReviewRequired(store, user.id, member)) return reply.code(409).send(error("ACCOUNT_REVIEW_REQUIRED", "资料和照片审核通过后才能联系正式会员。"));
    if (member.ownerUserId && isBlockedBetween(store, user.id, member.ownerUserId)) return reply.code(409).send(error("CHAT_BLOCKED", "双方目前无法继续联系。"));

    const result = await activateInterest(user.id, request.params.memberId);
    return reply.code(result.created ? 201 : 200).send({ data: { interest: result.interest } });
  });

  app.post<{ Body: { memberId?: unknown } }>("/api/me/pending-interest", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const memberId = typeof request.body?.memberId === "string" ? request.body.memberId.trim() : "";
    const member = store.members.get(memberId);
    if (!member && isIncompleteLobbyMember(memberId)) {
      return reply.code(409).send(error("MEMBER_PROFILE_INCOMPLETE", "对方正在完善资料，暂时不能联系。"));
    }
    if (!member || member.ownerUserId === user.id) return reply.code(404).send(error("MEMBER_NOT_FOUND", "暂时找不到这位用户。"));
    if (member.ownerUserId && isBlockedBetween(store, user.id, member.ownerUserId)) return reply.code(409).send(error("CHAT_BLOCKED", "双方目前无法继续联系。"));
    if (contactReviewRequired(store, user.id, member)) {
      await persistPendingInterest(user.id, memberId);
      return reply.code(202).send({ data: { intent: { memberId, status: "pending" } } });
    }
    const result = await activateInterest(user.id, memberId);
    return reply.code(result.created ? 201 : 200).send({ data: { intent: { memberId, status: "fulfilled" }, interest: result.interest } });
  });

  app.delete<{ Params: { memberId: string } }>("/api/members/:memberId/interest", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    if (isIncompleteLobbyMember(request.params.memberId)) {
      return reply.code(409).send(error("MEMBER_PROFILE_INCOMPLETE", "对方正在完善资料，暂时不能联系。"));
    }
    const key = `${user.id}:${request.params.memberId}`;
    await serializeInterestMutation(user.id, async () => {
      const interest = store.interests.get(key);
      const pending = pendingInterestFor(user.id);
      const existingDraft = pending?.memberId === request.params.memberId ? store.onboardingDrafts.get(user.id) : undefined;
      const draft = existingDraft ? draftWithoutPendingInterest(existingDraft) : null;
      const removed = interest && interest.status !== "removed"
        ? { ...interest, status: "removed" as const, updatedAt: nowIso() }
        : null;
      if (persistence && draft) await persistence.persistInterestCancellation(removed, draft);
      else if (removed) await persistence?.persistInterest(removed);
      else if (draft) await persistence?.persistOnboardingDraft(draft);
      if (removed) store.interests.set(key, removed);
      if (draft) store.onboardingDrafts.set(user.id, draft);
    });
    return reply.code(204).send();
  });

  app.get("/api/me/interests", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const memberForUser = (userId: string) => [...store.members.values()].find((member) => member.ownerUserId === userId);
    const active = [...store.interests.values()].filter((interest) => interest.status === "active");
    const sent = active.filter((interest) => interest.userId === user.id).flatMap((interest) => {
      const member = store.members.get(interest.memberId);
      return member ? [{ ...interest, member: publicMember(member, store) }] : [];
    });
    const received = active.flatMap((interest) => {
      const target = store.members.get(interest.memberId);
      if (target?.ownerUserId !== user.id) return [];
      const member = memberForUser(interest.userId);
      return member ? [{ ...interest, member: publicMember(member, store) }] : [];
    });
    const mutual = sent.filter((sentItem) => received.some((receivedItem) => receivedItem.member.userId === sentItem.member.userId));
    return { data: { sent, received, mutual } };
  });

  app.post<{ Params: { memberId: string } }>("/api/members/:memberId/skip", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const member = store.members.get(request.params.memberId);
    if (!member && isIncompleteLobbyMember(request.params.memberId)) {
      return reply.code(409).send(error("MEMBER_PROFILE_INCOMPLETE", "对方正在完善资料，暂时不能联系。"));
    }
    if (!member || member.ownerUserId === user.id) return reply.code(404).send(error("MEMBER_NOT_FOUND", "暂时找不到这位用户。"));
    const targetUserId = member.ownerUserId ?? member.id;
    const key = `${user.id}:${targetUserId}`;
    if (!store.matchSkips.has(key)) {
      const skip = { id: createId("match-skip"), userId: user.id, targetUserId, createdAt: nowIso() };
      await persistence?.persistMatchSkip(skip);
      store.matchSkips.set(key, skip);
    }
    return reply.code(204).send();
  });

  app.delete<{ Params: { memberId: string } }>("/api/members/:memberId/skip", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const member = store.members.get(request.params.memberId);
    if (!member && isIncompleteLobbyMember(request.params.memberId)) {
      return reply.code(409).send(error("MEMBER_PROFILE_INCOMPLETE", "对方正在完善资料，暂时不能联系。"));
    }
    if (!member) return reply.code(404).send(error("MEMBER_NOT_FOUND", "暂时找不到这位用户。"));
    const targetUserId = member.ownerUserId ?? member.id;
    await persistence?.deleteMatchSkip(user.id, targetUserId);
    store.matchSkips.delete(`${user.id}:${targetUserId}`);
    return reply.code(204).send();
  });

  app.post<{ Body: { name?: unknown; criteria?: unknown; isDefault?: unknown } }>("/api/me/match-filters", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    const criteria = request.body?.criteria;
    if (!name || name.length > 80 || typeof criteria !== "object" || criteria === null || Array.isArray(criteria)) return reply.code(400).send(error("MATCH_FILTER_INVALID", "筛选方案名称或条件不正确。"));
    try { parseMatchFilters(criteria as Record<string, unknown>); } catch { return reply.code(400).send(error("MATCH_FILTER_INVALID", "筛选条件不正确。")); }
    if ([...store.matchFilters.values()].filter((item) => item.userId === user.id).length >= 10) return reply.code(409).send(error("MATCH_FILTER_LIMIT", "最多保存 10 个筛选方案。"));
    const timestamp = nowIso();
    const filter = { id: createId("match-filter"), userId: user.id, name, criteria: criteria as Record<string, unknown>, isDefault: request.body?.isDefault === true, createdAt: timestamp, updatedAt: timestamp };
    if (filter.isDefault) for (const item of store.matchFilters.values()) if (item.userId === user.id) item.isDefault = false;
    await persistence?.persistMatchFilter(filter);
    store.matchFilters.set(filter.id, filter);
    return reply.code(201).send({ data: { filter } });
  });

  app.get("/api/me/match-filters", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    return { data: { items: [...store.matchFilters.values()].filter((item) => item.userId === user.id).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) } };
  });

  app.delete<{ Params: { filterId: string } }>("/api/me/match-filters/:filterId", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const filter = store.matchFilters.get(request.params.filterId);
    if (!filter || filter.userId !== user.id) return reply.code(404).send(error("MATCH_FILTER_NOT_FOUND", "找不到这个筛选方案。"));
    await persistence?.deleteMatchFilter(filter.id, user.id);
    store.matchFilters.delete(filter.id);
    return reply.code(204).send();
  });

  app.get("/api/avatar-sessions", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const items = [...store.avatarSessions.values()]
      .filter((session) => session.userId === user.id)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => publicAvatarSession(session, store));
    return { data: { items } };
  });

  app.post<{ Body: { memberId?: string } }>("/api/avatar-sessions", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const memberId = typeof request.body?.memberId === "string" ? request.body.memberId : "";
    const member = store.members.get(memberId);
    if (!member && isIncompleteLobbyMember(memberId)) {
      return reply.code(409).send(error("MEMBER_PROFILE_INCOMPLETE", "对方正在完善资料，暂时不能联系。"));
    }
    if (!member) return reply.code(404).send(error("MEMBER_NOT_FOUND", "暂时找不到这位用户。"));
    if (member.ownerUserId === user.id) return reply.code(409).send(error("SELF_NOT_ALLOWED", "不能和自己的 AI 分身聊天。"));
    if (contactReviewRequired(store, user.id, member)) return reply.code(409).send(error("ACCOUNT_REVIEW_REQUIRED", "资料和照片审核通过后才能联系正式会员。"));
    if (member.ownerUserId && isBlockedBetween(store, user.id, member.ownerUserId)) return reply.code(409).send(error("CHAT_BLOCKED", "双方目前无法继续联系。"));
    if (member.demo !== true && store.interests.get(`${user.id}:${member.id}`)?.status !== "active") return reply.code(409).send(error("INTEREST_REQUIRED", "请先选择这位用户为心仪对象。"));
    const avatarProfile = member.ownerUserId ? store.avatarProfiles.get(member.ownerUserId) : undefined;
    if (!avatarProfile || avatarProfile.status !== "enabled") return reply.code(409).send(error("AI_PROFILE_NOT_ENABLED", "对方尚未启用 AI 分身。"));

    const existing = [...store.avatarSessions.values()].find((item) => item.userId === user.id && item.memberId === memberId && item.status === "active");
    if (existing) return reply.code(200).send({ data: { session: publicAvatarSession(existing, store) } });
    const createdAt = nowIso();
    const session: StoredAvatarSession = { id: createId("avatar_session"), userId: user.id, memberId, completedTopics: [], status: "active", createdAt, updatedAt: createdAt };
    store.avatarSessions.set(session.id, session);
    await persistence?.persistAvatarSession(session);
    return reply.code(201).send({ data: { session: publicAvatarSession(session, store) } });
  });

  app.get<{ Params: { sessionId: string } }>("/api/avatar-sessions/:sessionId", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const session = store.avatarSessions.get(request.params.sessionId);
    if (!session || session.userId !== user.id) return reply.code(404).send(error("SESSION_NOT_FOUND", "找不到这次 AI 分身聊天。"));
    return { data: { session: publicAvatarSession(session, store) } };
  });

  app.post<{ Params: { sessionId: string } }>("/api/avatar-sessions/:sessionId/end", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const initialSession = store.avatarSessions.get(request.params.sessionId);
    if (!initialSession || initialSession.userId !== user.id) return reply.code(404).send(error("SESSION_NOT_FOUND", "找不到这次 AI 分身聊天。"));
    const releaseSessionLock = await acquireAvatarSessionLock(initialSession.id);
    try {
      const session = store.avatarSessions.get(initialSession.id);
      if (!session || session.userId !== user.id) return reply.code(404).send(error("SESSION_NOT_FOUND", "找不到这次 AI 分身聊天。"));
      if (session.status === "paused") return { data: { session: publicAvatarSession(session, store) } };
      const endedSession: StoredAvatarSession = { ...session, status: "paused", updatedAt: nowIso() };
      await persistence?.persistAvatarSession(endedSession);
      store.avatarSessions.set(endedSession.id, endedSession);
      return { data: { session: publicAvatarSession(endedSession, store) } };
    } finally {
      releaseSessionLock();
    }
  });

  app.get<{ Params: { sessionId: string } }>("/api/avatar-sessions/:sessionId/messages", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const session = store.avatarSessions.get(request.params.sessionId);
    if (!session || session.userId !== user.id) return reply.code(404).send(error("SESSION_NOT_FOUND", "找不到这次 AI 分身聊天。"));
    const items = [...store.avatarMessages.values()].filter((item) => item.sessionId === session.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { data: { items: items.map(publicAvatarMessage) } };
  });

  async function generateAvatarReply(member: StoredMember, avatarProfile: StoredAvatarProfile, question: string, topicOverride?: AvatarTopicKey) {
    let modelName = avatarModelName;
    let promptVersion = "avatar-profile-v1";
    const modelStartedAt = Date.now();
    const governedVersion = member.ownerUserId ? avatarKnowledgeService.getCurrentVersion(member.ownerUserId) : null;
    let text: string;
    if (governedVersion && (governedVersion.status === "active" || governedVersion.status === "stale")) {
      const answer = await mutateAvatarKnowledge(() => avatarKnowledgeService.answer(member.ownerUserId!, question));
      text = answer.answer;
      modelName = answer.kind === "knowledge" ? avatarModelName : "policy-fallback";
      promptVersion = `avatar-knowledge:${governedVersion.id}`;
    } else {
      text = await providers.avatarModel.reply({
        question,
        topic: topicOverride,
        approvedFacts: avatarProfile.approvedFacts,
        expectations: avatarProfile.relationshipExpectations,
        boundaries: avatarProfile.boundaries,
        unknownResponse: avatarProfile.unknownResponse,
      });
    }
    return { text, modelName, promptVersion, latencyMs: Math.max(0, Date.now() - modelStartedAt) };
  }

  async function persistFailureTask(task: StoredAvatarReplyFailureTask) {
    await persistence?.persistAvatarReplyFailureTask(task);
    store.avatarReplyFailureTasks.set(task.id, task);
  }

  function failureResponseData(message: StoredAvatarMessage, task: StoredAvatarReplyFailureTask) {
    return { message: publicAvatarMessage(message), failureTask: publicAvatarReplyFailureTask(task) };
  }

  function avatarMessageReference(message: StoredAvatarMessage) {
    return { id: message.id, sessionId: message.sessionId, sender: message.sender, createdAt: message.createdAt };
  }

  function enqueueAvatarRetry<T>(taskId: string, work: () => Promise<T>): Promise<T> {
    const previous = avatarRetryQueues.get(taskId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    const settled = run.then(() => undefined, () => undefined);
    avatarRetryQueues.set(taskId, settled);
    return run.finally(() => {
      if (avatarRetryQueues.get(taskId) === settled) avatarRetryQueues.delete(taskId);
    });
  }

  async function acquireAvatarSessionLock(key: string) {
    const previous = avatarSessionLockTails.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => { releaseCurrent = resolve; });
    avatarSessionLockTails.set(key, current);
    await previous.catch(() => undefined);
    return () => {
      releaseCurrent();
      if (avatarSessionLockTails.get(key) === current) avatarSessionLockTails.delete(key);
    };
  }

  async function acquireHumanMessageLock(key: string) {
    const previous = humanMessageLockTails.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => { releaseCurrent = resolve; });
    humanMessageLockTails.set(key, current);
    await previous.catch(() => undefined);
    return () => {
      releaseCurrent();
      if (humanMessageLockTails.get(key) === current) humanMessageLockTails.delete(key);
    };
  }

  app.post<{ Params: { sessionId: string }; Body: { text?: unknown; clientMessageId?: unknown; retry?: unknown; topic?: unknown } }>("/api/avatar-sessions/:sessionId/messages", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const initialSession = store.avatarSessions.get(request.params.sessionId);
    const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
    const rawClientMessageId = request.body?.clientMessageId;
    const clientMessageId = typeof rawClientMessageId === "string" ? rawClientMessageId.trim() : null;
    if (!initialSession || initialSession.userId !== user.id) return reply.code(404).send(error("SESSION_NOT_FOUND", "找不到这次 AI 分身聊天。"));
    if (!text || text.length > 500) return reply.code(400).send(error("MESSAGE_INVALID", "问题不能为空且不能超过 500 字。"));
    if (rawClientMessageId !== undefined && (!clientMessageId || !CLIENT_MESSAGE_ID_PATTERN.test(clientMessageId))) {
      return reply.code(400).send(error("MESSAGE_INVALID", "消息幂等标识格式不正确。"));
    }
    if (request.body?.retry !== undefined && typeof request.body.retry !== "boolean") {
      return reply.code(400).send(error("MESSAGE_INVALID", "重试标记格式不正确。"));
    }
    if (request.body?.topic !== undefined && normalizeAvatarTopic(request.body.topic) === null) {
      return reply.code(400).send(error("MESSAGE_INVALID", "定位主题格式不正确。"));
    }

    const releaseSessionLock = await acquireAvatarSessionLock(initialSession.id);
    try {
      const session = store.avatarSessions.get(request.params.sessionId);
      if (!session || session.userId !== user.id) return reply.code(404).send(error("SESSION_NOT_FOUND", "找不到这次 AI 分身聊天。"));
      const existingUserMessage = clientMessageId
      ? [...store.avatarMessages.values()].find((message) => message.sessionId === session.id && message.sender === "user" && message.clientMessageId === clientMessageId)
      : undefined;
      if (existingUserMessage) {
        if (existingUserMessage.text !== text) return reply.code(409).send(error("AVATAR_MESSAGE_ID_CONFLICT", "同一消息标识不能用于不同问题。"));
        const existingTask = [...store.avatarReplyFailureTasks.values()].find((task) => task.userMessageId === existingUserMessage.id);
        const existingAvatarMessage = [...store.avatarMessages.values()].find((message) =>
          message.sessionId === session.id
          && message.sender === "avatar"
          && (message.clientMessageId === clientMessageId || message.id === existingTask?.resolvedMessageId));
        if (existingAvatarMessage) {
          return reply.code(200).send({ data: { messages: [existingUserMessage, existingAvatarMessage].map(publicAvatarMessage), session: publicAvatarSession(session, store) } });
        }
        if (existingTask) {
          if (request.body?.retry !== true) return reply.code(202).send({ data: failureResponseData(existingUserMessage, existingTask) });
          if (session.status !== "active") return reply.code(409).send(error("AVATAR_RETRY_NOT_ALLOWED", "这次 AI 分身聊天当前不能重试。"));
          const member = store.members.get(session.memberId);
          if (!member) return reply.code(404).send(error("MEMBER_NOT_FOUND", "暂时找不到这位用户。"));
          if (member.ownerUserId && isBlockedBetween(store, user.id, member.ownerUserId)) {
            return reply.code(409).send(error("AVATAR_RETRY_NOT_ALLOWED", "双方当前无法继续联系。"));
          }
          if (member.demo !== true && store.interests.get(`${user.id}:${member.id}`)?.status !== "active") {
            return reply.code(409).send(error("AVATAR_RETRY_NOT_ALLOWED", "这位用户已不在你的心仪名单中。"));
          }
          const avatarProfile = member.ownerUserId ? store.avatarProfiles.get(member.ownerUserId) : undefined;
          if (!avatarProfile || avatarProfile.status !== "enabled") {
            return reply.code(409).send(error("AVATAR_RETRY_NOT_ALLOWED", "对方的 AI 分身暂时不可用。"));
          }

          const retryNow = Date.now();
          const recentRetryAttempts = (avatarMessageWindows.get(user.id) ?? []).filter((sentAt) => sentAt > retryNow - AVATAR_MESSAGE_WINDOW_MS);
          if (recentRetryAttempts.length >= AVATAR_MESSAGE_WINDOW_LIMIT) {
            return reply.code(429).send(error("AVATAR_MESSAGE_RATE_LIMITED", "提问有些频繁，请稍后再试。"));
          }
          avatarMessageWindows.set(user.id, [...recentRetryAttempts, retryNow]);

          const attempts = existingTask.attempts + 1;
          let generated: Awaited<ReturnType<typeof generateAvatarReply>>;
          try {
            generated = await generateAvatarReply(member, avatarProfile, existingUserMessage.text);
          } catch (cause) {
            const updatedTask: StoredAvatarReplyFailureTask = {
              ...existingTask,
              attempts,
              lastError: sanitizedAvatarModelError(cause),
              updatedAt: nowIso(),
            };
            await persistFailureTask(updatedTask);
            return reply.code(502).send({
              ...error("AVATAR_MODEL_UNAVAILABLE", "AI 分身仍然无法回答，请稍后再试。"),
              data: failureResponseData(existingUserMessage, updatedTask),
            });
          }

          const topic = topicForMessage(existingUserMessage.text);
          const resolvedAt = nowIso();
          const avatarMessage: StoredAvatarMessage = {
            id: createId("avatar_message"),
            sessionId: session.id,
            sender: "avatar",
            text: generated.text,
            clientMessageId: existingUserMessage.clientMessageId ?? null,
            topic: existingUserMessage.topic,
            modelName: generated.modelName,
            promptVersion: generated.promptVersion,
            latencyMs: generated.latencyMs,
            createdAt: resolvedAt,
          };
          const resolvedTask: StoredAvatarReplyFailureTask = {
            ...existingTask,
            status: "resolved",
            attempts,
            lastError: null,
            resolvedMessageId: avatarMessage.id,
            updatedAt: resolvedAt,
            resolvedAt,
          };
          const completedTopics = topic && !session.completedTopics.includes(topic.key)
            ? [...session.completedTopics, topic.key]
            : session.completedTopics;
          const resolvedSession: StoredAvatarSession = { ...session, completedTopics, updatedAt: resolvedAt };
          await persistence?.resolveAvatarReplyFailureTask(resolvedTask, avatarMessage, resolvedSession, member.ownerUserId);
          store.avatarMessages.set(avatarMessage.id, avatarMessage);
          store.avatarReplyFailureTasks.set(existingTask.id, resolvedTask);
          store.avatarSessions.set(session.id, resolvedSession);
          return reply.code(200).send({
            data: {
              messages: [existingUserMessage, avatarMessage].map(publicAvatarMessage),
              session: publicAvatarSession(resolvedSession, store),
            },
          });
        }
        const timestamp = nowIso();
        const orphanTask: StoredAvatarReplyFailureTask = {
          id: createId("avatar-reply-failure"),
          sessionId: session.id,
          userMessageId: existingUserMessage.id,
          memberId: session.memberId,
          status: "pending",
          attempts: 1,
          lastError: "模型服务调用状态待恢复",
          resolvedMessageId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          resolvedAt: null,
        };
        await persistFailureTask(orphanTask);
        return reply.code(202).send({ data: failureResponseData(existingUserMessage, orphanTask) });
      }

      if (session.status !== "active") return reply.code(409).send(error("AVATAR_PAUSED", "对方的 AI 分身暂时不可用。"));
      const now = Date.now();
      const recentMessages = (avatarMessageWindows.get(user.id) ?? []).filter((sentAt) => sentAt > now - AVATAR_MESSAGE_WINDOW_MS);
      if (recentMessages.length >= AVATAR_MESSAGE_WINDOW_LIMIT) return reply.code(429).send(error("AVATAR_MESSAGE_RATE_LIMITED", "提问有些频繁，请稍后再试。"));
      const member = store.members.get(session.memberId);
      if (!member) return reply.code(404).send(error("MEMBER_NOT_FOUND", "暂时找不到这位用户。"));
      if (member.ownerUserId && isBlockedBetween(store, user.id, member.ownerUserId)) return reply.code(409).send(error("CHAT_BLOCKED", "双方目前无法继续联系。"));
      if (member.demo !== true && store.interests.get(`${user.id}:${member.id}`)?.status !== "active") return reply.code(409).send(error("INTEREST_REQUIRED", "请先选择这位用户为心仪对象。"));

      const avatarProfile = member.ownerUserId ? store.avatarProfiles.get(member.ownerUserId) : undefined;
      if (!avatarProfile || avatarProfile.status !== "enabled") return reply.code(409).send(error("AI_PROFILE_NOT_ENABLED", "对方的 AI 分身暂时不可用。"));

    const selectedTopic = normalizeAvatarTopic(request.body?.topic);
    const topic = selectedTopic ? { key: selectedTopic, label: AVATAR_TOPIC_LABELS[selectedTopic] } : topicForMessage(text);
    const createdAt = nowIso();
    const userMessage: StoredAvatarMessage = {
      id: createId("avatar_message"),
      sessionId: session.id,
      sender: "user",
      text,
      clientMessageId,
      topic: topic?.label ?? null,
      modelName: null,
      promptVersion: null,
      latencyMs: null,
      createdAt,
    };
    await persistence?.persistAvatarMessages([userMessage]);
    store.avatarMessages.set(userMessage.id, userMessage);
    avatarMessageWindows.set(user.id, [...recentMessages, now]);

    let generated: Awaited<ReturnType<typeof generateAvatarReply>>;
    try {
      generated = await generateAvatarReply(member, avatarProfile, text, selectedTopic ?? undefined);
    } catch (cause) {
      const timestamp = nowIso();
      const failureTask: StoredAvatarReplyFailureTask = {
        id: createId("avatar-reply-failure"),
        sessionId: session.id,
        userMessageId: userMessage.id,
        memberId: member.id,
        status: "pending",
        attempts: 1,
        lastError: sanitizedAvatarModelError(cause),
        resolvedMessageId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        resolvedAt: null,
      };
      await persistFailureTask(failureTask);
      return reply.code(502).send({
        ...error("AVATAR_MODEL_UNAVAILABLE", "AI 分身暂时无法回答，请稍后重试。"),
        data: failureResponseData(userMessage, failureTask),
      });
    }
    const completedTopics = topic && !session.completedTopics.includes(topic.key)
      ? [...session.completedTopics, topic.key]
      : session.completedTopics;
    const avatarMessage: StoredAvatarMessage = {
      id: createId("avatar_message"),
      sessionId: session.id,
      sender: "avatar",
      text: generated.text,
      clientMessageId,
      topic: topic?.label ?? null,
      modelName: generated.modelName,
      promptVersion: generated.promptVersion,
      latencyMs: generated.latencyMs,
      createdAt: nowIso(),
    };
    const completedSession: StoredAvatarSession = { ...session, completedTopics, updatedAt: nowIso() };
    await persistence?.persistAvatarReplySuccess(completedSession, avatarMessage, member.ownerUserId);
    store.avatarSessions.set(session.id, completedSession);
    store.avatarMessages.set(avatarMessage.id, avatarMessage);
      return reply.code(201).send({ data: { messages: [userMessage, avatarMessage].map(publicAvatarMessage), session: publicAvatarSession(completedSession, store) } });
    } finally {
      releaseSessionLock();
    }
  });

  app.get<{ Querystring: { page?: string; pageSize?: string; status?: string } }>("/api/admin/avatar-reply-failures", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    const page = Math.max(1, Number.parseInt(request.query.page ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(request.query.pageSize ?? "20", 10) || 20));
    const status = request.query.status === "pending" || request.query.status === "resolved" ? request.query.status : null;
    const all = [...store.avatarReplyFailureTasks.values()]
      .filter((task) => !status || task.status === status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const total = all.length;
    const items = all.slice((page - 1) * pageSize, page * pageSize).map(publicAvatarReplyFailureTask);
    return { data: { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  });

  app.post<{ Params: { taskId: string } }>("/api/admin/avatar-reply-failures/:taskId/retry", async (request, reply) => {
    const auth = await currentAdministrator(request, reply);
    if (!auth.user) return auth.response;
    return enqueueAvatarRetry(request.params.taskId, async () => {
      const initialTask = store.avatarReplyFailureTasks.get(request.params.taskId);
      if (!initialTask) return reply.code(404).send(error("AVATAR_FAILURE_NOT_FOUND", "找不到这条 AI 回复失败任务。"));
      const releaseSessionLock = await acquireAvatarSessionLock(initialTask.sessionId);
      try {
      const task = store.avatarReplyFailureTasks.get(request.params.taskId);
      if (!task) return reply.code(404).send(error("AVATAR_FAILURE_NOT_FOUND", "找不到这条 AI 回复失败任务。"));
      if (task.status === "resolved") {
        const resolvedMessage = task.resolvedMessageId ? store.avatarMessages.get(task.resolvedMessageId) : undefined;
        if (!resolvedMessage) return reply.code(409).send(error("AVATAR_RETRY_NOT_ALLOWED", "任务已完成，但回复记录暂时不可用。"));
        return { data: { task: publicAvatarReplyFailureTask(task), message: avatarMessageReference(resolvedMessage) } };
      }

      const session = store.avatarSessions.get(task.sessionId);
      const member = store.members.get(task.memberId);
      const requester = session ? store.users.get(session.userId) : undefined;
      const owner = member?.ownerUserId ? store.users.get(member.ownerUserId) : undefined;
      const avatarProfile = member?.ownerUserId ? store.avatarProfiles.get(member.ownerUserId) : undefined;
      const interestAllowed = Boolean(session && member && (member.demo === true || store.interests.get(`${session.userId}:${member.id}`)?.status === "active"));
      const contactAllowed = Boolean(
        session
        && member
        && session.memberId === task.memberId
        && session.status === "active"
        && requester?.status === "active"
        && (!member.ownerUserId || owner?.status === "active")
        && (!member.ownerUserId || !isBlockedBetween(store, session.userId, member.ownerUserId))
        && interestAllowed
        && avatarProfile?.status === "enabled",
      );
      if (!contactAllowed || !session || !member || !avatarProfile) {
        return reply.code(409).send(error("AVATAR_RETRY_NOT_ALLOWED", "会话或会员当前状态不允许重试。"));
      }

      const userMessage = store.avatarMessages.get(task.userMessageId);
      if (!userMessage || userMessage.sessionId !== session.id || userMessage.sender !== "user") {
        return reply.code(409).send(error("AVATAR_RETRY_NOT_ALLOWED", "原始问题记录不可用，无法安全重试。"));
      }

      const attempts = task.attempts + 1;
      let generated: Awaited<ReturnType<typeof generateAvatarReply>>;
      try {
        generated = await generateAvatarReply(member, avatarProfile, userMessage.text);
      } catch (cause) {
        const updatedTask: StoredAvatarReplyFailureTask = {
          ...task,
          attempts,
          lastError: sanitizedAvatarModelError(cause),
          updatedAt: nowIso(),
        };
        await persistFailureTask(updatedTask);
        await writeAdminAudit({
          actorUserId: auth.user.id,
          action: "avatar_reply.retry_failed",
          targetType: "avatar_reply_failure",
          targetId: task.id,
          reason: null,
          metadata: { sessionId: task.sessionId, userMessageId: task.userMessageId, memberId: task.memberId, attempts },
        });
        return reply.code(502).send({
          ...error("AVATAR_MODEL_UNAVAILABLE", "AI 分身仍然无法回答，请稍后再试。"),
          data: { task: publicAvatarReplyFailureTask(updatedTask) },
        });
      }

      const topic = topicForMessage(userMessage.text);
      const resolvedAt = nowIso();
      const avatarMessage: StoredAvatarMessage = {
        id: createId("avatar_message"),
        sessionId: session.id,
        sender: "avatar",
        text: generated.text,
        clientMessageId: userMessage.clientMessageId ?? null,
        topic: userMessage.topic,
        modelName: generated.modelName,
        promptVersion: generated.promptVersion,
        latencyMs: generated.latencyMs,
        createdAt: resolvedAt,
      };
      const resolvedTask: StoredAvatarReplyFailureTask = {
        ...task,
        status: "resolved",
        attempts,
        lastError: null,
        resolvedMessageId: avatarMessage.id,
        updatedAt: resolvedAt,
        resolvedAt,
      };
      const completedTopics = topic && !session.completedTopics.includes(topic.key)
        ? [...session.completedTopics, topic.key]
        : session.completedTopics;
      const resolvedSession: StoredAvatarSession = { ...session, completedTopics, updatedAt: resolvedAt };
      await persistence?.resolveAvatarReplyFailureTask(resolvedTask, avatarMessage, resolvedSession, member.ownerUserId);
      store.avatarMessages.set(avatarMessage.id, avatarMessage);
      store.avatarReplyFailureTasks.set(task.id, resolvedTask);
      store.avatarSessions.set(session.id, resolvedSession);
      await writeAdminAudit({
        actorUserId: auth.user.id,
        action: "avatar_reply.retry_succeeded",
        targetType: "avatar_reply_failure",
        targetId: task.id,
        reason: null,
        metadata: { sessionId: task.sessionId, userMessageId: task.userMessageId, memberId: task.memberId, attempts },
      });
      return { data: { task: publicAvatarReplyFailureTask(resolvedTask), message: avatarMessageReference(avatarMessage) } };
      } finally {
        releaseSessionLock();
      }
    });
  });

  app.get<{ Params: { sessionId: string } }>("/api/avatar-sessions/:sessionId/analysis", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const session = store.avatarSessions.get(request.params.sessionId);
    if (!session || session.userId !== user.id) return reply.code(404).send(error("SESSION_NOT_FOUND", "找不到这次 AI 分身聊天。"));
    const member = store.members.get(session.memberId);
    if (!member) return reply.code(404).send(error("MEMBER_NOT_FOUND", "暂时找不到这位用户。"));
    if (member.ownerUserId && isBlockedBetween(store, user.id, member.ownerUserId)) return reply.code(409).send(error("CHAT_BLOCKED", "双方目前无法继续联系。"));
    const recommendation = matchFor(store, user.id, member);
    const completed = session.completedTopics.length;
    const readiness = chatReadiness(store, session);
    return {
      data: {
        analysis: {
          readiness: readiness.canRequestChat ? "ready" : "learning",
          canRequestChat: readiness.canRequestChat,
          score: recommendation?.score ?? 0,
          completedTopics: session.completedTopics,
          commonPoints: recommendation?.reasons ?? ["双方的公开资料尚不足以通过硬性匹配条件。"],
          discussionTopics: ["未来生活安排", "彼此希望保留的个人空间", "第一次见面的节奏与地点"],
          summary: readiness.canRequestChat
            ? "已经完成基础了解，可以在双方自愿的前提下申请真人聊天。"
            : completed >= 3
              ? "已经完成基础主题，更适合继续了解彼此后再决定是否联系本人。"
              : `还需了解 ${3 - completed} 个主题。`,
        },
      },
    };
  });

  app.post<{ Body: { avatarSessionId?: string } }>("/api/chat-requests", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const sessionId = typeof request.body?.avatarSessionId === "string" ? request.body.avatarSessionId : "";
    const session = store.avatarSessions.get(sessionId);
    if (!session || session.userId !== user.id) return reply.code(404).send(error("SESSION_NOT_FOUND", "找不到这次 AI 分身聊天。"));
    const member = store.members.get(session.memberId);
    if (!member?.ownerUserId) return reply.code(409).send(error("CHAT_NOT_AVAILABLE", "对方暂时还没有开放真人聊天。"));
    if (contactReviewRequired(store, user.id, member)) return reply.code(409).send(error("ACCOUNT_REVIEW_REQUIRED", "资料和照片审核通过后才能联系正式会员。"));
    if (isBlockedBetween(store, user.id, member.ownerUserId)) return reply.code(409).send(error("CHAT_BLOCKED", "双方目前无法继续联系。"));
    if (member.demo !== true && store.interests.get(`${user.id}:${member.id}`)?.status !== "active") return reply.code(409).send(error("INTEREST_REQUIRED", "请先保持对这位用户的心仪选择。"));
    const avatarProfile = store.avatarProfiles.get(member.ownerUserId);
    if (session.status !== "active" || !avatarProfile || avatarProfile.status !== "enabled") return reply.code(409).send(error("AI_PROFILE_NOT_ENABLED", "对方的 AI 分身暂时不可用。"));
    if (!chatReadiness(store, session).canRequestChat) return reply.code(409).send(error("CHAT_NOT_READY", "当前更适合继续了解，暂时不能申请真人聊天。"));
    const existing = [...store.chatRequests.values()].find((item) => item.fromUserId === user.id && item.toUserId === member.ownerUserId);
    if (existing) {
      await expirePendingChatRequest(existing);
      if (existing.status === "rejected" || existing.status === "expired") {
        const renewed: StoredChatRequest = {
          ...existing,
          status: "pending",
          avatarSessionId: session.id,
          memberId: member.id,
          expiresAt: new Date(Date.now() + CHAT_REQUEST_TTL_MS).toISOString(),
          updatedAt: nowIso(),
        };
        await persistence?.persistChatRequest(renewed);
        Object.assign(existing, renewed);
        await createNotification({ userId: existing.toUserId, type: "chat_request_received", title: "收到真人聊天申请", body: "对方希望再次申请与你本人聊天。", relatedResourceType: "chat_request", relatedResourceId: existing.id });
      }
      return reply.code(200).send({ data: { request: publicChatRequest(existing, user.id, store) } });
    }
    const timestamp = nowIso();
    const requestItem: StoredChatRequest = { id: createId("chat_request"), avatarSessionId: session.id, fromUserId: user.id, toUserId: member.ownerUserId, memberId: member.id, status: "pending", expiresAt: new Date(Date.now() + CHAT_REQUEST_TTL_MS).toISOString(), createdAt: timestamp, updatedAt: timestamp };
    store.chatRequests.set(requestItem.id, requestItem);
    await persistence?.persistChatRequest(requestItem);
    await createNotification({
      userId: requestItem.toUserId,
      type: "chat_request_received",
      title: "收到真人聊天申请",
      body: "有人在完成 AI 分身了解后，希望与你本人进一步聊天。",
      relatedResourceType: "chat_request",
      relatedResourceId: requestItem.id,
    });
    return reply.code(201).send({ data: { request: publicChatRequest(requestItem, user.id, store) } });
  });

  app.get("/api/chat-requests", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const items = [...store.chatRequests.values()].filter((item) => item.fromUserId === user.id || item.toUserId === user.id);
    await Promise.all(items.map((item) => expirePendingChatRequest(item)));
    return { data: { items: items.map((item) => publicChatRequest(item, user.id, store)) } };
  });

  app.post<{ Params: { requestId: string } }>("/api/chat-requests/:requestId/accept", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const requestItem = store.chatRequests.get(request.params.requestId);
    if (!requestItem || requestItem.toUserId !== user.id) return reply.code(404).send(error("REQUEST_NOT_FOUND", "找不到这条聊天申请。"));
    if (await expirePendingChatRequest(requestItem)) return reply.code(409).send(error("REQUEST_EXPIRED", "这条聊天申请已过期，请让对方重新申请。"));
    if (requestItem.status === "rejected") return reply.code(409).send(error("REQUEST_CLOSED", "这条申请已经结束。"));
    const existingConversation = conversationForPair(store, requestItem.fromUserId, requestItem.toUserId);
    if (requestItem.status === "accepted" && existingConversation) {
      return { data: { request: publicChatRequest(requestItem, user.id, store), conversation: existingConversation } };
    }
    const requester = store.users.get(requestItem.fromUserId);
    const recipient = store.users.get(requestItem.toUserId);
    if (requester?.status !== "active" || recipient?.status !== "active") return reply.code(409).send(error("CHAT_PARTICIPANT_INACTIVE", "双方账号均正常时才能接受聊天申请。"));
    if (isBlockedBetween(store, requestItem.fromUserId, requestItem.toUserId)) return reply.code(409).send(error("CHAT_BLOCKED", "双方目前无法继续联系。"));
    const targetMember = store.members.get(requestItem.memberId);
    if (!targetMember || targetMember.ownerUserId !== requestItem.toUserId) {
      return reply.code(409).send(error("ACCOUNT_REVIEW_REQUIRED", "对方资料当前不再满足真人聊天条件。"));
    }
    const formalMember = targetMember.demo !== true;
    if (formalMember && (!hasApprovedContactIdentity(store, requestItem.fromUserId) || !hasApprovedContactIdentity(store, requestItem.toUserId))) {
      return reply.code(409).send(error("ACCOUNT_REVIEW_REQUIRED", "双方资料和照片仍通过审核后才能接受聊天申请。"));
    }
    if (formalMember && store.interests.get(`${requestItem.fromUserId}:${requestItem.memberId}`)?.status !== "active") {
      return reply.code(409).send(error("INTEREST_REQUIRED", "申请人需要继续保持对这位用户的心仪选择。"));
    }
    if ((formalMember && store.avatarProfiles.get(requestItem.fromUserId)?.status !== "enabled") || store.avatarProfiles.get(requestItem.toUserId)?.status !== "enabled") {
      return reply.code(409).send(error("AI_PROFILE_NOT_ENABLED", "双方 AI 分身均保持启用时才能接受聊天申请。"));
    }
    const sourceSession = store.avatarSessions.get(requestItem.avatarSessionId);
    if (!sourceSession || sourceSession.userId !== requestItem.fromUserId || sourceSession.memberId !== requestItem.memberId || sourceSession.status !== "active" || !chatReadiness(store, sourceSession).canRequestChat) {
      return reply.code(409).send(error("CHAT_NOT_READY", "原 AI 分身会话不再满足真人联系门槛。"));
    }
    const wasPending = requestItem.status === "pending";
    const acceptedRequest: StoredChatRequest = { ...requestItem, status: "accepted", updatedAt: nowIso() };
    const proposedConversation: StoredConversation = existingConversation
      ? { ...existingConversation, status: "active" }
      : { id: createId("conversation"), chatRequestId: requestItem.id, participantIds: [requestItem.fromUserId, requestItem.toUserId], status: "active", createdAt: nowIso() };
    const conversation = persistence
      ? await persistence.persistAcceptedChatRequest(acceptedRequest, proposedConversation)
      : proposedConversation;
    store.chatRequests.set(requestItem.id, acceptedRequest);
    if (!existingConversation) store.conversations.set(conversation.id, conversation);
    if (wasPending) {
      await createNotification({ userId: acceptedRequest.fromUserId, type: "chat_request_accepted", title: "聊天申请已通过", body: "对方已经同意，现在可以开始真人聊天。", relatedResourceType: "conversation", relatedResourceId: conversation.id });
    }
    return { data: { request: publicChatRequest(acceptedRequest, user.id, store), conversation } };
  });

  app.post<{ Params: { requestId: string } }>("/api/chat-requests/:requestId/reject", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const requestItem = store.chatRequests.get(request.params.requestId);
    if (!requestItem || requestItem.toUserId !== user.id) return reply.code(404).send(error("REQUEST_NOT_FOUND", "找不到这条聊天申请。"));
    if (await expirePendingChatRequest(requestItem)) return reply.code(409).send(error("REQUEST_EXPIRED", "这条聊天申请已过期，无需再次处理。"));
    if (requestItem.status !== "pending") return reply.code(409).send(error("REQUEST_CLOSED", "这条申请已经结束。"));
    requestItem.status = "rejected";
    requestItem.updatedAt = nowIso();
    await persistence?.persistChatRequest(requestItem);
    await createNotification({ userId: requestItem.fromUserId, type: "chat_request_rejected", title: "聊天申请暂未通过", body: "对方暂时没有接受真人聊天申请，请尊重彼此的选择。", relatedResourceType: "chat_request", relatedResourceId: requestItem.id });
    return { data: { request: publicChatRequest(requestItem, user.id, store) } };
  });

  app.get("/api/conversations", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const messagesByConversation = new Map<string, StoredMessage[]>();
    for (const message of store.messages.values()) {
      const messages = messagesByConversation.get(message.conversationId) ?? [];
      messages.push(message);
      messagesByConversation.set(message.conversationId, messages);
    }
    const items = [...store.conversations.values()]
      .filter((item) => item.participantIds.includes(user.id))
      .map((conversation) => {
        const messages = messagesByConversation.get(conversation.id) ?? [];
        const lastMessage = messages.reduce<StoredMessage | null>((latest, message) => (
          !latest || message.createdAt.localeCompare(latest.createdAt) > 0 ? message : latest
        ), null);
        const unreadCount = messages.reduce((count, message) => {
          if (message.senderId === user.id || message.deletedAt) return count;
          const receipt = store.messageReceipts.get(`${message.id}:${user.id}`);
          return receipt && !receipt.readAt ? count + 1 : count;
        }, 0);
        return {
          ...conversation,
          lastMessage: lastMessage ? {
            senderId: lastMessage.senderId,
            text: lastMessage.text,
            createdAt: lastMessage.createdAt,
            deletedAt: lastMessage.deletedAt ?? null,
          } : null,
          unreadCount,
        };
      })
      .sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt));
    return { data: { items } };
  });

  app.post<{ Params: { conversationId: string } }>("/api/conversations/:conversationId/archive", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const conversation = store.conversations.get(request.params.conversationId);
    if (!conversation || !conversation.participantIds.includes(user.id)) return reply.code(404).send(error("CONVERSATION_NOT_FOUND", "找不到这段真人聊天。"));
    if (conversation.status === "blocked") return reply.code(409).send(error("CHAT_BLOCKED", "屏蔽状态下不能结束或恢复聊天。"));
    if (conversation.status === "archived") return { data: { conversation } };
    const previous = { status: conversation.status, archivedAt: conversation.archivedAt ?? null };
    conversation.status = "archived";
    conversation.archivedAt = nowIso();
    try {
      await persistence?.persistConversation(conversation);
    } catch (cause) {
      conversation.status = previous.status;
      conversation.archivedAt = previous.archivedAt;
      throw cause;
    }
    for (const participantId of conversation.participantIds) realtime.publish(participantId, "conversation.updated", { conversationId: conversation.id, conversation });
    return { data: { conversation } };
  });

  app.post<{ Params: { conversationId: string } }>("/api/conversations/:conversationId/restore", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const conversation = store.conversations.get(request.params.conversationId);
    if (!conversation || !conversation.participantIds.includes(user.id)) return reply.code(404).send(error("CONVERSATION_NOT_FOUND", "找不到这段真人聊天。"));
    const [firstUserId, secondUserId] = conversation.participantIds;
    if (conversation.status === "blocked" || (firstUserId && secondUserId && isBlockedBetween(store, firstUserId, secondUserId))) {
      return reply.code(409).send(error("CHAT_BLOCKED", "解除屏蔽后才能恢复聊天。"));
    }
    if (conversation.status === "active") return { data: { conversation } };
    const previousArchivedAt = conversation.archivedAt ?? null;
    conversation.status = "active";
    conversation.archivedAt = null;
    try {
      await persistence?.persistConversation(conversation);
    } catch (cause) {
      conversation.status = "archived";
      conversation.archivedAt = previousArchivedAt;
      throw cause;
    }
    for (const participantId of conversation.participantIds) realtime.publish(participantId, "conversation.updated", { conversationId: conversation.id, conversation });
    return { data: { conversation } };
  });

  app.get("/api/realtime/events", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    let lastEventId: string | undefined;
    const header = request.headers["last-event-id"];
    if (typeof header === "string") lastEventId = header;
    if (lastEventId !== undefined && (!/^\d+$/.test(lastEventId) || !Number.isSafeInteger(Number(lastEventId)))) {
      return reply.code(400).send(error("LAST_EVENT_ID_INVALID", "实时事件序号不正确。"));
    }

    reply.hijack();
    reply.raw.statusCode = 200;
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();
    const connection = presence.connect(user.id);
    let cleaned = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: () => void = () => undefined;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      connection.disconnect();
    };
    unsubscribe = realtime.subscribe(user.id, async (event) => {
      const eventName = event.type;
      const payload = `id: ${event.id}\nevent: ${eventName}\ndata: ${JSON.stringify(event.data)}\n\n`;
      if (!reply.raw.write(payload)) await new Promise<void>((resolve) => reply.raw.once("drain", resolve));
    }, { lastEventId });
    reply.raw.write(": connected\n\n");
    heartbeat = setInterval(() => {
      if (cleaned) return;
      try {
        reply.raw.write(": heartbeat\n\n");
      } catch {
        cleanup();
      }
    }, realtimeHeartbeatMs);
    heartbeat.unref?.();
    request.raw.on("aborted", cleanup);
    reply.raw.on("close", cleanup);
    reply.raw.on("error", cleanup);
  });

  app.get<{ Params: { conversationId: string } }>("/api/conversations/:conversationId/messages", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const conversation = store.conversations.get(request.params.conversationId);
    if (!conversation || !conversation.participantIds.includes(user.id)) return reply.code(404).send(error("CONVERSATION_NOT_FOUND", "找不到这段真人聊天。"));
    const items = [...store.messages.values()]
      .filter((item) => item.conversationId === conversation.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const deliveredAt = nowIso();
    for (const message of items) {
      if (message.senderId === user.id) continue;
      const key = `${message.id}:${user.id}`;
      const receipt = store.messageReceipts.get(key);
      if (receipt && !receipt.deliveredAt) {
        receipt.deliveredAt = deliveredAt;
        await persistence?.persistMessageReceipt(receipt);
      }
    }
    const responseItems = items.map((message) => ({
      ...message,
      receipt: message.senderId === user.id
        ? [...store.messageReceipts.values()].find((item) => item.messageId === message.id) ?? null
        : store.messageReceipts.get(`${message.id}:${user.id}`) ?? null,
    }));
    return { data: { items: responseItems } };
  });

  app.post<{ Params: { conversationId: string } }>("/api/conversations/:conversationId/read", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const conversation = store.conversations.get(request.params.conversationId);
    if (!conversation || !conversation.participantIds.includes(user.id)) return reply.code(404).send(error("CONVERSATION_NOT_FOUND", "找不到这段真人聊天。"));
    const readAt = nowIso();
    const messageIds: string[] = [];
    const senderIds = new Set<string>();
    for (const message of store.messages.values()) {
      if (message.conversationId !== conversation.id || message.senderId === user.id) continue;
      const key = `${message.id}:${user.id}`;
      const receipt = store.messageReceipts.get(key);
      if (!receipt || receipt.readAt) continue;
      receipt.deliveredAt = receipt.deliveredAt ?? readAt;
      receipt.readAt = readAt;
      messageIds.push(message.id);
      senderIds.add(message.senderId);
      await persistence?.persistMessageReceipt(receipt);
    }
    for (const senderId of senderIds) realtime.publish(senderId, "message.read", { conversationId: conversation.id, messageIds, readByUserId: user.id, readAt });
    return { data: { readCount: messageIds.length, readAt } };
  });

  app.post<{ Params: { conversationId: string }; Body: { typing?: unknown } }>("/api/conversations/:conversationId/typing", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const conversation = store.conversations.get(request.params.conversationId);
    if (!conversation || !conversation.participantIds.includes(user.id)) return reply.code(404).send(error("CONVERSATION_NOT_FOUND", "找不到这段真人聊天。"));
    if (conversation.status !== "active") return reply.code(409).send(error("CHAT_BLOCKED", "这段真人聊天目前不可继续。"));
    if (typeof request.body?.typing !== "boolean") return reply.code(400).send(error("TYPING_INVALID", "输入状态格式不正确。"));
    const recipientId = conversation.participantIds.find((id) => id !== user.id);
    const timerKey = `${user.id}:${conversation.id}`;
    const existingTimer = typingTimers.get(timerKey);
    if (existingTimer) clearTimeout(existingTimer);
    typingTimers.delete(timerKey);
    if (recipientId) {
      const expiresAt = request.body.typing ? Date.now() + 5_000 : null;
      realtime.publish(recipientId, "typing.changed", { conversationId: conversation.id, userId: user.id, typing: request.body.typing, expiresAt });
      if (request.body.typing) {
        typingTimers.set(timerKey, setTimeout(() => {
          typingTimers.delete(timerKey);
          realtime.publish(recipientId, "typing.changed", { conversationId: conversation.id, userId: user.id, typing: false, expiresAt: null });
        }, 5_000));
      }
    }
    return reply.code(204).send();
  });

  app.post<{ Params: { conversationId: string }; Body: { text?: unknown; clientMessageId?: unknown } }>("/api/conversations/:conversationId/messages", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const conversation = store.conversations.get(request.params.conversationId);
    if (!conversation || !conversation.participantIds.includes(user.id)) return reply.code(404).send(error("CONVERSATION_NOT_FOUND", "找不到这段真人聊天。"));
    if (conversation.status !== "active") return reply.code(409).send(error("CHAT_BLOCKED", "这段真人聊天目前不可继续。"));
    const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
    const clientMessageId = typeof request.body?.clientMessageId === "string" ? request.body.clientMessageId.trim() : "";
    if (!text || text.length > 1000) return reply.code(400).send(error("MESSAGE_INVALID", "消息不能为空且不能超过 1000 字。"));
    if (!CLIENT_MESSAGE_ID_PATTERN.test(clientMessageId)) return reply.code(400).send(error("CLIENT_MESSAGE_ID_INVALID", "请为消息提供有效的幂等标识。"));
    const releaseLock = await acquireHumanMessageLock(`${conversation.id}:${user.id}:${clientMessageId}`);
    try {
      const existing = [...store.messages.values()].find((item) => item.conversationId === conversation.id && item.senderId === user.id && item.clientMessageId === clientMessageId);
      if (existing) {
        if (existing.text !== text) return reply.code(409).send(error("CLIENT_MESSAGE_ID_CONFLICT", "同一消息标识不能用于不同内容。"));
        return reply.code(200).send({ data: { message: existing } });
      }
      const recipientId = conversation.participantIds.find((id) => id !== user.id);
      if (!recipientId || store.users.get(recipientId)?.status !== "active") return reply.code(409).send(error("CHAT_PARTICIPANT_INACTIVE", "对方账号当前不可用，消息未发送。"));
      if (FINANCIAL_RISK_PATTERN.test(text)) return reply.code(422).send(error("MESSAGE_FINANCIAL_RISK", "消息包含银行卡、转账、汇款或保证金等高风险资金内容，已停止发送。"));

      const now = Date.now();
      const recentMessages = (humanMessageWindows.get(user.id) ?? []).filter((sentAt) => now - sentAt < HUMAN_MESSAGE_WINDOW_MS);
      if (recentMessages.length >= HUMAN_MESSAGE_WINDOW_LIMIT) {
        const retryAfter = Math.max(1, Math.ceil((HUMAN_MESSAGE_WINDOW_MS - (now - recentMessages[0])) / 1_000));
        humanMessageWindows.set(user.id, recentMessages);
        return reply.header("Retry-After", String(retryAfter)).code(429).send(error("HUMAN_MESSAGE_RATE_LIMITED", "消息发送过于频繁，请稍后再试。"));
      }
      humanMessageWindows.set(user.id, [...recentMessages, now]);
      const message: StoredMessage = { id: createId("message"), conversationId: conversation.id, senderId: user.id, text, clientMessageId, createdAt: nowIso() };
      const receipt: StoredMessageReceipt = { id: createId("receipt"), messageId: message.id, userId: recipientId, deliveredAt: null, readAt: null, createdAt: nowIso() };
      const notification = newNotification({ userId: recipientId, type: "new_message", title: "收到新消息", body: "你有一条新的真人聊天消息。", relatedResourceType: "conversation", relatedResourceId: conversation.id });
      let persistedBundle: { message: StoredMessage; receipt: StoredMessageReceipt; notification: StoredNotification };
      try {
        persistedBundle = persistence
          ? await persistence.persistHumanMessageBundle(message, receipt, notification)
          : { message, receipt, notification };
      } catch (cause) {
        const reserved = humanMessageWindows.get(user.id) ?? [];
        const reservationIndex = reserved.lastIndexOf(now);
        if (reservationIndex >= 0) reserved.splice(reservationIndex, 1);
        humanMessageWindows.set(user.id, reserved);
        throw cause;
      }
      const { message: persistedMessage, receipt: persistedReceipt, notification: persistedNotification } = persistedBundle;
      store.messages.set(persistedMessage.id, persistedMessage);
      store.messageReceipts.set(`${persistedMessage.id}:${recipientId}`, persistedReceipt);
      realtime.publish(recipientId, "message.created", { conversationId: conversation.id, message: persistedMessage });
      publishNotification(persistedNotification);
      return reply.code(201).send({ data: { message: persistedMessage } });
    } finally {
      releaseLock();
    }
  });

  app.post<{ Params: { conversationId: string; messageId: string } }>("/api/conversations/:conversationId/messages/:messageId/recall", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const conversation = store.conversations.get(request.params.conversationId);
    if (!conversation || !conversation.participantIds.includes(user.id)) return reply.code(404).send(error("CONVERSATION_NOT_FOUND", "找不到这段真人聊天。"));
    const message = store.messages.get(request.params.messageId);
    if (!message || message.conversationId !== conversation.id) return reply.code(404).send(error("NOT_FOUND", "找不到这条消息。"));
    if (message.senderId !== user.id) return reply.code(403).send(error("FORBIDDEN", "只能撤回自己发送的消息。"));
    if (message.deletedAt) return { data: { message } };
    if (Date.now() - new Date(message.createdAt).getTime() > MESSAGE_RECALL_WINDOW_MS) {
      return reply.code(409).send(error("MESSAGE_RECALL_NOT_ALLOWED", "消息发送超过两分钟，不能撤回。"));
    }
    const original = { text: message.text, deletedAt: message.deletedAt ?? null };
    message.text = "此消息已撤回";
    message.deletedAt = nowIso();
    try {
      await persistence?.persistMessageState(message);
    } catch (cause) {
      message.text = original.text;
      message.deletedAt = original.deletedAt;
      throw cause;
    }
    for (const participantId of conversation.participantIds) realtime.publish(participantId, "message.recalled", { conversationId: conversation.id, message });
    return { data: { message } };
  });

  app.get("/api/notifications", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const items = [...store.notifications.values()].filter((item) => item.userId === user.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { data: { items, unreadCount: items.filter((item) => !item.readAt).length } };
  });

  app.post<{ Params: { notificationId: string } }>("/api/notifications/:notificationId/read", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const item = store.notifications.get(request.params.notificationId);
    if (!item || item.userId !== user.id) return reply.code(404).send(error("NOTIFICATION_NOT_FOUND", "找不到这条通知。"));
    item.readAt = item.readAt ?? nowIso();
    await persistence?.persistNotification(item);
    return { data: { notification: item } };
  });

  app.post("/api/notifications/read-all", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const readAt = nowIso();
    for (const item of store.notifications.values()) {
      if (item.userId !== user.id || item.readAt) continue;
      item.readAt = readAt;
      await persistence?.persistNotification(item);
    }
    return { data: { unreadCount: 0 } };
  });

  app.post<{ Body: { targetUserId?: unknown; reason?: unknown; description?: unknown; avatarSessionId?: unknown; conversationId?: unknown; messageId?: unknown } }>("/api/reports", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const targetUserId = typeof request.body?.targetUserId === "string" ? request.body.targetUserId : "";
    const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
    const description = typeof request.body?.description === "string" ? request.body.description.trim() : "";
    const avatarSessionId = typeof request.body?.avatarSessionId === "string" ? request.body.avatarSessionId : null;
    const conversationId = typeof request.body?.conversationId === "string" ? request.body.conversationId : null;
    const messageId = typeof request.body?.messageId === "string" ? request.body.messageId : null;
    if (!targetUserId || targetUserId === user.id || !store.users.has(targetUserId) || !reason || description.length > 1000) return reply.code(400).send(error("REPORT_INVALID", "举报信息不完整。"));
    if (avatarSessionId) {
      const session = store.avatarSessions.get(avatarSessionId);
      const member = session ? store.members.get(session.memberId) : undefined;
      if (!session || session.userId !== user.id || member?.ownerUserId !== targetUserId || (messageId && store.avatarMessages.get(messageId)?.sessionId !== session.id)) {
        return reply.code(400).send(error("REPORT_EVIDENCE_INVALID", "举报证据不属于这段会话。"));
      }
    }
    if (conversationId) {
      const conversation = store.conversations.get(conversationId);
      const message = messageId ? store.messages.get(messageId) : undefined;
      if (!conversation || !conversation.participantIds.includes(user.id) || !conversation.participantIds.includes(targetUserId)
        || (messageId && (!message || message.conversationId !== conversation.id || message.senderId !== targetUserId))) {
        return reply.code(400).send(error("REPORT_EVIDENCE_INVALID", "举报证据不属于这段会话。"));
      }
    } else if (messageId && !avatarSessionId) {
      return reply.code(400).send(error("REPORT_EVIDENCE_INVALID", "请同时提供证据所属会话。"));
    }
    const createdAt = nowIso();
    const report: StoredReport = { id: createId("report"), reporterUserId: user.id, targetUserId, targetAvatarSessionId: avatarSessionId, targetConversationId: conversationId, targetMessageId: messageId, reason, description, status: "pending", resolution: null, resolvedByUserId: null, createdAt, updatedAt: createdAt };
    store.reports.set(report.id, report);
    await persistence?.persistReport(report);
    return reply.code(201).send({ data: { report } });
  });

  app.post<{ Params: { userId: string } }>("/api/users/:userId/block", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const blockedUserId = request.params.userId;
    if (blockedUserId === user.id || !store.users.has(blockedUserId)) return reply.code(400).send(error("BLOCK_INVALID", "无法屏蔽这个用户。"));
    const key = `${user.id}:${blockedUserId}`;
    const existing = store.blocks.get(key);
    if (existing) return { data: { block: existing } };
    const block: StoredBlock = { id: createId("block"), blockerUserId: user.id, blockedUserId, createdAt: nowIso() };
    await persistence?.persistBlockState(block);
    store.blocks.set(key, block);
    for (const conversation of store.conversations.values()) {
      if (conversation.participantIds.includes(user.id) && conversation.participantIds.includes(blockedUserId)) {
        conversation.status = "blocked";
      }
    }
    return reply.code(201).send({ data: { block } });
  });

  app.get("/api/me/blocks", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const items = [...store.blocks.values()].filter((item) => item.blockerUserId === user.id).map((item) => {
      const member = [...store.members.values()].find((candidate) => candidate.ownerUserId === item.blockedUserId);
      return { ...item, ...(member ? { member: publicMember(member, store) } : {}) };
    });
    return { data: { items } };
  });

  app.delete<{ Params: { userId: string } }>("/api/users/:userId/block", async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send(error("AUTH_REQUIRED", "请先登录。"));
    const key = `${user.id}:${request.params.userId}`;
    if (!store.blocks.has(key)) return reply.code(404).send(error("BLOCK_NOT_FOUND", "黑名单中没有这个用户。"));
    await persistence?.deleteBlockState(user.id, request.params.userId);
    store.blocks.delete(key);
    const stillBlocked = [...store.blocks.values()].some((item) =>
      (item.blockerUserId === user.id && item.blockedUserId === request.params.userId)
      || (item.blockerUserId === request.params.userId && item.blockedUserId === user.id));
    if (!stillBlocked) {
      for (const conversation of store.conversations.values()) {
        if (conversation.participantIds.includes(user.id) && conversation.participantIds.includes(request.params.userId)) {
          conversation.status = "active";
        }
      }
    }
    return reply.code(204).send();
  });

  app.get("/api/admin/moderation", async (request, reply) => {
    const auth = await currentReviewer(request, reply);
    if (!auth.user) return auth.response;
    return { data: { profiles: [...store.profiles.values()].filter((item) => item.profileStatus === "pending_review").map(publicModerationProfile), photos: [...store.photos.values()].filter((item) => item.reviewStatus === "pending") } };
  });

  app.post<{ Params: { userId: string } }>("/api/admin/profiles/:userId/approve", async (request, reply) => {
    const auth = await currentReviewer(request, reply);
    if (!auth.user) return auth.response;
    const profile = store.profiles.get(request.params.userId);
    if (!profile) return reply.code(404).send(error("PROFILE_NOT_FOUND", "找不到待审核资料。"));
    const approvedProfile: StoredProfile = { ...profile, profileStatus: "approved", reviewReason: null, updatedAt: nowIso() };
    await persistence?.persistProfile(approvedProfile);
    store.profiles.set(approvedProfile.userId, approvedProfile);
    const member = syncApprovedMember(store, approvedProfile.userId);
    await fulfillPendingInterest(approvedProfile.userId);
    await writeAdminAudit({ actorUserId: auth.user.id, action: "profile.approved", targetType: "profile", targetId: approvedProfile.userId, reason: null, metadata: {} });
    await createNotification({ userId: approvedProfile.userId, type: "profile_reviewed", title: "婚恋档案审核通过", body: member ? "你的资料已进入匹配大厅。" : "资料已通过，请等待照片审核后进入匹配大厅。", relatedResourceType: "profile", relatedResourceId: approvedProfile.userId });
    return { data: { profile: publicProfile(approvedProfile), member: member ?? { id: profileMemberId(approvedProfile.userId) } } };
  });

  app.post<{ Params: { userId: string }; Body: { reason?: unknown } }>("/api/admin/profiles/:userId/reject", async (request, reply) => {
    const auth = await currentReviewer(request, reply);
    if (!auth.user) return auth.response;
    const profile = store.profiles.get(request.params.userId);
    const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
    if (!profile) return reply.code(404).send(error("PROFILE_NOT_FOUND", "找不到待审核资料。"));
    if (!reason || reason.length > 500) return reply.code(400).send(error("REVIEW_REASON_REQUIRED", "请填写不超过 500 字的拒绝原因。"));
    const rejectedProfile: StoredProfile = { ...profile, profileStatus: "rejected", reviewReason: reason, updatedAt: nowIso() };
    await persistence?.persistProfile(rejectedProfile);
    store.profiles.set(rejectedProfile.userId, rejectedProfile);
    store.members.delete(profileMemberId(rejectedProfile.userId));
    await writeAdminAudit({ actorUserId: auth.user.id, action: "profile.rejected", targetType: "profile", targetId: rejectedProfile.userId, reason, metadata: {} });
    await createNotification({ userId: rejectedProfile.userId, type: "profile_reviewed", title: "婚恋档案需要修改", body: reason, relatedResourceType: "profile", relatedResourceId: rejectedProfile.userId });
    return { data: { profile: publicProfile(rejectedProfile) } };
  });

  app.post<{ Params: { photoId: string } }>("/api/admin/photos/:photoId/approve", async (request, reply) => {
    const auth = await currentReviewer(request, reply);
    if (!auth.user) return auth.response;
    const photo = store.photos.get(request.params.photoId);
    if (!photo) return reply.code(404).send(error("PHOTO_NOT_FOUND", "找不到待审核照片。"));
    const approvedPhoto: StoredPhoto = { ...photo, reviewStatus: "approved", reviewReason: null, updatedAt: nowIso() };
    await persistence?.persistPhoto(approvedPhoto);
    store.photos.set(approvedPhoto.id, approvedPhoto);
    const member = syncApprovedMember(store, approvedPhoto.userId);
    await fulfillPendingInterest(approvedPhoto.userId);
    await writeAdminAudit({ actorUserId: auth.user.id, action: "photo.approved", targetType: "photo", targetId: approvedPhoto.id, reason: null, metadata: { userId: approvedPhoto.userId } });
    await createNotification({ userId: approvedPhoto.userId, type: "photo_reviewed", title: "照片审核通过", body: member ? "你的公开资料已经可以被其他用户看到。" : "照片已通过，请等待资料审核。", relatedResourceType: "photo", relatedResourceId: approvedPhoto.id });
    return { data: { photo: approvedPhoto, member } };
  });

  app.post<{ Params: { photoId: string }; Body: { reason?: unknown } }>("/api/admin/photos/:photoId/reject", async (request, reply) => {
    const auth = await currentReviewer(request, reply);
    if (!auth.user) return auth.response;
    const photo = store.photos.get(request.params.photoId);
    const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
    if (!photo) return reply.code(404).send(error("PHOTO_NOT_FOUND", "找不到待审核照片。"));
    if (!reason || reason.length > 500) return reply.code(400).send(error("REVIEW_REASON_REQUIRED", "请填写不超过 500 字的拒绝原因。"));
    const rejectedPhoto: StoredPhoto = { ...photo, reviewStatus: "rejected", reviewReason: reason, updatedAt: nowIso() };
    await persistence?.persistPhoto(rejectedPhoto);
    store.photos.set(rejectedPhoto.id, rejectedPhoto);
    if (!syncApprovedMember(store, rejectedPhoto.userId)) store.members.delete(profileMemberId(rejectedPhoto.userId));
    await writeAdminAudit({ actorUserId: auth.user.id, action: "photo.rejected", targetType: "photo", targetId: rejectedPhoto.id, reason, metadata: { userId: rejectedPhoto.userId } });
    await createNotification({ userId: rejectedPhoto.userId, type: "photo_reviewed", title: "照片需要重新上传", body: reason, relatedResourceType: "photo", relatedResourceId: rejectedPhoto.id });
    return { data: { photo: rejectedPhoto } };
  });

  app.get("/api/admin/reports", async (request, reply) => {
    const auth = await currentReviewer(request, reply);
    if (!auth.user) return auth.response;
    return { data: { items: [...store.reports.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map((report) => adminReport(store, report)) } };
  });

  app.post<{ Params: { reportId: string }; Body: { resolution?: unknown } }>("/api/admin/reports/:reportId/resolve", async (request, reply) => {
    const auth = await currentReviewer(request, reply);
    if (!auth.user) return auth.response;
    const report = store.reports.get(request.params.reportId);
    const resolution = typeof request.body?.resolution === "string" ? request.body.resolution.trim() : "";
    if (!report) return reply.code(404).send(error("REPORT_NOT_FOUND", "找不到这条举报。"));
    if (!resolution) return reply.code(400).send(error("RESOLUTION_REQUIRED", "请填写处理结果。"));
    report.status = "resolved";
    report.resolution = resolution;
    report.resolvedByUserId = auth.user.id;
    report.updatedAt = nowIso();
    await persistence?.persistReport(report);
    await writeAdminAudit({ actorUserId: auth.user.id, action: "report.resolved", targetType: "report", targetId: report.id, reason: resolution, metadata: { reporterUserId: report.reporterUserId, targetUserId: report.targetUserId } });
    await createNotification({ userId: report.reporterUserId, type: "system", title: "举报已处理", body: resolution, relatedResourceType: "report", relatedResourceId: report.id });
    return { data: { report } };
  });

  return app;
}
