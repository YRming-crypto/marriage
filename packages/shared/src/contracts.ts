import type {
  AuthSession,
  AuthUser,
  AdminModeration,
  AdminModerationProfile,
  AvatarProfile,
  AvatarMessage,
  AvatarReplyFailureTask,
  AvatarSession,
  Block,
  BlockListItem,
  ChatRequest,
  CompatibilityAnalysis,
  Conversation,
  Gender,
  Interest,
  ISODateString,
  MaritalStatus,
  LobbyMember,
  Member,
  Message,
  Notification,
  OnboardingDraft,
  OtpPurpose,
  Photo,
  Profile,
  Recommendation,
  Report,
  RelationshipGoal,
} from "./index.js";

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PHOTO_UPLOAD_INVALID"
  | "PHOTO_INVALID"
  | "PHOTO_LIMIT"
  | "PHOTO_NOT_FOUND"
  | "PHOTO_REVIEW_REQUIRED"
  | "AI_PROFILE_NOT_ENABLED"
  | "AVATAR_PROFILE_REQUIRED"
  | "PROFILE_REQUIRED"
  | "ANSWERS_REQUIRED"
  | "CHAT_NOT_ALLOWED"
  | "AUTH_REQUIRED"
  | "OTP_INVALID"
  | "PHONE_INVALID"
  | "PROFILE_INVALID"
  | "MEMBER_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "AVATAR_PAUSED"
  | "AVATAR_MODEL_UNAVAILABLE"
  | "AVATAR_MESSAGE_ID_CONFLICT"
  | "AVATAR_FAILURE_NOT_FOUND"
  | "AVATAR_RETRY_NOT_ALLOWED"
  | "MESSAGE_INVALID"
  | "MESSAGE_RECALL_NOT_ALLOWED"
  | "CHAT_NOT_READY"
  | "CHAT_NOT_AVAILABLE"
  | "REQUEST_NOT_FOUND"
  | "REQUEST_CLOSED"
  | "NOTIFICATION_NOT_FOUND"
  | "REPORT_INVALID"
  | "REPORT_NOT_FOUND"
  | "RESOLUTION_REQUIRED"
  | "BLOCK_INVALID"
  | "BLOCK_NOT_FOUND"
  | "ADMIN_REQUIRED"
  | "ADMIN_STEP_UP_REQUIRED"
  | "ADMIN_ACCESS_CODE_INVALID"
  | "PROFILE_NOT_FOUND"
  | "INVALID_MATCH_FILTER"
  | "MATCH_FILTER_INVALID"
  | "MATCH_FILTER_LIMIT"
  | "MATCH_FILTER_NOT_FOUND"
  | "ONBOARDING_DRAFT_INVALID"
  | "ONBOARDING_DRAFT_TOO_LARGE"
  | "VISIBILITY_INVALID"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_OPERATION_NOT_ALLOWED"
  | "ACCOUNT_DELETED"
  | "REASON_INVALID"
  | "DELETION_CONFIRMATION_REQUIRED"
  | "APPEAL_INVALID"
  | "APPEAL_NOT_FOUND"
  | "APPEAL_DECISION_INVALID"
  | "APPEAL_RESOLUTION_INVALID"
  | "APPEAL_ALREADY_REVIEWED"
  | "DATA_EXPORT_ALREADY_READY"
  | "DATA_EXPORT_NOT_FOUND"
  | "DATA_EXPORT_EXPIRED"
  | "PROHIBITED_KNOWLEDGE"
  | "INVALID_VERSION_STATE"
  | "KNOWLEDGE_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "REVIEW_REASON_REQUIRED"
  | "REPORT_EVIDENCE_INVALID"
  | "CONVERSATION_NOT_FOUND"
  | "CHAT_BLOCKED"
  | "SELF_NOT_ALLOWED"
  | "INTERNAL_ERROR";

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId?: string;
}

