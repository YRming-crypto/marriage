import type { AvatarKnowledgeState } from "../avatar-knowledge/index.js";
import type { ContentActivityState } from "../content/index.js";

export type ProfileStatus = "draft" | "pending_review" | "approved" | "rejected";
export type UserRole = "user" | "moderator" | "admin";
export type ReviewStatus = "pending" | "approved" | "rejected";

export interface StoredUser {
  id: string;
  phone: string;
  role: UserRole;
  status: "active" | "suspended" | "deleted";
  suspensionSource?: "self" | "admin" | null;
  createdAt: string;
  lastActiveAt?: string;
  deletionRequestedAt?: string | null;
  deletionScheduledAt?: string | null;
}

export interface StoredProfile {
  userId: string;
  nickname: string;
  gender: string;
  birthYear: number;
  city: string;
  district: string;
  job: string;
  maritalStatus: string;
  goal: string;
  introduction: string;
  preference: Record<string, string>;
  answers: Record<string, string>;
  profileStatus: ProfileStatus;
  visibility?: "private" | "approved_only" | "public";
  reviewReason?: string | null;
  updatedAt: string;
}

export interface StoredOnboardingDraft {
  userId: string;
  currentStep: number;
  status: "in_progress" | "submitted";
  data: Record<string, unknown>;
  updatedAt: string;
  completedAt: string | null;
}

export interface StoredMember {
  id: string;
  demo?: boolean;
  nickname: string;
  gender: string;
  age: number;
  city: string;
  district: string;
  job: string;
  maritalStatus: string;
  goal: string;
  tags: string[];
  introduction: string;
  photoUrl: string;
  photoUrls?: string[];
  activeLabel: string;
  smokingStatus?: string;
  childrenStatus?: string;
  joinedAt?: string;
  lastActiveAt?: string;
  voiceIntroUrl?: string | null;
  voiceIntroTranscript?: string | null;
  voiceIntroDuration?: number | null;
  verified: boolean;
  ownerUserId?: string;
  score?: number;
}

export interface StoredInterest {
  id: string;
  userId: string;
  memberId: string;
  status: "active" | "removed";
  createdAt: string;
  updatedAt: string;
}

export interface StoredMatchSkip {
  id: string;
  userId: string;
  targetUserId: string;
  createdAt: string;
}

