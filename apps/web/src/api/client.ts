import type {
  AcceptChatRequestResponse,
  ApprovePhotoResponse,
  ApproveProfileResponse,
  AvatarProfileResponse,
  BlockUserResponse,
  ChatRequest,
  Conversation,
  CreateReportRequest,
  CreateReportResponse,
  GetAdminModerationResponse,
  GetAdminAccessResponse,
  GetAvatarProfileResponse,
  GetCompatibilityAnalysisResponse,
  GetMemberResponse,
  ListBlocksResponse,
  ListMyPhotosResponse,
  ListNotificationsResponse,
  ListRecommendationsResponse,
  MarkNotificationReadResponse,
  MarkAllNotificationsReadResponse,
  Member,
  MembersQuery,
  ListMembersResponse,
  Message,
  ResolveReportResponse,
  RejectChatRequestResponse,
  RejectPhotoResponse,
  RejectProfileResponse,
  PhotoMutationResponse,
  ProfileStatus,
  UploadPhotoRequest,
  UploadPhotoResponse,
  VerifyAdminAccessResponse,
  UserRole,
  UserStatus,
  AccountAppeal,
  AccountSession,
  AvatarReplyFailureTask,
  ContentItem,
  DataExportJob,
  ProfileVisibility,
  Report,
  SavedMatchFilter,
} from "@ai-marriage/shared";

const API_BASE = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4184").replace(/\/$/, "");

const ACCOUNT_CONNECTION_ERROR = "账号服务暂时无法连接，请确认本地 API 已启动后重试。";
const GENERAL_CONNECTION_ERROR = "服务暂时无法连接，请稍后重试。";

class ApiTransportError extends Error {
  constructor() {
    super(GENERAL_CONNECTION_ERROR);
    this.name = "ApiTransportError";
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers,
    });
  } catch {
    throw new ApiTransportError();
  }

  if (response.ok && response.status === 204) return undefined as T;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiTransportError();
  }

  if (!response.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
    if (error && typeof error.message === "string" && error.message.trim().length > 0) {
      if (typeof error.code === "string" && error.code.trim().length > 0) {
        throw new ApiError(error.message, error.code, response.status);
      }
      throw new Error(error.message);
    }
    throw new ApiTransportError();
  }
  return (isRecord(body) ? body.data : undefined) as T;
}

export interface OtpRequestResult {
  sent: true;
  expiresIn: number;
  devCode?: string;
}

export interface OtpVerifyResult {
  user: { id: string; phoneMasked: string; role?: UserRole; status?: UserStatus };
  profile: Record<string, unknown> | null;
}

function isOtpRequestResult(value: unknown): value is OtpRequestResult {
  return isRecord(value)
    && value.sent === true
    && typeof value.expiresIn === "number"
    && Number.isFinite(value.expiresIn)
    && value.expiresIn > 0
    && (value.devCode === undefined || (typeof value.devCode === "string" && /^\d{6}$/.test(value.devCode)));
}

function isOtpVerifyResult(value: unknown): value is OtpVerifyResult {
  if (!isRecord(value) || !isRecord(value.user)) return false;
  const { id, phoneMasked, status } = value.user;
  return typeof id === "string"
    && id.trim().length > 0
    && typeof phoneMasked === "string"
    && phoneMasked.trim().length > 0
    && (status === undefined || status === "active" || status === "suspended" || status === "deleted")
    && (value.profile === null || isRecord(value.profile));
}

function mapOtpTransportError(error: unknown): never {
  if (error instanceof ApiTransportError) throw new Error(ACCOUNT_CONNECTION_ERROR);
  throw error;
}

export async function requestOtp(phone: string): Promise<OtpRequestResult> {
  try {
    const result = await apiRequest<unknown>("/api/auth/otp/request", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
    if (!isOtpRequestResult(result)) throw new Error(ACCOUNT_CONNECTION_ERROR);
    return result;
  } catch (error) {
    return mapOtpTransportError(error);
  }
}

export async function verifyOtp(phone: string, code: string): Promise<OtpVerifyResult> {
  try {
    const result = await apiRequest<unknown>("/api/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone, code }),
    });
    if (!isOtpVerifyResult(result)) throw new Error(ACCOUNT_CONNECTION_ERROR);
    return result;
  } catch (error) {
    return mapOtpTransportError(error);
  }
}

