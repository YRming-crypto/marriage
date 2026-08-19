export type Gender = "男性" | "女性";

export type MaritalStatus = "未婚" | "离异" | "丧偶";

export type RelationshipGoal = "认真交往" | "以结婚为目标" | "先认识了解";

export type ISODateString = string;

export type UserStatus = "active" | "suspended" | "deleted";

export type UserRole = "user" | "moderator" | "admin";

export type OtpPurpose = "login" | "register";

export type ProfileStatus = "draft" | "pending_review" | "approved" | "rejected";

export type ProfileVisibility = "private" | "approved_only" | "public";

export type PhotoReviewStatus = "pending" | "approved" | "rejected";

export type AvatarProfileStatus = "pending" | "enabled" | "paused" | "revoked";

export type CompatibilityReadiness = "learning" | "ready";

export type ReportStatus = "pending" | "resolved" | "dismissed";

export type InterestStatus = "active" | "removed";

export type NotificationType =
  | "photo_reviewed"
  | "profile_reviewed"
  | "chat_request_received"
  | "chat_request_accepted"
  | "chat_request_rejected"
  | "new_message"
  | "system";

export type OnboardingDraftStatus = "in_progress" | "submitted";

export const relationshipQuestionGroups = [
  { title: "沟通", questions: ["出现分歧时，你通常怎样处理？", "你平时更习惯怎样表达关心？", "当你需要独处时，会怎样告诉对方？"] },
  { title: "生活", questions: ["你理想中的周末是什么样的？", "你的日常作息和生活节奏是怎样的？", "你希望两个人怎样分担家务？"] },
  { title: "未来", questions: ["未来几年是否愿意为关系调整城市？", "你期待三到五年后的生活是什么样的？", "你希望两个人怎样商量储蓄和日常开支？"] },
  { title: "家庭", questions: ["你希望怎样与双方父母相处？", "你对是否要孩子或与子女相处有什么想法？", "节假日和重要家庭安排，你希望怎样协商？"] },
  { title: "边界", questions: ["哪些行为是你明确不能接受的？", "你希望彼此保留哪些个人空间？", "你最希望对方先了解你的哪一面？"] },
] as const;

export const relationshipQuestions = relationshipQuestionGroups.flatMap((group) => group.questions);

export interface AuthUser {
  id: string;
  status: UserStatus;
  role: UserRole;
  phoneVerified: boolean;
  profileCompleted: boolean;
  createdAt: ISODateString;
  lastLoginAt: ISODateString | null;
}

export interface AuthSession {
  id: string;
  userId: string;
  accessToken: string;
  expiresAt: ISODateString;
  refreshExpiresAt: ISODateString;
}

export interface MatchPreference {
  genders: Gender[];
  minAge: number | null;
  maxAge: number | null;
  cities: string[];
  maritalStatuses: MaritalStatus[];
  goals: RelationshipGoal[];
  acceptsLongDistance: boolean;
}

export interface Profile {
  id: string;
  userId: string;
  nickname: string;
  gender: Gender;
  birthYear: number;
  city: string;
  district: string | null;
  jobCategory: string | null;
  maritalStatus: MaritalStatus;
  goal: RelationshipGoal;
  introduction: string | null;
  tags: string[];
  preference: MatchPreference;
  profileStatus: ProfileStatus;
  visibility: ProfileVisibility;
  updatedAt: ISODateString;
}

