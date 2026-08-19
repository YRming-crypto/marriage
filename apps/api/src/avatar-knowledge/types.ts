export const knowledgeGovernanceStatuses = ["allowed", "sensitive", "prohibited"] as const;
export type KnowledgeGovernanceStatus = typeof knowledgeGovernanceStatuses[number];

export const avatarVersionStatuses = ["draft", "active", "stale", "archived"] as const;
export type AvatarVersionStatus = typeof avatarVersionStatuses[number];

export const modelCallStatuses = ["succeeded", "failed"] as const;
export type ModelCallStatus = typeof modelCallStatuses[number];

export interface AvatarKnowledgeClock {
  now(): number;
}

export type AvatarKnowledgeIdFactory = (prefix: "knowledge" | "version" | "call") => string;

export interface KnowledgeItem {
  id: string;
  ownerId: string;
  title: string;
  content: string;
  topic: string;
  keywords: string[];
  status: KnowledgeGovernanceStatus;
  moderationReason: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateKnowledgeItemInput {
  title: string;
  content: string;
  topic: string;
  keywords?: string[];
}

export interface UpdateKnowledgeItemInput {
  title?: string;
  content?: string;
  topic?: string;
  keywords?: string[];
}

export interface MarkKnowledgeItemInput {
  status: KnowledgeGovernanceStatus;
  reason?: string | null;
}

export interface AvatarVersionKnowledgeSnapshot {
  id: string;
  title: string;
  content: string;
  topic: string;
  keywords: string[];
  governanceStatus: Exclude<KnowledgeGovernanceStatus, "prohibited">;
  authorized: boolean;
  sourceRevision: number;
}

export interface AvatarKnowledgeVersion {
  id: string;
  ownerId: string;
  versionNumber: number;
  status: AvatarVersionStatus;
  note: string | null;
  items: AvatarVersionKnowledgeSnapshot[];
  createdAt: number;
  activatedAt: number | null;
}

export interface CreateDraftVersionInput {
  knowledgeItemIds: string[];
  sensitiveItemIds?: string[];
  note?: string | null;
}

export interface AuthorizedKnowledge {
  id: string;
  title: string;
  content: string;
  topic: string;
  keywords: string[];
}

export interface AnswerModelRequest {
  ownerId: string;
  versionId: string;
  question: string;
  knowledge: AuthorizedKnowledge[];
}

export interface AnswerModelResponse {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export type AnswerModel = (request: AnswerModelRequest) => Promise<AnswerModelResponse>;

export interface AvatarAnswer {
  kind: "knowledge" | "fallback";
  answer: string;
  versionId: string | null;
  sourceItemIds: string[];
}

export interface ModelCallLog {
  id: string;
  ownerId: string;
  versionId: string;
  model: string;
  status: ModelCallStatus;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  errorCode: "MODEL_CALL_FAILED" | null;
  createdAt: number;
}

export interface AvatarKnowledgeServiceOptions {
  clock?: AvatarKnowledgeClock;
  idFactory?: AvatarKnowledgeIdFactory;
  model?: AnswerModel;
  modelName?: string;
  fallbackAnswer?: string;
}

export interface AvatarKnowledgeState {
  items: KnowledgeItem[];
  versions: AvatarKnowledgeVersion[];
  currentVersions: Array<{ ownerId: string; versionId: string }>;
  callLogs: ModelCallLog[];
}