export function getMembers(input: string | MembersQuery = {}) {
  const filters: MembersQuery = typeof input === "string" ? { city: input } : input;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== "不限") search.set(key, String(value));
  }
  return apiRequest<ListMembersResponse>(`/api/members${search.size ? `?${search}` : ""}`);
}

export function getMember(memberId: string) {
  return apiRequest<GetMemberResponse>(`/api/members/${encodeURIComponent(memberId)}`);
}

export function uploadPhoto(photo: UploadPhotoRequest) {
  return apiRequest<UploadPhotoResponse>("/api/me/photos", {
    method: "POST",
    body: JSON.stringify(photo),
  });
}

export function getMyPhotos() {
  return apiRequest<ListMyPhotosResponse>("/api/me/photos");
}

export function setPrimaryPhoto(photoId: string) {
  return apiRequest<PhotoMutationResponse>(`/api/me/photos/${encodeURIComponent(photoId)}/primary`, {
    method: "POST",
  });
}

export function deletePhoto(photoId: string) {
  return apiRequest<void>(`/api/me/photos/${encodeURIComponent(photoId)}`, { method: "DELETE" });
}

export function generateAvatarProfile() {
  return apiRequest<AvatarProfileResponse>("/api/me/avatar-profile/generate", { method: "POST" });
}

export function getAvatarProfile() {
  return apiRequest<GetAvatarProfileResponse>("/api/me/avatar-profile");
}

export function enableAvatarProfile() {
  return apiRequest<AvatarProfileResponse>("/api/me/avatar-profile/enable", { method: "POST" });
}

export function pauseAvatarProfile() {
  return apiRequest<AvatarProfileResponse>("/api/me/avatar-profile/pause", { method: "POST" });
}

export function revokeAvatarProfile() {
  return apiRequest<AvatarProfileResponse>("/api/me/avatar-profile/revoke", { method: "POST" });
}

export function getRecommendations(filters: Record<string, string | number | undefined> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") search.set(key, String(value));
  return apiRequest<ListRecommendationsResponse>(`/api/recommendations${search.size ? `?${search}` : ""}`);
}

export function saveProfile(profile: {
  nickname: string;
  gender: string;
  birthYear: number;
  city: string;
  district: string;
  job: string;
  maritalStatus: string;
  goal: string;
  introduction: string;
  smokingStatus?: string;
  childrenStatus?: string;
  preference: Record<string, string>;
  answers: Record<string, string>;
}) {
  return apiRequest<{ profile: Record<string, unknown> }>("/api/me/profile", {
    method: "PATCH",
    body: JSON.stringify(profile),
  });
}

export interface MyProfile {
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
  visibility?: ProfileVisibility;
  reviewReason?: string | null;
  updatedAt: string;
}

export interface GetMeResponse {
  user: {
    id: string;
    phoneMasked: string;
    role: UserRole;
    status: UserStatus;
    suspensionSource?: "self" | "admin" | null;
    deletionRequestedAt?: string | null;
    deletionScheduledAt?: string | null;
  };
  profile: MyProfile | null;
}

export interface MemberInterest {
  id: string;
  userId: string;
  memberId: string;
  status: "active" | "removed";
  createdAt: string;
  updatedAt: string;
  member: Member;
}