export interface ApiErrorDetail {
  field?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface ApiError {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetail[];
  };
  requestId?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface RequestOtpRequest {
  phone: string;
  purpose: OtpPurpose;
}

export interface RequestOtpResponse {
  requestId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export interface VerifyOtpRequest {
  requestId: string;
  phone: string;
  code: string;
}

export interface VerifyOtpResponse {
  user: AuthUser;
  session: AuthSession;
}

export interface RefreshSessionResponse {
  user: AuthUser;
  session: AuthSession;
}

export interface GetMeResponse {
  user: AuthUser;
  profile: Profile | null;
  onboardingDraft: OnboardingDraft | null;
}

export interface UpdateProfileRequest {
  nickname?: string;
  gender?: Gender;
  birthYear?: number;
  city?: string;
  district?: string | null;
  jobCategory?: string | null;
  maritalStatus?: MaritalStatus;
  goal?: RelationshipGoal;
  introduction?: string | null;
  tags?: string[];
  preference?: Partial<Profile["preference"]>;
}

export interface SaveOnboardingDraftRequest {
  currentStep?: number;
  nickname?: string | null;
  gender?: Gender | null;
  birthYear?: number | null;
  city?: string | null;
  district?: string | null;
  jobCategory?: string | null;
  maritalStatus?: MaritalStatus | null;
  goal?: RelationshipGoal | null;
  introduction?: string | null;
  tags?: string[];
  answers?: Record<string, string>;
  photoIds?: string[];
}

export interface SubmitOnboardingResponse {
  draft: OnboardingDraft;
  profile: Profile;
}

export interface UploadPhotoRequest {
  filename: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  dataUrl: string;
}

export interface UploadPhotoResponse {
  photo: Photo;
}

/** @deprecated Use UploadPhotoRequest. */
export type CreatePhotoUploadRequest = UploadPhotoRequest;

/** @deprecated Use UploadPhotoResponse. */
export type CreatePhotoUploadResponse = UploadPhotoResponse;

export interface ListMyPhotosResponse {
  items: Photo[];
}

export interface PhotoMutationResponse {
  photo: Photo;
}

export interface AvatarProfileResponse {
  avatarProfile: AvatarProfile;
}

export interface GetAvatarProfileResponse {
  avatarProfile: AvatarProfile | null;
}

export interface MembersQuery {
  city?: string;
  minAge?: number;
  maxAge?: number;
  gender?: Gender;
  maritalStatus?: MaritalStatus;
  goal?: RelationshipGoal;
  cursor?: string;
  pageSize?: number;
  smokingStatus?: string;
  childrenStatus?: string;
  onlyWithPhoto?: boolean;
  sort?: "default" | "recent-active" | "newest" | "age-asc" | "age-desc";
  includeIncomplete?: boolean;
}

export interface ListMembersResponse {
  items: LobbyMember[];
  total: number;
  pageSize: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface GetMemberResponse {
  member: Member;
}

export interface ListRecommendationsResponse {
  items: Recommendation[];
  total?: number;
  pageSize?: number;
  nextCursor?: string | null;
  hasMore?: boolean;
}

export interface CreateInterestResponse {
  interest: Interest;
  alreadyExisted: boolean;
}

export interface InterestListItem extends Interest {
  member: Member;
}

export interface ListInterestsResponse {
  received: InterestListItem[];
  sent: InterestListItem[];
}

export interface ListNotificationsResponse {
  items: Notification[];
  unreadCount: number;
}

export interface MarkNotificationReadResponse {
  notification: Notification;
}

export interface MarkAllNotificationsReadResponse {
  unreadCount: 0;
}

export interface CreateAvatarSessionRequest {
  memberId: string;
}

export interface CreateAvatarSessionResponse {
  session: AvatarSession;
}

export interface SendAvatarMessageRequest {
  text: string;
  clientMessageId?: string;
}

export interface SendAvatarMessageResponse {
  messages: AvatarMessage[];
  session: AvatarSession;
}

export interface SendAvatarMessageFailureResponse {
  message: AvatarMessage;
  failureTask: AvatarReplyFailureTask;
}

export interface RetryAvatarReplyFailureResponse {
  task: AvatarReplyFailureTask;
  message: Pick<AvatarMessage, "id" | "sessionId" | "sender" | "createdAt">;
}

export interface GetCompatibilityAnalysisResponse {
  analysis: CompatibilityAnalysis;
}

export interface CreateChatRequestRequest {
  avatarSessionId: string;
}

export interface CreateChatRequestResponse {
  request: ChatRequest;
}

export interface AcceptChatRequestResponse {
  request: ChatRequest;
  conversation?: Conversation;
}

export interface RejectChatRequestResponse {
  request: ChatRequest & { status: "rejected" };
}

export interface SendMessageRequest {
  text: string;
  clientMessageId?: string;
}

export interface SendMessageResponse {
  message: Message;
}

export interface CreateReportRequest {
  targetUserId: string;
  reason: string;
  description: string;
  avatarSessionId?: string;
  conversationId?: string;
  messageId?: string;
}

export interface CreateReportResponse {
  report: Report;
}

export interface BlockUserResponse {
  block: Block;
}

export interface ListBlocksResponse {
  items: BlockListItem[];
}

export type GetAdminModerationResponse = AdminModeration;

export interface AdminAccessState {
  required: boolean;
  verified: boolean;
  expiresAt: ISODateString | null;
}

export type GetAdminAccessResponse = AdminAccessState;
export type VerifyAdminAccessResponse = Pick<AdminAccessState, "verified" | "expiresAt">;

export interface ApproveProfileResponse {
  profile: AdminModerationProfile;
  member: Member | Pick<Member, "id">;
}

export interface ApprovePhotoResponse {
  photo: Photo;
  member: Member | null;
}

export interface RejectReviewRequest {
  reason: string;
}

export interface RejectProfileResponse {
  profile: AdminModerationProfile;
}

export interface RejectPhotoResponse {
  photo: Photo;
}

export interface AdminReportPartySummary {
  userId: string;
  nickname: string | null;
  city: string | null;
}

export interface AdminReportEvidenceMessage {
  id: string;
  sender: "reporter" | "target" | "avatar";
  text: string;
  createdAt: string;
}

export interface AdminReportEvidenceProjection {
  source: "human_message" | "avatar_session" | "none";
  avatarSessionId: string | null;
  conversationId: string | null;
  messageId: string | null;
  messages: AdminReportEvidenceMessage[];
}

export interface AdminReportItem extends Report {
  reporter: AdminReportPartySummary;
  target: AdminReportPartySummary;
  evidence: AdminReportEvidenceProjection;
}

export interface ListAdminReportsResponse {
  items: AdminReportItem[];
}

export interface ResolveReportRequest {
  resolution: string;
}

export interface ResolveReportResponse {
  report: Report;
}