export interface StoredMatchFilter {
  id: string;
  userId: string;
  name: string;
  criteria: Record<string, unknown>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMatchSnapshot {
  id: string;
  userId: string;
  targetUserId: string;
  algorithmVersion: string;
  score: number;
  reasons: string[];
  factors: Array<{ factor: string; label: string; score: number; explanation: string }>;
  createdAt: string;
}

export type AvatarMessageSender = "user" | "avatar";

export interface StoredAvatarSession {
  id: string;
  userId: string;
  memberId: string;
  completedTopics: string[];
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
}

export interface StoredAvatarMessage {
  id: string;
  sessionId: string;
  sender: AvatarMessageSender;
  text: string;
  clientMessageId?: string | null;
  topic: string | null;
  modelName?: string | null;
  promptVersion?: string | null;
  latencyMs?: number | null;
  createdAt: string;
}

export interface StoredAvatarReplyFailureTask {
  id: string;
  sessionId: string;
  userMessageId: string;
  memberId: string;
  status: "pending" | "resolved";
  attempts: number;
  lastError: string | null;
  resolvedMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export type ChatRequestStatus = "pending" | "accepted" | "rejected" | "expired";

export interface StoredChatRequest {
  id: string;
  avatarSessionId: string;
  fromUserId: string;
  toUserId: string;
  memberId: string;
  status: ChatRequestStatus;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredConversation {
  id: string;
  chatRequestId: string;
  participantIds: string[];
  status: "active" | "archived" | "blocked";
  archivedAt?: string | null;
  createdAt: string;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  clientMessageId: string | null;
  deletedAt?: string | null;
  createdAt: string;
}

export interface StoredMessageReceipt {
  id: string;
  messageId: string;
  userId: string;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface StoredPhoto {
  id: string;
  userId: string;
  filename: string;
  objectKey: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  isPrimary: boolean;
  reviewStatus: ReviewStatus;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAvatarProfile {
  userId: string;
  version: number;
  approvedFacts: Array<{ topic: string; fact: string }>;
  relationshipExpectations: string[];
  boundaries: string[];
  unknownResponse: string;
  status: "pending" | "enabled" | "paused" | "revoked";
  generatedAt: string;
  enabledAt: string | null;
}

export interface StoredNotification {
  id: string;
  userId: string;
  type: "photo_reviewed" | "profile_reviewed" | "chat_request_received" | "chat_request_accepted" | "chat_request_rejected" | "new_message" | "system";
  title: string;
  body: string;
  relatedResourceType: string | null;
  relatedResourceId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface PersistedHumanMessageBundle {
  message: StoredMessage;
  receipt: StoredMessageReceipt;
  notification: StoredNotification;
}

export interface PersistedPendingInterestFulfillment {
  interest: StoredInterest;
  notification: StoredNotification;
}

export interface StoredReport {
  id: string;
  reporterUserId: string;
  targetUserId: string;
  targetAvatarSessionId: string | null;
  targetConversationId: string | null;
  targetMessageId: string | null;
  reason: string;
  description: string;
  status: "pending" | "resolved" | "dismissed";
  resolution: string | null;
  resolvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredBlock {
  id: string;
  blockerUserId: string;
  blockedUserId: string;
  createdAt: string;
}

export interface StoredOtpRequest {
  phone: string;
  code: string;
  expiresAt: number;
  attempts?: number;
}

export interface StoredSession {
  id: string;
  userId: string;
  expiresAt: number;
  userAgent: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface StoredAccountAppeal {
  id: string;
  userId: string;
  reason: string;
  evidence: string[];
  status: "pending" | "reviewing" | "approved" | "rejected";
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredDataExport {
  id: string;
  userId: string;
  status: "pending" | "ready" | "failed" | "expired";
  payload: Record<string, unknown> | null;
  createdAt: string;
  readyAt: string | null;
  expiresAt: string | null;
}

export interface StoredAdminAuditLog {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface StoredComment {
  id: string;
  contentItemId: string;
  authorId: string;
  authorName: string;
  authorPhotoUrl: string | null;
  text: string;
  parentId: string | null;
  likeCount: number;
  status: "active" | "hidden";
  createdAt: number;
  updatedAt: number;
}

export interface StoredDailyPick {
  id: string;
  userId: string;
  date: string;
  memberIds: string[];
  reasons: Record<string, string[]>;
  scores: Record<string, number>;
  reactions: Record<string, "interested" | "skipped" | null>;
  createdAt: string;
}

export interface StoredCheckIn {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastCheckInDate: string | null;
  totalPoints: number;
  completedTasks: Record<string, { completedAt: string; pointsAwarded: number }>;
}

export interface StoredVipSubscription {
  userId: string;
  tier: "free" | "monthly" | "quarterly" | "yearly";
  startsAt: string;
  expiresAt: string;
  superLikesRemaining: number;
  superLikesTotal: number;
  createdAt: string;
}

export interface StoredVideoIntro {
  id: string;
  userId: string;
  url: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string;
  reviewStatus: "pending" | "approved" | "rejected";
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSoulTestResult {
  userId: string;
  completedAt: string;
  dimensions: Array<{
    dimension: string;
    dimensionLabel: string;
    labelA: string;
    labelB: string;
    score: number;
    polarity: string;
    description: string;
  }>;
  personalityType: string;
  personalityLabel: string;
  personalityDescription: string;
  tags: string[];
  matchHint: string | null;
}

export interface StoredMaintenanceRun {
  id: string;
  taskName: string;
  actorId: string;
  status: "running" | "succeeded" | "failed";
  startedAt: number;
  finishedAt: number | null;
  totalRemoved: number;
  results: Array<{ target: "accountDeletions" | "otp" | "sessions" | "dataExports" | "typing" | "eventHistory"; status: "succeeded" | "failed"; removedCount: number; error?: string }>;
}

export interface StorePersistence {
  hydrate(store: Store): Promise<void>;
  healthCheck?(): Promise<void>;
  loadContentActivityState(): Promise<ContentActivityState>;
  persistContentActivityState(state: ContentActivityState): Promise<void>;
  loadAvatarKnowledgeState(): Promise<AvatarKnowledgeState>;
  persistAvatarKnowledgeState(state: AvatarKnowledgeState): Promise<void>;
  persistUser(user: StoredUser): Promise<void>;
  suspendUserAndDeleteSessions(user: StoredUser): Promise<void>;
  findUserByPhone(phone: string): Promise<StoredUser | undefined>;
  deleteAccountPrivateData(originalUser: StoredUser, deletedUser: StoredUser): Promise<void>;
  persistProfile(profile: StoredProfile): Promise<void>;
  persistProfileSubmission(profile: StoredProfile, avatarProfile?: StoredAvatarProfile, draft?: StoredOnboardingDraft): Promise<void>;
  persistOtpRequest(request: StoredOtpRequest): Promise<void>;
  verifyOtp(phone: string, code: string): Promise<boolean>;
  deleteOtpRequest(phone: string): Promise<void>;
  persistSession(token: string, session: StoredSession): Promise<void>;
  persistSessionActivity?(token: string, lastUsedAt: string): Promise<void>;
  findUserIdBySessionToken(token: string): Promise<string | undefined>;
  findUserIdByRestrictedSessionToken?(token: string): Promise<string | undefined>;
  deleteSession(token: string): Promise<void>;
  deleteSessionById(sessionId: string, userId: string): Promise<void>;
  deleteUserSessions(userId: string, exceptSessionId?: string): Promise<void>;
  listSessions(userId: string, currentToken?: string): Promise<Array<StoredSession & { current: boolean }>>;
  persistOnboardingDraft(draft: StoredOnboardingDraft): Promise<void>;
  persistProfileVisibility(userId: string, visibility: NonNullable<StoredProfile["visibility"]>): Promise<void>;
  persistAccountAppeal(appeal: StoredAccountAppeal): Promise<void>;
  persistDataExport(exportJob: StoredDataExport): Promise<void>;
  persistAdminAuditLog(entry: StoredAdminAuditLog): Promise<void>;
  persistMaintenanceRun(run: StoredMaintenanceRun): Promise<void>;
  persistInterest(interest: StoredInterest): Promise<void>;
  persistPendingInterestFulfillment(interest: StoredInterest, draft: StoredOnboardingDraft, notification: StoredNotification): Promise<PersistedPendingInterestFulfillment>;
  persistInterestCancellation(interest: StoredInterest | null, draft: StoredOnboardingDraft): Promise<void>;
  persistMatchSkip(skip: StoredMatchSkip): Promise<void>;
  deleteMatchSkip(userId: string, targetUserId: string): Promise<void>;
  persistMatchFilter(filter: StoredMatchFilter): Promise<void>;
  persistMatchSnapshot(snapshot: StoredMatchSnapshot): Promise<void>;
  deleteMatchFilter(filterId: string, userId: string): Promise<void>;
  persistAvatarSession(session: StoredAvatarSession): Promise<void>;
  persistAvatarMessages(messages: StoredAvatarMessage[]): Promise<void>;
  persistAvatarReplySuccess(session: StoredAvatarSession, avatarMessage: StoredAvatarMessage, targetUserId?: string): Promise<void>;
  persistAvatarReplyFailureTask(task: StoredAvatarReplyFailureTask): Promise<void>;
  resolveAvatarReplyFailureTask(task: StoredAvatarReplyFailureTask, avatarMessage: StoredAvatarMessage, session: StoredAvatarSession, targetUserId?: string): Promise<void>;
  persistChatRequest(request: StoredChatRequest): Promise<void>;
  persistConversation(conversation: StoredConversation): Promise<StoredConversation>;
  persistAcceptedChatRequest(request: StoredChatRequest, conversation: StoredConversation): Promise<StoredConversation>;
  persistMessage(message: StoredMessage): Promise<StoredMessage>;
  persistHumanMessageBundle(message: StoredMessage, receipt: StoredMessageReceipt, notification: StoredNotification): Promise<PersistedHumanMessageBundle>;
  persistMessageState(message: StoredMessage): Promise<void>;
  persistMessageReceipt(receipt: StoredMessageReceipt): Promise<void>;
  persistPhoto(photo: StoredPhoto): Promise<void>;
  deletePhoto(photoId: string): Promise<void>;
  persistAvatarProfile(profile: StoredAvatarProfile): Promise<void>;
  persistNotification(notification: StoredNotification): Promise<void>;
  persistReport(report: StoredReport): Promise<void>;
  persistBlockState(block: StoredBlock): Promise<void>;
  deleteBlockState(blockerUserId: string, blockedUserId: string): Promise<void>;
  close(): Promise<void>;
}

export interface Store {
  users: Map<string, StoredUser>;
  usersByPhone: Map<string, string>;
  otpRequests: Map<string, StoredOtpRequest>;
  sessions: Map<string, StoredSession>;
  restrictedSessions: Map<string, StoredSession>;
  onboardingDrafts: Map<string, StoredOnboardingDraft>;
  profiles: Map<string, StoredProfile>;
  members: Map<string, StoredMember>;
  interests: Map<string, StoredInterest>;
  matchSkips: Map<string, StoredMatchSkip>;
  matchFilters: Map<string, StoredMatchFilter>;
  matchSnapshots: Map<string, StoredMatchSnapshot>;
  avatarSessions: Map<string, StoredAvatarSession>;
  avatarMessages: Map<string, StoredAvatarMessage>;
  avatarReplyFailureTasks: Map<string, StoredAvatarReplyFailureTask>;
  chatRequests: Map<string, StoredChatRequest>;
  conversations: Map<string, StoredConversation>;
  messages: Map<string, StoredMessage>;
  messageReceipts: Map<string, StoredMessageReceipt>;
  photos: Map<string, StoredPhoto>;
  avatarProfiles: Map<string, StoredAvatarProfile>;
  notifications: Map<string, StoredNotification>;
  reports: Map<string, StoredReport>;
  blocks: Map<string, StoredBlock>;
  accountAppeals: Map<string, StoredAccountAppeal>;
  dataExports: Map<string, StoredDataExport>;
  adminAuditLogs: Map<string, StoredAdminAuditLog>;
  maintenanceRuns: Map<string, StoredMaintenanceRun>;
  soulTestResults: Map<string, StoredSoulTestResult>;
  dailyPicks: Map<string, StoredDailyPick>;
  comments: Map<string, StoredComment>;
  checkIns: Map<string, StoredCheckIn>;
  vipSubscriptions: Map<string, StoredVipSubscription>;
  videoIntros: Map<string, StoredVideoIntro>;
  persistence?: StorePersistence;
}