export interface AdminAccount {
  id: string;
  phoneMasked: string;
  status: UserStatus;
  role: UserRole;
  profileCompleted: boolean;
  nickname: string | null;
  city: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminAuditEntry {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminReportPartySummary {
  userId: string;
  nickname?: string | null;
  city?: string | null;
}

export interface AdminReportEvidence {
  source?: "human_message" | "avatar_session" | string;
  avatarSessionId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  targetAvatarSessionId?: string | null;
  targetConversationId?: string | null;
  targetMessageId?: string | null;
  messages?: Array<{ id?: string; sender?: string; text?: string; createdAt?: string }>;
}

export interface AdminReport extends Report {
  reporter?: AdminReportPartySummary | null;
  target?: AdminReportPartySummary | null;
  evidence?: AdminReportEvidence | null;
}

export interface AdminCleanupStepResult {
  target: "accountDeletions" | "otp" | "sessions" | "dataExports" | "typing" | "eventHistory" | string;
  status: "succeeded" | "failed";
  removedCount: number;
  error?: string;
}

export interface AdminMaintenanceRun {
  id: string;
  taskName: string;
  actorId?: string;
  status: "running" | "succeeded" | "failed";
  startedAt: number;
  finishedAt: number | null;
  results: AdminCleanupStepResult[];
  totalRemoved: number;
}

export interface AdminOperationsSummary {
  generatedAt: number;
  health: {
    status: "healthy" | "degraded" | "unhealthy";
    checkedAt: number;
    components: Array<{ name: string; status: "healthy" | "degraded" | "unhealthy"; detail?: string }>;
  };
  requests: {
    requestCount: number;
    errorCount: number;
    errorRate: number;
    latencyMs: { average: number; p95: number };
  };
  maintenance: {
    runningCount: number;
    succeededCount: number;
    failedCount: number;
    totalRemoved: number;
    recentRuns: AdminMaintenanceRun[];
  };
  recentErrors: Array<{ id: number; level?: "debug" | "info" | "warn" | "error"; event: string; occurredAt: number; context: Record<string, unknown> }>;
}

export interface CreateAdminContentInput {
  type: "article" | "event";
  title: string;
  summary: string;
  body: string;
  tags?: string[];
  coverImageUrl?: string | null;
  event?: { startsAt: number; endsAt: number; location: string; capacity: number };
}

export function getOnboardingDraft() {
  return apiRequest<{ draft: { currentStep: number; status: "in_progress" | "submitted"; data: Record<string, unknown>; updatedAt: string; completedAt: string | null } | null }>("/api/me/onboarding-draft");
}

export function saveOnboardingDraft(currentStep: number, data: Record<string, unknown>) {
  return apiRequest<{ draft: { currentStep: number; status: "in_progress" | "submitted"; data: Record<string, unknown>; updatedAt: string; completedAt: string | null } }>("/api/me/onboarding-draft", { method: "PUT", body: JSON.stringify({ currentStep, data }) });
}

export function updateProfileVisibility(visibility: ProfileVisibility) {
  return apiRequest<{ visibility: ProfileVisibility }>("/api/me/visibility", { method: "PATCH", body: JSON.stringify({ visibility }) });
}

export function getAccountSessions() { return apiRequest<{ items: AccountSession[] }>("/api/me/sessions"); }
export function revokeAccountSession(sessionId: string) { return apiRequest<void>(`/api/me/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }); }
export function revokeOtherAccountSessions() { return apiRequest<void>("/api/me/sessions", { method: "DELETE" }); }
export function suspendAccount(reason: string) { return apiRequest<void>("/api/me/account/suspend", { method: "POST", body: JSON.stringify({ reason }) }); }
export function requestAccountDeletion() { return apiRequest<{ requestedAt: string; scheduledAt: string }>("/api/me/account/deletion-request", { method: "POST", body: JSON.stringify({ confirmation: "DELETE" }) }); }
export function cancelAccountDeletion() { return apiRequest<void>("/api/me/account/deletion-request", { method: "DELETE" }); }
export function getAccountAppeals() { return apiRequest<{ items: AccountAppeal[] }>("/api/me/appeals"); }
export function submitAccountAppeal(input: { reason: string; evidence: string[] }) { return apiRequest<{ appeal: AccountAppeal }>("/api/me/appeals", { method: "POST", body: JSON.stringify(input) }); }
export function requestPersonalDataExport() { return apiRequest<{ export: DataExportJob }>("/api/me/data-exports", { method: "POST" }); }
export function getPersonalDataExports() { return apiRequest<{ items: DataExportJob[] }>("/api/me/data-exports"); }
export async function downloadPersonalDataExport(exportId: string) {
  const response = await fetch(`${API_BASE}/api/me/data-exports/${encodeURIComponent(exportId)}/download`, { credentials: "include" });
  if (!response.ok) throw new Error("数据文件下载失败，请重新生成后再试。");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `personal-data-${exportId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function cancelInterest(memberId: string) { return apiRequest<void>(`/api/members/${encodeURIComponent(memberId)}/interest`, { method: "DELETE" }); }
export function getInterests() { return apiRequest<{ sent: MemberInterest[]; received: MemberInterest[]; mutual: MemberInterest[] }>("/api/me/interests"); }
export function skipMember(memberId: string) { return apiRequest<void>(`/api/members/${encodeURIComponent(memberId)}/skip`, { method: "POST" }); }
export function restoreSkippedMember(memberId: string) { return apiRequest<void>(`/api/members/${encodeURIComponent(memberId)}/skip`, { method: "DELETE" }); }
export function getMatchFilters() { return apiRequest<{ items: SavedMatchFilter[] }>("/api/me/match-filters"); }
export function saveMatchFilter(input: { name: string; criteria: Record<string, unknown>; isDefault?: boolean }) { return apiRequest<{ filter: SavedMatchFilter }>("/api/me/match-filters", { method: "POST", body: JSON.stringify(input) }); }
export function deleteMatchFilter(filterId: string) { return apiRequest<void>(`/api/me/match-filters/${encodeURIComponent(filterId)}`, { method: "DELETE" }); }

export function getContent(filters: Record<string, string | number | boolean | undefined> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined) search.set(key, String(value));
  return apiRequest<{ items: ContentItem[]; page: number; pageSize: number; total: number; totalPages: number }>(`/api/content${search.size ? `?${search}` : ""}`);
}
export function getContentItem(contentId: string) { return apiRequest<{ content: ContentItem }>(`/api/content/${encodeURIComponent(contentId)}`); }
export function createMoment(input: {
  body: string;
  images: Array<{ filename: string; mimeType: "image/jpeg" | "image/png" | "image/webp"; sizeBytes: number; dataUrl: string }>;
}) {
  return apiRequest<{ content: ContentItem }>("/api/me/moments", { method: "POST", body: JSON.stringify(input) });
}
export function getMyContent() { return apiRequest<{ items: ContentItem[] }>("/api/me/content"); }
export function deleteMyContent(contentId: string) {
  return apiRequest<void>(`/api/me/content/${encodeURIComponent(contentId)}`, { method: "DELETE" });
}
export function likeContent(contentId: string) { return apiRequest<{ liked: boolean; changed: boolean; likeCount: number }>(`/api/content/${encodeURIComponent(contentId)}/like`, { method: "POST" }); }
export function unlikeContent(contentId: string) { return apiRequest<{ liked: boolean; changed: boolean; likeCount: number }>(`/api/content/${encodeURIComponent(contentId)}/like`, { method: "DELETE" }); }
export interface EventRegistrationResult {
  changed: boolean;
  registration: {
    id: string;
    contentId: string;
    userId: string;
    status: "registered" | "cancelled";
    registeredAt: number;
    cancelledAt: number | null;
    updatedAt: number;
  } | null;
  registrationCount: number;
  remainingCapacity: number;
}
export interface EventRegistrationListItem {
  registration: NonNullable<EventRegistrationResult["registration"]>;
  content: ContentItem;
}
export function registerEvent(contentId: string) { return apiRequest<EventRegistrationResult>(`/api/content/${encodeURIComponent(contentId)}/register`, { method: "POST" }); }
export function cancelEventRegistration(contentId: string) { return apiRequest<EventRegistrationResult>(`/api/content/${encodeURIComponent(contentId)}/register`, { method: "DELETE" }); }
export function getMyEventRegistrations() { return apiRequest<{ items: EventRegistrationListItem[] }>("/api/me/event-registrations"); }

export function getMe() {
  return apiRequest<GetMeResponse>("/api/me");
}

export function logout() {
  return apiRequest<void>("/api/auth/logout", { method: "POST" });
}

export function createInterest(memberId: string) {
  return apiRequest<{ interest: { id: string; memberId: string } }>(`/api/members/${encodeURIComponent(memberId)}/interest`, {
    method: "POST",
  });
}

export function savePendingInterest(memberId: string) {
  return apiRequest<{ intent: { memberId: string; status: "pending" | "fulfilled" } }>("/api/me/pending-interest", {
    method: "POST",
    body: JSON.stringify({ memberId }),
  });
}

export interface AvatarSessionSummary {
  id: string;
  memberId: string;
  completedTopics: string[];
  completedTopicCount: number;
  requiredTopicCount: number;
  canRequestChat: boolean;
  status: "active" | "paused";
}

export function getAvatarSessions() {
  return apiRequest<{ items: AvatarSessionSummary[] }>("/api/avatar-sessions");
}

export function createAvatarSession(memberId: string) {
  return apiRequest<{ session: { id: string; completedTopicCount: number; canRequestChat: boolean } }>("/api/avatar-sessions", {
    method: "POST",
    body: JSON.stringify({ memberId }),
  });
}

export function getAvatarSession(sessionId: string) {
  return apiRequest<{ session: { id: string; completedTopicCount: number; canRequestChat: boolean } }>(`/api/avatar-sessions/${encodeURIComponent(sessionId)}`);
}

export function endAvatarSession(sessionId: string) {
  return apiRequest<{ session: { id: string; status: "paused" } }>(`/api/avatar-sessions/${encodeURIComponent(sessionId)}/end`, { method: "POST" });
}

export function getAvatarMessages(sessionId: string) {
  return apiRequest<{ items: Array<{ id: string; sender: "user" | "avatar"; text: string }> }>(`/api/avatar-sessions/${encodeURIComponent(sessionId)}/messages`);
}

export async function sendAvatarMessage(sessionId: string, text: string, clientMessageId: string, retry = false, topic?: string) {
  const result = await apiRequest<
    | { messages: Array<{ id: string; sender: "user" | "avatar"; text: string }>; session: { completedTopicCount: number; canRequestChat: boolean } }
    | { message: { id: string; sender: "user"; text: string }; failureTask: AvatarReplyFailureTask }
  >(`/api/avatar-sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ text, clientMessageId, ...(topic ? { topic } : {}), ...(retry ? { retry: true } : {}) }),
  });
  if (!("messages" in result) || !Array.isArray(result.messages)) {
    throw new ApiError("这条问题已进入恢复队列，请稍后刷新查看回复。", "AVATAR_REPLY_RECOVERY_PENDING", 202);
  }
  return result;
}

export function getAvatarAnalysis(sessionId: string) {
  return apiRequest<GetCompatibilityAnalysisResponse>(`/api/avatar-sessions/${encodeURIComponent(sessionId)}/analysis`);
}

export function requestHumanChat(avatarSessionId: string) {
  return apiRequest<{ request: ChatRequest }>("/api/chat-requests", {
    method: "POST",
    body: JSON.stringify({ avatarSessionId }),
  });
}

export function getChatRequests() {
  return apiRequest<{ items: ChatRequest[] }>("/api/chat-requests");
}

export function acceptChatRequest(requestId: string) {
  return apiRequest<AcceptChatRequestResponse>(`/api/chat-requests/${encodeURIComponent(requestId)}/accept`, {
    method: "POST",
  });
}

export function rejectChatRequest(requestId: string) {
  return apiRequest<RejectChatRequestResponse>(`/api/chat-requests/${encodeURIComponent(requestId)}/reject`, {
    method: "POST",
  });
}

export function getConversations() {
  return apiRequest<{ items: Conversation[] }>("/api/conversations");
}

export function getConversationMessages(conversationId: string) {
  return apiRequest<{ items: Message[] }>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`);
}

export function sendConversationMessage(conversationId: string, text: string, clientMessageId: string) {
  return apiRequest<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ text, clientMessageId }),
  });
}