export interface Photo {
  id: string;
  userId: string;
  filename: string;
  url: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  isPrimary: boolean;
  reviewStatus: PhotoReviewStatus;
  reviewReason: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface AvatarApprovedFact {
  topic: string;
  fact: string;
}

export interface AvatarProfile {
  userId: string;
  version: number;
  approvedFacts: AvatarApprovedFact[];
  relationshipExpectations: string[];
  boundaries: string[];
  unknownResponse: string;
  status: AvatarProfileStatus;
  generatedAt: ISODateString;
  enabledAt: ISODateString | null;
}

export interface Member {
  id: string;
  userId?: string;
  demo?: boolean;
  nickname: string;
  gender: Gender;
  age: number;
  city: string;
  district: string;
  job: string;
  maritalStatus: MaritalStatus;
  goal: RelationshipGoal;
  tags: string[];
  introduction: string;
  lifeStory?: string | null;
  lifeHighlights?: string[];
  voiceIntroUrl?: string | null;
  voiceIntroTranscript?: string | null;
  voiceIntroDuration?: number | null;
  photoUrl: string;
  photoUrls?: string[];
  activeLabel: string;
  smokingStatus?: string;
  childrenStatus?: string;
  joinedAt?: ISODateString;
  lastActiveAt?: ISODateString;
  verified: boolean;
  featured?: boolean;
  soulTestResult?: MemberSoulTestSummary | null;
}

export interface MemberSoulTestSummary {
  personalityType: string;
  personalityLabel: string;
  personalityDescription?: string | null;
  tags: string[];
  matchHint?: string | null;
  dimensions: Array<{
    dimension: string;
    dimensionLabel: string;
    labelA: string;
    labelB: string;
    score: number;
    polarity: string;
  }>;
}

export type LobbyMemberStatus = "new" | "reviewing" | "verified";

export interface IncompleteLobbyMember {
  id: string;
  lobbyStatus: "new" | "reviewing";
  nickname: string;
  activeLabel: string;
  joinedAt?: ISODateString;
  verified: false;
  gender?: Gender;
  age?: number;
  city?: string;
  district?: string;
  job?: string;
  maritalStatus?: MaritalStatus;
  goal?: RelationshipGoal;
}

export type LobbyMember = (Member & { lobbyStatus: "verified" }) | IncompleteLobbyMember;

export interface Recommendation {
  member: Member;
  score: number;
  reasons: string[];
}

export interface Interest {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: InterestStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedResourceType: "member" | "photo" | "profile" | "chat_request" | "conversation" | "report" | null;
  relatedResourceId: string | null;
  readAt: ISODateString | null;
  createdAt: ISODateString;
}

export interface CompatibilityAnalysis {
  readiness: CompatibilityReadiness;
  canRequestChat: boolean;
  score: number;
  completedTopics: string[];
  commonPoints: string[];
  discussionTopics: string[];
  summary: string;
}

export interface Report {
  id: string;
  reporterUserId: string;
  targetUserId: string;
  targetAvatarSessionId: string | null;
  targetConversationId: string | null;
  targetMessageId: string | null;
  reason: string;
  description: string;
  status: ReportStatus;
  resolution: string | null;
  resolvedByUserId: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Block {
  id: string;
  blockerUserId: string;
  blockedUserId: string;
  createdAt: ISODateString;
}

export interface BlockListItem extends Block {
  member?: Member;
}

export interface AdminModerationProfile {
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
  profileStatus: ProfileStatus;
  updatedAt: ISODateString;
}

export interface AdminModeration {
  profiles: AdminModerationProfile[];
  photos: Photo[];
}

export interface OnboardingDraft {
  id: string;
  userId: string;
  currentStep: number;
  status: OnboardingDraftStatus;
  nickname: string | null;
  gender: Gender | null;
  birthYear: number | null;
  city: string | null;
  district: string | null;
  jobCategory: string | null;
  maritalStatus: MaritalStatus | null;
  goal: RelationshipGoal | null;
  introduction: string | null;
  tags: string[];
  answers: Record<string, string>;
  photoIds: string[];
  updatedAt: ISODateString;
  completedAt: ISODateString | null;
}

export type AvatarSessionStatus = "active" | "paused";

export interface AvatarSession {
  id: string;
  memberId: string;
  completedTopics: string[];
  completedTopicCount: number;
  requiredTopicCount: number;
  canRequestChat: boolean;
  status: AvatarSessionStatus;
}

export interface AvatarMessage {
  id: string;
  sessionId: string;
  sender: "user" | "avatar";
  text: string;
  clientMessageId?: string | null;
  topic: string | null;
  createdAt: ISODateString;
}

export type AvatarReplyFailureStatus = "pending" | "resolved";

export interface AvatarReplyFailureTask {
  id: string;
  sessionId: string;
  userMessageId: string;
  memberId: string;
  status: AvatarReplyFailureStatus;
  attempts: number;
  lastError: string | null;
  resolvedMessageId: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  resolvedAt: ISODateString | null;
}

export type ChatRequestStatus = "pending" | "accepted" | "rejected" | "expired";

export interface ChatRequest {
  id: string;
  avatarSessionId: string;
  fromUserId: string;
  toUserId: string;
  memberId: string;
  status: ChatRequestStatus;
  expiresAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  member?: Member;
}

export type ConversationStatus = "active" | "archived" | "blocked";

export interface Conversation {
  id: string;
  chatRequestId: string;
  participantIds: string[];
  status: ConversationStatus;
  archivedAt?: ISODateString | null;
  createdAt: ISODateString;
  lastMessage?: Pick<Message, "senderId" | "text" | "createdAt" | "deletedAt"> | null;
  unreadCount?: number;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  clientMessageId: string | null;
  deletedAt?: ISODateString | null;
  createdAt: ISODateString;
  receipt?: MessageReceipt | null;
}

export interface MessageReceipt {
  id: string;
  messageId: string;
  userId: string;
  deliveredAt: ISODateString | null;
  readAt: ISODateString | null;
  createdAt: ISODateString;
}

export interface AccountSession {
  id: string;
  userId: string;
  expiresAt: number;
  userAgent: string;
  createdAt: ISODateString;
  lastUsedAt: ISODateString;
  current: boolean;
}

export type AppealStatus = "pending" | "reviewing" | "approved" | "rejected";
export interface AccountAppeal {
  id: string;
  userId: string;
  reason: string;
  evidence: string[];
  status: AppealStatus;
  resolution: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type DataExportStatus = "pending" | "ready" | "failed" | "expired";
export interface DataExportJob {
  id: string;
  userId: string;
  status: DataExportStatus;
  createdAt: ISODateString;
  readyAt: ISODateString | null;
  expiresAt: ISODateString | null;
}

export interface SavedMatchFilter {
  id: string;
  userId: string;
  name: string;
  criteria: Record<string, unknown>;
  isDefault: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type ContentItemType = "article" | "event";
export type ContentItemStatus = "draft" | "published" | "offline";
export interface ContentItem {
  id: string;
  type: ContentItemType;
  status: ContentItemStatus;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  coverImageUrl: string | null;
  imageUrls?: string[];
  authorId: string;
  likeCount: number;
  registrationCount: number;
  event: { startsAt: number; endsAt: number; location: string; capacity: number; remainingCapacity: number } | null;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
  offlineAt: number | null;
}

export interface NavigationItem {
  label: string;
  to: string;
}

/* ─── Soul Test / Personality Profile ─────────────────────────────────── */

export type SoulDimension = "social" | "expression" | "pace" | "decision" | "intimacy";

export type SoulPolarity =
  | "introvert" | "extrovert"
  | "reserved" | "direct"
  | "structured" | "spontaneous"
  | "rational" | "emotional"
  | "independent" | "attached";

export interface SoulTestQuestion {
  id: string;
  dimension: SoulDimension;
  dimensionLabel: string;
  text: string;
  optionA: { label: string; value: number };
  optionB: { label: string; value: number };
}

export interface SoulDimensionScore {
  dimension: SoulDimension;
  dimensionLabel: string;
  labelA: string;
  labelB: string;
  score: number;
  polarity: SoulPolarity;
  description: string;
}

export interface SoulTestResult {
  userId: string;
  completedAt: ISODateString;
  dimensions: SoulDimensionScore[];
  personalityType: string;
  personalityLabel: string;
  personalityDescription: string;
  tags: string[];
}

export interface SoulTestProgress {
  answeredCount: number;
  totalCount: number;
  completed: boolean;
  result: SoulTestResult | null;
}

export const soulTestQuestions: readonly SoulTestQuestion[] = [
  // 社交能量 (Social Energy) - 内向 ↔ 外向
  { id: "se1", dimension: "social", dimensionLabel: "社交能量", text: "周末空闲时，你更倾向于？", optionA: { label: "约朋友聚会或参加社交活动", value: 2 }, optionB: { label: "在家看书、追剧或享受独处", value: 0 } },
  { id: "se2", dimension: "social", dimensionLabel: "社交能量", text: "在社交场合中，你通常是？", optionA: { label: "主动认识新朋友，喜欢聊天", value: 2 }, optionB: { label: "更习惯和熟人待在一起", value: 0 } },
  { id: "se3", dimension: "social", dimensionLabel: "社交能量", text: "连续工作一周后，你最想怎么放松？", optionA: { label: "和喜欢的人一起出去走走", value: 2 }, optionB: { label: "安静地待着，减少社交", value: 0 } },
  { id: "se4", dimension: "social", dimensionLabel: "社交能量", text: "遇到有趣的事，你的第一反应是？", optionA: { label: "马上分享给身边的人", value: 2 }, optionB: { label: "先自己慢慢体会", value: 0 } },

  // 情感表达 (Emotional Expression) - 含蓄 ↔ 直接
  { id: "ee1", dimension: "expression", dimensionLabel: "情感表达", text: "对有好感的人，你更可能？", optionA: { label: "通过行动和细节暗示", value: 0 }, optionB: { label: "直接或比较明确地表达好感", value: 2 } },
  { id: "ee2", dimension: "expression", dimensionLabel: "情感表达", text: "发生矛盾时，你更倾向于？", optionA: { label: "先冷静一段时间，再找合适的时机说", value: 0 }, optionB: { label: "尽快把想法说清楚，不想憋着", value: 2 } },
  { id: "ee3", dimension: "expression", dimensionLabel: "情感表达", text: "日常相处中，你表达关心的方式更接近？", optionA: { label: "默默帮对方把事情做好", value: 0 }, optionB: { label: "用语言表达关心和想念", value: 2 } },

  // 生活节奏 (Life Pace) - 规律 ↔ 随性
  { id: "lp1", dimension: "pace", dimensionLabel: "生活节奏", text: "你的日常生活更接近？", optionA: { label: "有相对固定的作息和安排", value: 0 }, optionB: { label: "比较灵活，看当天的心情和状态", value: 2 } },
  { id: "lp2", dimension: "pace", dimensionLabel: "生活节奏", text: "旅行时，你更喜欢？", optionA: { label: "提前做好详细计划", value: 0 }, optionB: { label: "只定大方向，到了再随机应变", value: 2 } },
  { id: "lp3", dimension: "pace", dimensionLabel: "生活节奏", text: "关于家务和生活琐事，你更倾向于？", optionA: { label: "按固定的节奏处理，保持整洁有序", value: 0 }, optionB: { label: "有空再处理，不太拘泥于固定模式", value: 2 } },

  // 决策风格 (Decision Style) - 理性 ↔ 感性
  { id: "ds1", dimension: "decision", dimensionLabel: "决策风格", text: "做重要决定时，你更看重？", optionA: { label: "利弊分析和客观条件", value: 0 }, optionB: { label: "内心的感受和直觉", value: 2 } },
  { id: "ds2", dimension: "decision", dimensionLabel: "决策风格", text: "选择一份工作，你更在意？", optionA: { label: "发展前景和实际待遇", value: 0 }, optionB: { label: "是否真心喜欢、做起来开心", value: 2 } },
  { id: "ds3", dimension: "decision", dimensionLabel: "决策风格", text: "朋友向你倾诉烦恼时，你更常？", optionA: { label: "帮 TA 分析问题，想办法解决", value: 0 }, optionB: { label: "先陪 TA 感受情绪，让 TA 知道你懂", value: 2 } },

  // 亲密模式 (Intimacy Mode) - 独立 ↔ 依赖
  { id: "im1", dimension: "intimacy", dimensionLabel: "亲密模式", text: "在亲密关系中，你更希望？", optionA: { label: "各自保有独立的空间和兴趣", value: 0 }, optionB: { label: "尽量多在一起，分享生活的方方面面", value: 2 } },
  { id: "im2", dimension: "intimacy", dimensionLabel: "亲密模式", text: "遇到困难时，你更倾向于？", optionA: { label: "先自己想办法解决", value: 0 }, optionB: { label: "第一时间和对方商量", value: 2 } },
  { id: "im3", dimension: "intimacy", dimensionLabel: "亲密模式", text: "你觉得理想的相处模式是？", optionA: { label: "相互支持但不过度依赖", value: 0 }, optionB: { label: "彼此紧密联结，共同面对一切", value: 2 } },
] as const;

export const personalityTypes = [
  { type: "guardian", label: "温暖守护者", description: "你内心柔软而有力量，习惯用行动照顾身边的人。在关系中，你追求稳定、真诚和安全感。", tags: ["温暖", "可靠", "细心"], matchHint: "适合与懂得表达感激、重视家庭的人在一起。" },
  { type: "explorer", label: "浪漫探索家", description: "你对生活充满好奇，善于发现日常中的美好。在关系中，你追求新鲜感和共同成长。", tags: ["浪漫", "好奇", "感性"], matchHint: "适合与愿意一起尝试新事物、情感表达丰富的人在一起。" },
  { type: "pioneer", label: "稳重行动派", description: "你做事果断、有计划，同时内心有自己的浪漫。在关系中，你追求目标一致和互相支持。", tags: ["果断", "有规划", "务实"], matchHint: "适合与尊重你的节奏、同样认真对待关系的人在一起。" },
  { type: "dreamer", label: "深情理想家", description: "你内心丰富而细腻，对感情有很高的期待。在关系中，你追求精神共鸣和深层理解。", tags: ["细腻", "深情", "理想"], matchHint: "适合与能理解你内心世界、愿意深入交流的人在一起。" },
  { type: "anchor", label: "踏实陪伴者", description: "你重视承诺和陪伴，是关系中稳定的力量。在感情中，你追求细水长流和相互扶持。", tags: ["踏实", "忠诚", "陪伴"], matchHint: "适合与同样重视长期关系、珍惜平淡幸福的人在一起。" },
  { type: "spark", label: "活力感染者", description: "你乐观开朗，能带动身边人的情绪。在关系中，你追求快乐和积极的互动。", tags: ["乐观", "开朗", "活力"], matchHint: "适合与欣赏你的活力、能和你一起笑对生活的人在一起。" },
] as const;

export interface DailyPick {
  id: string;
  userId: string;
  date: string;
  members: DailyPickMember[];
  createdAt: ISODateString;
}

export interface DailyPickMember {
  memberId: string;
  member: Member;
  reasons: string[];
  score: number;
}

/* ─── Ice-breaking Mini Games ───────────────────────────────────────── */

export type GameType = "truth-dare" | "compatibility-quiz" | "word-chain";

export interface TruthDareQuestion {
  id: string;
  category: "truth" | "dare";
  level: "safe" | "medium" | "deep";
  text: string;
}

export interface CompatibilityQuestion {
  id: string;
  text: string;
  options: string[];
}

export interface WordChainEntry {
  id: string;
  word: string;
  playerId: "user" | "opponent";
  createdAt: number;
}

export const truthDareQuestions: readonly TruthDareQuestion[] = [
  // Safe level
  { id: "td-s1", category: "truth", level: "safe", text: "你最近看的一部让你印象深刻的电影是什么？为什么？" },
  { id: "td-s2", category: "truth", level: "safe", text: "你最喜欢的旅行目的地是哪里？" },
  { id: "td-s3", category: "truth", level: "safe", text: "你平时最喜欢的休闲活动是什么？" },
  { id: "td-s4", category: "truth", level: "safe", text: "如果可以拥有一种超能力，你希望是什么？" },
  { id: "td-s5", category: "dare", level: "safe", text: "发一条最近拍的生活照给对方看。" },
  { id: "td-s6", category: "dare", level: "safe", text: "用三个词形容自己现在的心情。" },
  { id: "td-s7", category: "dare", level: "safe", text: "分享一首你最近单曲循环的歌。" },
  // Medium level
  { id: "td-m1", category: "truth", level: "medium", text: "你觉得在一段关系中，最重要的品质是什么？" },
  { id: "td-m2", category: "truth", level: "medium", text: "你小时候的梦想是什么？现在还在追求吗？" },
  { id: "td-m3", category: "truth", level: "medium", text: "有没有一件事，你一直想做但还没做的？" },
  { id: "td-m4", category: "truth", level: "medium", text: "你觉得自己在朋友眼中是什么样的人？" },
  { id: "td-m5", category: "dare", level: "medium", text: "用语音说一件今天让你开心的小事。" },
  { id: "td-m6", category: "dare", level: "medium", text: "说说你对对方的第一印象。" },
  // Deep level
  { id: "td-d1", category: "truth", level: "deep", text: "你人生中最大的转折点是什么？" },
  { id: "td-d2", category: "truth", level: "deep", text: "你对未来的家庭生活有什么期待？" },
  { id: "td-d3", category: "truth", level: "deep", text: "你最珍视的一段关系是什么？为什么？" },
  { id: "td-d4", category: "truth", level: "deep", text: "如果重来一次，你会改变哪个决定？" },
  { id: "td-d5", category: "dare", level: "deep", text: "分享一个你从未告诉过别人的小秘密。" },
  { id: "td-d6", category: "dare", level: "deep", text: "说出你最欣赏对方的一个特质。" },
] as const;

export const compatibilityQuestions: readonly CompatibilityQuestion[] = [
  { id: "cq1", text: "周末更喜欢怎样度过？", options: ["宅家看书追剧", "和朋友聚会", "户外走走", "逛逛展览"] },
  { id: "cq2", text: "旅行时更看重什么？", options: ["美食体验", "自然风光", "历史文化", "休闲放松"] },
  { id: "cq3", text: "遇到分歧时，通常会？", options: ["直接沟通说清楚", "先冷静再谈", "试着理解对方", "找折中方案"] },
  { id: "cq4", text: "最理想的约会方式是？", options: ["一起做顿饭", "看电影", "散步聊天", "参加活动"] },
  { id: "cq5", text: "生活中更看重什么？", options: ["事业成就", "家庭温暖", "个人成长", "自由空间"] },
  { id: "cq6", text: "对感情的期待是？", options: ["互相陪伴", "共同成长", "彼此独立又支持", "浪漫新鲜"] },
  { id: "cq7", text: "表达关心的方式是？", options: ["实际行动", "语言表达", "送礼物", "陪伴时光"] },
  { id: "cq8", text: "压力大的时候会？", options: ["找人倾诉", "独处消化", "运动释放", "做喜欢的事"] },
] as const;

export const wordChainDictionary: readonly string[] = [
  "一心一意", "意气风发", "发愤图强", "强词夺理", "理直气壮", "壮志凌云", "云开雾散", "散步闲聊",
  "谈笑风生", "生机勃勃", "勃勃生机", "津津有味", "意味深长", "长话短说", "说三道四",
  "四面楚歌", "歌舞升平", "平安无事", "事半功倍", "倍道而行", "行云流水", "水到渠成",
  "成人之美", "美不胜收", "收放自如", "如鱼得水", "水落石出", "出人头地", "地久天长",
  "长相厮守", "守望相助", "助人为乐", "乐在其中", "中流砥柱", "柱石之坚",
  "风和日丽", "丽质天成", "成竹在胸", "胸有成竹", "竹报平安", "安居乐业",
  "业精于勤", "勤能补拙", "拙口钝腮",
] as const;

/* ─── Topic Plaza & Comments ───────────────────────────────────────── */

export type CommentStatus = "active" | "hidden";

export interface Comment {
  id: string;
  contentItemId: string;
  authorId: string;
  authorName: string;
  authorPhotoUrl: string | null;
  text: string;
  parentId: string | null;
  likeCount: number;
  status: CommentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface TopicCategory {
  id: string;
  label: string;
  description: string;
  icon: string;
  color: string;
}

export const topicCategories: readonly TopicCategory[] = [
  { id: "travel", label: "旅行见闻", description: "分享旅途中的风景与故事", icon: "🌍", color: "oklch(0.55 0.14 220)" },
  { id: "food", label: "美食分享", description: "好吃的、好做的，都值得记录", icon: "🍳", color: "oklch(0.55 0.14 40)" },
  { id: "parenting", label: "育儿心得", description: "养育路上的经验与感悟", icon: "🌱", color: "oklch(0.55 0.14 150)" },
  { id: "fitness", label: "健身运动", description: "动起来，分享你的运动日常", icon: "🏃", color: "oklch(0.55 0.14 18)" },
  { id: "reading", label: "读书观影", description: "一本书、一部电影，一段感悟", icon: "📚", color: "oklch(0.55 0.14 280)" },
  { id: "life", label: "生活感悟", description: "日常中的小确幸和大道理", icon: "💭", color: "oklch(0.55 0.12 320)" },
] as const;

/* ─── Gamification / Check-in / Tasks ─────────────────────────────────── */

export type DailyTaskId =
  | "complete_profile"
  | "upload_photo"
  | "first_greeting"
  | "soul_test"
  | "post_moment"
  | "daily_checkin";

export interface DailyTask {
  id: DailyTaskId;
  label: string;
  description: string;
  points: number;
  icon: string;
}

export const dailyTasks: readonly DailyTask[] = [
  { id: "daily_checkin", label: "每日签到", description: "每天登录签到领取积分", points: 10, icon: "📅" },
  { id: "complete_profile", label: "完善资料", description: "完成婚恋档案填写", points: 50, icon: "📝" },
  { id: "upload_photo", label: "上传照片", description: "上传至少一张个人照片", points: 30, icon: "📷" },
  { id: "first_greeting", label: "首次打招呼", description: "向心仪的人发送第一条消息", points: 20, icon: "👋" },
  { id: "soul_test", label: "完成灵魂测试", description: "完成性格画像测试", points: 100, icon: "✨" },
  { id: "post_moment", label: "发布动态", description: "分享一条生活动态", points: 20, icon: "💬" },
] as const;

export interface CheckInStreak {
  currentStreak: number;
  longestStreak: number;
  lastCheckInDate: string | null;
  totalPoints: number;
}

export interface TaskCompletion {
  taskId: DailyTaskId;
  completed: boolean;
  completedAt: string | null;
  pointsAwarded: number;
}

export interface GamificationState {
  checkIn: CheckInStreak;
  tasks: TaskCompletion[];
}

/* ─── VIP Membership ──────────────────────────────────────────────────── */

export type VipTier = "free" | "monthly" | "quarterly" | "yearly";

export interface VipPlan {
  id: VipTier;
  label: string;
  durationDays: number;
  price: number;
  pointsCost: number | null; // null means money only
  features: string[];
}

export const vipPlans: readonly VipPlan[] = [
  {
    id: "monthly",
    label: "月度会员",
    durationDays: 30,
    price: 30,
    pointsCost: 3000,
    features: ["专属金色标识", "每天 3 次超级喜欢", "查看谁喜欢了我", "消息已读回执"],
  },
  {
    id: "quarterly",
    label: "季度会员",
    durationDays: 90,
    price: 78,
    pointsCost: 7800,
    features: ["月度会员全部特权", "无限回溯已跳过的人", "优先客服通道", "专属表情礼包"],
  },
  {
    id: "yearly",
    label: "年度会员",
    durationDays: 365,
    price: 258,
    pointsCost: 25800,
    features: ["季度会员全部特权", "AI 顾问深度分析", "线下活动优先名额", "年度专属勋章"],
  },
] as const;

export interface VipStatus {
  tier: VipTier;
  expiresAt: string | null;
  isActive: boolean;
  superLikesRemaining: number;
  superLikesTotal: number;
}

/* ─── Video Intro ─────────────────────────────────────────────────── */

export type VideoReviewStatus = "pending" | "approved" | "rejected";

export interface VideoIntro {
  id: string;
  userId: string;
  url: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string;
  reviewStatus: VideoReviewStatus;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export * from "./contracts.js";