export function archiveConversation(conversationId: string) {
  return apiRequest<{ conversation: Conversation }>(`/api/conversations/${encodeURIComponent(conversationId)}/archive`, {
    method: "POST",
  });
}

export function restoreConversation(conversationId: string) {
  return apiRequest<{ conversation: Conversation }>(`/api/conversations/${encodeURIComponent(conversationId)}/restore`, {
    method: "POST",
  });
}

export function recallConversationMessage(conversationId: string, messageId: string) {
  return apiRequest<{ message: Message }>(`/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/recall`, {
    method: "POST",
  });
}

export function getNotifications() {
  return apiRequest<ListNotificationsResponse>("/api/notifications");
}

export function markNotificationRead(notificationId: string) {
  return apiRequest<MarkNotificationReadResponse>(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "POST",
  });
}

export function markAllNotificationsRead() {
  return apiRequest<MarkAllNotificationsReadResponse>("/api/notifications/read-all", { method: "POST" });
}

export function createReport(report: CreateReportRequest) {
  return apiRequest<CreateReportResponse>("/api/reports", {
    method: "POST",
    body: JSON.stringify(report),
  });
}

export function blockUser(userId: string) {
  return apiRequest<BlockUserResponse>(`/api/users/${encodeURIComponent(userId)}/block`, {
    method: "POST",
  });
}

export function getBlocks() {
  return apiRequest<ListBlocksResponse>("/api/me/blocks");
}

export function unblockUser(userId: string) {
  return apiRequest<void>(`/api/users/${encodeURIComponent(userId)}/block`, { method: "DELETE" });
}

export function getAdminModeration() {
  return apiRequest<GetAdminModerationResponse>("/api/admin/moderation");
}

export function getAdminAccess() {
  return apiRequest<GetAdminAccessResponse>("/api/admin/access");
}

export function verifyAdminAccess(code: string) {
  return apiRequest<VerifyAdminAccessResponse>("/api/admin/access/verify", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function approveProfile(userId: string) {
  return apiRequest<ApproveProfileResponse>(`/api/admin/profiles/${encodeURIComponent(userId)}/approve`, {
    method: "POST",
  });
}

export function rejectProfile(userId: string, reason: string) {
  return apiRequest<RejectProfileResponse>(`/api/admin/profiles/${encodeURIComponent(userId)}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function approvePhoto(photoId: string) {
  return apiRequest<ApprovePhotoResponse>(`/api/admin/photos/${encodeURIComponent(photoId)}/approve`, {
    method: "POST",
  });
}

export function rejectPhoto(photoId: string, reason: string) {
  return apiRequest<RejectPhotoResponse>(`/api/admin/photos/${encodeURIComponent(photoId)}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function getAdminReports() {
  return apiRequest<{ items: AdminReport[] }>("/api/admin/reports");
}

export function resolveReport(reportId: string, resolution: string) {
  return apiRequest<ResolveReportResponse>(`/api/admin/reports/${encodeURIComponent(reportId)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ resolution }),
  });
}

export function getAdminAccounts() {
  return apiRequest<{ items: AdminAccount[] }>("/api/admin/accounts");
}

export function suspendAdminAccount(userId: string, reason: string) {
  return apiRequest<{ user: Pick<AdminAccount, "id" | "status"> }>(`/api/admin/accounts/${encodeURIComponent(userId)}/suspend`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function restoreAdminAccount(userId: string, reason: string) {
  return apiRequest<{ user: Pick<AdminAccount, "id" | "status"> }>(`/api/admin/accounts/${encodeURIComponent(userId)}/restore`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function getAdminAppeals() {
  return apiRequest<{ items: AccountAppeal[] }>("/api/admin/appeals");
}

export function reviewAdminAppeal(appealId: string, decision: "approved" | "rejected", resolution: string) {
  return apiRequest<{ appeal: AccountAppeal }>(`/api/admin/appeals/${encodeURIComponent(appealId)}/review`, {
    method: "POST",
    body: JSON.stringify({ decision, resolution }),
  });
}

export function createAdminContent(input: CreateAdminContentInput) {
  return apiRequest<{ content: ContentItem }>("/api/admin/content", { method: "POST", body: JSON.stringify(input) });
}

export function getAdminContent() {
  return apiRequest<{ items: ContentItem[] }>("/api/admin/content");
}

export function publishAdminContent(contentId: string) {
  return apiRequest<{ content: ContentItem }>(`/api/admin/content/${encodeURIComponent(contentId)}/publish`, { method: "POST" });
}

export function takeAdminContentOffline(contentId: string) {
  return apiRequest<{ content: ContentItem }>(`/api/admin/content/${encodeURIComponent(contentId)}/offline`, { method: "POST" });
}

export function updateAdminContent(contentId: string, input: Partial<CreateAdminContentInput>) {
  return apiRequest<{ content: ContentItem }>(`/api/admin/content/${encodeURIComponent(contentId)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteAdminContent(contentId: string) {
  return apiRequest<void>(`/api/admin/content/${encodeURIComponent(contentId)}`, { method: "DELETE" });
}

export function getAdminAuditEntries() {
  return apiRequest<{ items: AdminAuditEntry[] }>("/api/admin/audit-logs");
}

export function getAdminOperations() {
  return apiRequest<AdminOperationsSummary>("/api/admin/operations");
}

export function runAdminCleanup() {
  return apiRequest<{ run: AdminMaintenanceRun }>("/api/admin/operations/cleanup", { method: "POST" });
}

export function getAdminAvatarReplyFailures(page = 1, pageSize = 50) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return apiRequest<{ items: AvatarReplyFailureTask[]; page: number; pageSize: number; total: number; totalPages: number }>(`/api/admin/avatar-reply-failures?${query}`);
}

export function retryAdminAvatarReplyFailure(taskId: string) {
  return apiRequest<{ task: AvatarReplyFailureTask; message: { id: string; sessionId: string; sender: "avatar"; createdAt: string } }>(`/api/admin/avatar-reply-failures/${encodeURIComponent(taskId)}/retry`, { method: "POST" });
}

/* ─── Soul Test ─────────────────────────────────────────────────────── */

export interface SoulTestQuestionPayload {
  id: string;
  dimension: string;
  dimensionLabel: string;
  text: string;
  optionA: { label: string; value: number };
  optionB: { label: string; value: number };
}

export interface SoulTestResultPayload {
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
  matchHint?: string | null;
}

export interface SoulTestProgressPayload {
  completed: boolean;
  result: SoulTestResultPayload | null;
  totalCount: number;
  answeredCount: number;
}

export function getSoulTestQuestions() {
  return apiRequest<{ questions: SoulTestQuestionPayload[]; totalCount: number }>("/api/soul-test/questions");
}

export function getMySoulTest() {
  return apiRequest<SoulTestProgressPayload>("/api/me/soul-test");
}

export function submitSoulTest(answers: Record<string, "A" | "B">) {
  return apiRequest<{ result: SoulTestResultPayload; personalityType: { type: string; label: string; description: string; tags: string[]; matchHint: string } }>("/api/me/soul-test/submit", {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

/* ─── Daily Pick ────────────────────────────────────────────────────── */

export interface DailyPickMemberPayload {
  memberId: string;
  member: Member;
  reasons: string[];
  score: number;
  reaction: "interested" | "skipped" | null;
}

export interface DailyPickPayload {
  date: string;
  members: DailyPickMemberPayload[];
  expiresAt: string;
}

export interface CommentPayload {
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

export function getDailyPick() {
  return apiRequest<{ data: DailyPickPayload }>("/api/me/daily-pick");
}

export function reactDailyPick(memberId: string, reaction: "interested" | "skipped") {
  return apiRequest<{ data: { memberId: string; reaction: string } }>(`/api/me/daily-pick/${encodeURIComponent(memberId)}/react`, {
    method: "POST",
    body: JSON.stringify({ reaction }),
  });
}

/* ─── Comments ─────────────────────────────────────────── */

export function getComments(contentId: string) {
  return apiRequest<{ data: { items: CommentPayload[] } }>(`/api/content/${encodeURIComponent(contentId)}/comments`);
}

export function postComment(contentId: string, text: string, parentId: string | null = null) {
  return apiRequest<{ data: { comment: CommentPayload } }>(`/api/content/${encodeURIComponent(contentId)}/comments`, {
    method: "POST",
    body: JSON.stringify({ text, parentId }),
  });
}

export function likeComment(commentId: string) {
  return apiRequest<{ data: { comment: CommentPayload } }>(`/api/comments/${encodeURIComponent(commentId)}/like`, {
    method: "POST",
  });
}

export function deleteComment(commentId: string) {
  return apiRequest<void>(`/api/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
}

/* ─── Gamification ─────────────────────────────────────────── */

export function getMyCheckIn() {
  return apiRequest<{
    data: {
      checkIn: {
        currentStreak: number;
        longestStreak: number;
        lastCheckInDate: string | null;
        totalPoints: number;
      } | null;
      hasCheckedInToday: boolean;
      tasks: Array<{ id: string; label: string; description: string; points: number; icon: string }>;
      completions: Array<{ taskId: string; completed: boolean; completedAt: string | null; pointsAwarded: number }>;
      today: string;
    };
  }>("/api/me/checkin");
}

export function doCheckIn() {
  return apiRequest<{
    data: {
      checkIn: { currentStreak: number; longestStreak: number; lastCheckInDate: string; totalPoints: number };
      pointsEarned: number;
      streak: number;
    };
  }>("/api/me/checkin", { method: "POST" });
}

export function completeTask(taskId: string) {
  return apiRequest<{
    data: {
      checkIn: { currentStreak: number; longestStreak: number; lastCheckInDate: string | null; totalPoints: number };
      task: { id: string; label: string; points: number; icon: string };
      pointsAwarded: number;
    };
  }>("/api/me/tasks/complete", { method: "POST", body: JSON.stringify({ taskId }) });
}

/* ─── VIP ────────────────────────────────────────────────────── */

export function getMyVip() {
  return apiRequest<{
    data: {
      vip: {
        tier: string;
        expiresAt: string | null;
        isActive: boolean;
        superLikesRemaining: number;
        superLikesTotal: number;
      };
      plans: Array<{
        id: string;
        label: string;
        durationDays: number;
        price: number;
        pointsCost: number | null;
        features: string[];
      }>;
    };
  }>("/api/me/vip");
}

export function subscribeVip(planId: string, paymentMethod: string = "模拟支付") {
  return apiRequest<{
    data: {
      vip: { tier: string; expiresAt: string; isActive: boolean; superLikesRemaining: number; superLikesTotal: number };
      plan: { id: string; label: string; durationDays: number; price: number };
    };
  }>("/api/me/vip/subscribe", { method: "POST", body: JSON.stringify({ planId, paymentMethod }) });
}

export function superLike(memberId: string) {
  return apiRequest<{ data: { remaining: number } }>("/api/me/super-like", {
    method: "POST",
    body: JSON.stringify({ memberId }),
  });
}

/* ─── Video Intro ────────────────────────────────────────────── */

export function getMyVideoIntro() {
  return apiRequest<{
    data: {
      video: {
        id: string;
        url: string;
        thumbnailUrl: string | null;
        durationSeconds: number;
        sizeBytes: number;
        reviewStatus: "pending" | "approved" | "rejected";
        reviewReason: string | null;
        createdAt: string;
      } | null;
    };
  }>("/api/me/video-intro");
}

export function uploadVideoIntro(dataUrl: string, filename: string, durationSeconds: number) {
  return apiRequest<{ data: { video: { id: string; url: string; reviewStatus: string } } }>(
    "/api/me/video-intro",
    { method: "POST", body: JSON.stringify({ dataUrl, filename, durationSeconds }) },
  );
}

export function deleteVideoIntro() {
  return apiRequest<void>("/api/me/video-intro", { method: "DELETE" });
}
