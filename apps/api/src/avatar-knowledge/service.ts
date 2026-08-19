import { randomUUID } from "node:crypto";
import type {
  AnswerModel,
  AvatarAnswer,
  AvatarKnowledgeClock,
  AvatarKnowledgeIdFactory,
  AvatarKnowledgeServiceOptions,
  AvatarKnowledgeState,
  AvatarKnowledgeVersion,
  AvatarVersionKnowledgeSnapshot,
  AuthorizedKnowledge,
  CreateDraftVersionInput,
  CreateKnowledgeItemInput,
  KnowledgeGovernanceStatus,
  KnowledgeItem,
  MarkKnowledgeItemInput,
  ModelCallLog,
  UpdateKnowledgeItemInput,
} from "./types.js";

const DEFAULT_MODEL_NAME = "memory-grounded-answer-v1";
const DEFAULT_FALLBACK = "这个问题不在我的授权信息中，建议你和本人进一步沟通。";

const systemClock: AvatarKnowledgeClock = { now: () => Date.now() };
const defaultIdFactory: AvatarKnowledgeIdFactory = (prefix) => `${prefix}_${randomUUID()}`;

export class AvatarKnowledgeError extends Error {
  constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "KNOWLEDGE_NOT_FOUND"
      | "VERSION_NOT_FOUND"
      | "PROHIBITED_KNOWLEDGE"
      | "INVALID_VERSION_STATE"
      | "MODEL_CALL_FAILED",
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "AvatarKnowledgeError";
  }
}

const cloneItem = (item: KnowledgeItem): KnowledgeItem => ({ ...item, keywords: [...item.keywords] });
const cloneVersion = (version: AvatarKnowledgeVersion): AvatarKnowledgeVersion => ({
  ...version,
  items: version.items.map((item) => ({ ...item, keywords: [...item.keywords] })),
});
const cloneLog = (log: ModelCallLog): ModelCallLog => ({ ...log });

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AvatarKnowledgeError("INVALID_INPUT", `${field} 不能为空`);
  }
  return normalized;
}

function normalizedKeywords(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function assertUniqueIds(ids: string[], field: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new AvatarKnowledgeError("INVALID_INPUT", `${field} 不能包含重复条目`);
  }
}

function isRelevant(question: string, item: AvatarVersionKnowledgeSnapshot): boolean {
  const normalizedQuestion = question.toLocaleLowerCase().replace(/[\s，。！？、,.!?：:；;]/g, "");
  const terms = [item.title, item.topic, ...item.keywords]
    .map((term) => term.toLocaleLowerCase().replace(/\s/g, ""))
    .filter((term) => term.length >= 2);

  return terms.some((term) => normalizedQuestion.includes(term) || term.includes(normalizedQuestion));
}

function approximateTokens(text: string): number {
  return Math.max(1, Math.ceil([...text].length / 2));
}

const defaultModel: AnswerModel = async ({ knowledge }) => {
  const text = knowledge.map((item) => item.content).join("；");
  return {
    text,
    usage: {
      inputTokens: approximateTokens(text),
      outputTokens: approximateTokens(text),
    },
  };
};

export class InMemoryAvatarKnowledgeService {
  private readonly clock: AvatarKnowledgeClock;
  private readonly idFactory: AvatarKnowledgeIdFactory;
  private readonly model: AnswerModel;
  private readonly modelName: string;
  private readonly fallbackAnswer: string;
  private readonly items = new Map<string, Map<string, KnowledgeItem>>();
  private readonly versions = new Map<string, Map<string, AvatarKnowledgeVersion>>();
  private readonly currentVersionIds = new Map<string, string>();
  private readonly versionSequences = new Map<string, number>();
  private readonly callLogs = new Map<string, ModelCallLog[]>();

  constructor(options: AvatarKnowledgeServiceOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.model = options.model ?? defaultModel;
    this.modelName = options.modelName?.trim() || DEFAULT_MODEL_NAME;
    this.fallbackAnswer = options.fallbackAnswer?.trim() || DEFAULT_FALLBACK;
  }

  exportState(): AvatarKnowledgeState {
    return {
      items: [...this.items.values()].flatMap((items) => [...items.values()].map(cloneItem)),
      versions: [...this.versions.values()].flatMap((versions) => [...versions.values()].map(cloneVersion)),
      currentVersions: [...this.currentVersionIds.entries()].map(([ownerId, versionId]) => ({ ownerId, versionId })),
      callLogs: [...this.callLogs.values()].flatMap((logs) => logs.map(cloneLog)),
    };
  }

  restoreState(state: AvatarKnowledgeState): void {
    this.items.clear();
    this.versions.clear();
    this.currentVersionIds.clear();
    this.versionSequences.clear();
    this.callLogs.clear();

    for (const item of state.items) this.ownerItems(item.ownerId).set(item.id, cloneItem(item));
    for (const version of state.versions) {
      this.ownerVersions(version.ownerId).set(version.id, cloneVersion(version));
      this.versionSequences.set(version.ownerId, Math.max(this.versionSequences.get(version.ownerId) ?? 0, version.versionNumber));
    }
    for (const current of state.currentVersions) {
      if (this.versions.get(current.ownerId)?.has(current.versionId)) this.currentVersionIds.set(current.ownerId, current.versionId);
    }
    for (const log of state.callLogs) {
      const logs = this.callLogs.get(log.ownerId) ?? [];
      logs.push(cloneLog(log));
      this.callLogs.set(log.ownerId, logs);
    }
  }

  removeOwnerData(ownerId: string): void {
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) return;
    this.items.delete(normalizedOwnerId);
    this.versions.delete(normalizedOwnerId);
    this.currentVersionIds.delete(normalizedOwnerId);
    this.versionSequences.delete(normalizedOwnerId);
    this.callLogs.delete(normalizedOwnerId);
  }

  createKnowledgeItem(ownerId: string, input: CreateKnowledgeItemInput): KnowledgeItem {
    const ownerItems = this.ownerItems(requiredText(ownerId, "ownerId"));
    const now = this.clock.now();
    const item: KnowledgeItem = {
      id: this.idFactory("knowledge"),
      ownerId,
      title: requiredText(input.title, "title"),
      content: requiredText(input.content, "content"),
      topic: requiredText(input.topic, "topic"),
      keywords: normalizedKeywords(input.keywords),
      status: "allowed",
      moderationReason: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    ownerItems.set(item.id, item);
    this.markCurrentVersionStale(ownerId);
    return cloneItem(item);
  }

  getKnowledgeItem(ownerId: string, itemId: string): KnowledgeItem {
    return cloneItem(this.requireItem(ownerId, itemId));
  }

  listKnowledgeItems(ownerId: string): KnowledgeItem[] {
    return [...(this.items.get(ownerId)?.values() ?? [])]
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map(cloneItem);
  }

  updateKnowledgeItem(ownerId: string, itemId: string, input: UpdateKnowledgeItemInput): KnowledgeItem {
    const item = this.requireItem(ownerId, itemId);
    const hasChanges = input.title !== undefined
      || input.content !== undefined
      || input.topic !== undefined
      || input.keywords !== undefined;
    if (!hasChanges) {
      throw new AvatarKnowledgeError("INVALID_INPUT", "至少提供一个待更新字段");
    }

    if (input.title !== undefined) item.title = requiredText(input.title, "title");
    if (input.content !== undefined) item.content = requiredText(input.content, "content");
    if (input.topic !== undefined) item.topic = requiredText(input.topic, "topic");
    if (input.keywords !== undefined) item.keywords = normalizedKeywords(input.keywords);
    item.revision += 1;
    item.updatedAt = this.clock.now();
    this.markCurrentVersionStale(ownerId);
    return cloneItem(item);
  }

  deleteKnowledgeItem(ownerId: string, itemId: string): void {
    this.requireItem(ownerId, itemId);
    this.items.get(ownerId)?.delete(itemId);
    this.markCurrentVersionStale(ownerId);
  }

  markKnowledgeItem(ownerId: string, itemId: string, input: MarkKnowledgeItemInput): KnowledgeItem {
    if (!(["allowed", "sensitive", "prohibited"] as KnowledgeGovernanceStatus[]).includes(input.status)) {
      throw new AvatarKnowledgeError("INVALID_INPUT", "未知的知识治理状态");
    }
    const item = this.requireItem(ownerId, itemId);
    item.status = input.status;
    item.moderationReason = input.status === "allowed" ? null : requiredText(input.reason ?? "", "reason");
    item.revision += 1;
    item.updatedAt = this.clock.now();
    this.markCurrentVersionStale(ownerId);
    return cloneItem(item);
  }

  createDraftVersion(ownerId: string, input: CreateDraftVersionInput): AvatarKnowledgeVersion {
    requiredText(ownerId, "ownerId");
    if (input.knowledgeItemIds.length === 0) {
      throw new AvatarKnowledgeError("INVALID_INPUT", "版本至少需要一条知识");
    }
    assertUniqueIds(input.knowledgeItemIds, "knowledgeItemIds");
    const sensitiveIds = input.sensitiveItemIds ?? [];
    assertUniqueIds(sensitiveIds, "sensitiveItemIds");
    const selectedIds = new Set(input.knowledgeItemIds);
    if (sensitiveIds.some((id) => !selectedIds.has(id))) {
      throw new AvatarKnowledgeError("INVALID_INPUT", "敏感知识授权必须属于当前版本");
    }

    const items = input.knowledgeItemIds.map((id) => this.requireItem(ownerId, id));
    const prohibited = items.find((item) => item.status === "prohibited");
    if (prohibited) {
      throw new AvatarKnowledgeError("PROHIBITED_KNOWLEDGE", `禁止主题不能进入版本：${prohibited.id}`);
    }
    for (const sensitiveId of sensitiveIds) {
      if (this.requireItem(ownerId, sensitiveId).status !== "sensitive") {
        throw new AvatarKnowledgeError("INVALID_INPUT", `非敏感知识无需敏感授权：${sensitiveId}`);
      }
    }

    const versionNumber = (this.versionSequences.get(ownerId) ?? 0) + 1;
    this.versionSequences.set(ownerId, versionNumber);
    const now = this.clock.now();
    const version: AvatarKnowledgeVersion = {
      id: this.idFactory("version"),
      ownerId,
      versionNumber,
      status: "draft",
      note: input.note?.trim() || null,
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        content: item.content,
        topic: item.topic,
        keywords: [...item.keywords],
        governanceStatus: item.status as Exclude<KnowledgeGovernanceStatus, "prohibited">,
        authorized: item.status === "allowed" || sensitiveIds.includes(item.id),
        sourceRevision: item.revision,
      })),
      createdAt: now,
      activatedAt: null,
    };
    this.ownerVersions(ownerId).set(version.id, version);
    return cloneVersion(version);
  }

  getVersion(ownerId: string, versionId: string): AvatarKnowledgeVersion {
    return cloneVersion(this.requireVersion(ownerId, versionId));
  }

  listVersions(ownerId: string): AvatarKnowledgeVersion[] {
    return [...(this.versions.get(ownerId)?.values() ?? [])]
      .sort((left, right) => right.versionNumber - left.versionNumber)
      .map(cloneVersion);
  }

  getCurrentVersion(ownerId: string): AvatarKnowledgeVersion | null {
    const versionId = this.currentVersionIds.get(ownerId);
    return versionId ? cloneVersion(this.requireVersion(ownerId, versionId)) : null;
  }

  activateVersion(ownerId: string, versionId: string): AvatarKnowledgeVersion {
    const target = this.requireVersion(ownerId, versionId);
    if (target.status !== "draft") {
      throw new AvatarKnowledgeError("INVALID_VERSION_STATE", "只有草稿版本可以首次启用");
    }
    this.archiveCurrentVersion(ownerId, target.id);
    target.status = "active";
    target.activatedAt = this.clock.now();
    this.currentVersionIds.set(ownerId, target.id);
    return cloneVersion(target);
  }

  rollbackVersion(ownerId: string, versionId: string): AvatarKnowledgeVersion {
    const target = this.requireVersion(ownerId, versionId);
    if (target.status !== "archived") {
      throw new AvatarKnowledgeError("INVALID_VERSION_STATE", "只能回滚到已归档的启用版本");
    }
    this.archiveCurrentVersion(ownerId, target.id);
    target.status = "active";
    target.activatedAt = this.clock.now();
    this.currentVersionIds.set(ownerId, target.id);
    return cloneVersion(target);
  }

  async answer(ownerId: string, question: string): Promise<AvatarAnswer> {
    const normalizedQuestion = requiredText(question, "question");
    const current = this.getCurrentVersion(ownerId);
    if (!current || !(["active", "stale"] as const).includes(current.status as "active" | "stale")) {
      return this.fallback(null);
    }

    const relevant = current.items.filter((item) => (
      this.isSnapshotCurrentlyAuthorized(ownerId, item) && isRelevant(normalizedQuestion, item)
    ));
    if (relevant.length === 0) {
      return this.fallback(current.id);
    }
    const knowledge: AuthorizedKnowledge[] = relevant.map((item) => ({
      id: item.id,
      title: item.title,
      content: item.content,
      topic: item.topic,
      keywords: [...item.keywords],
    }));
    const startedAt = this.clock.now();
    try {
      const response = await this.model({
        ownerId,
        versionId: current.id,
        question: normalizedQuestion,
        knowledge,
      });
      this.appendCallLog({
        ownerId,
        versionId: current.id,
        model: this.modelName,
        status: "succeeded",
        latencyMs: Math.max(0, this.clock.now() - startedAt),
        inputTokens: Math.max(0, Math.floor(response.usage.inputTokens)),
        outputTokens: Math.max(0, Math.floor(response.usage.outputTokens)),
        errorCode: null,
      });
      return {
        kind: "knowledge",
        answer: requiredText(response.text, "model response"),
        versionId: current.id,
        sourceItemIds: relevant.map((item) => item.id),
      };
    } catch {
      this.appendCallLog({
        ownerId,
        versionId: current.id,
        model: this.modelName,
        status: "failed",
        latencyMs: Math.max(0, this.clock.now() - startedAt),
        inputTokens: 0,
        outputTokens: 0,
        errorCode: "MODEL_CALL_FAILED",
      });
      throw new AvatarKnowledgeError("MODEL_CALL_FAILED", "回答模型调用失败");
    }
  }

  listCallLogs(ownerId: string): ModelCallLog[] {
    return [...(this.callLogs.get(ownerId) ?? [])].reverse().map(cloneLog);
  }

  private ownerItems(ownerId: string): Map<string, KnowledgeItem> {
    let result = this.items.get(ownerId);
    if (!result) {
      result = new Map();
      this.items.set(ownerId, result);
    }
    return result;
  }

  private ownerVersions(ownerId: string): Map<string, AvatarKnowledgeVersion> {
    let result = this.versions.get(ownerId);
    if (!result) {
      result = new Map();
      this.versions.set(ownerId, result);
    }
    return result;
  }

  private requireItem(ownerId: string, itemId: string): KnowledgeItem {
    const item = this.items.get(ownerId)?.get(itemId);
    if (!item) {
      throw new AvatarKnowledgeError("KNOWLEDGE_NOT_FOUND", `知识条目不存在：${itemId}`);
    }
    return item;
  }

  private requireVersion(ownerId: string, versionId: string): AvatarKnowledgeVersion {
    const version = this.versions.get(ownerId)?.get(versionId);
    if (!version) {
      throw new AvatarKnowledgeError("VERSION_NOT_FOUND", `版本不存在：${versionId}`);
    }
    return version;
  }

  private markCurrentVersionStale(ownerId: string): void {
    const currentId = this.currentVersionIds.get(ownerId);
    if (!currentId) return;
    const current = this.versions.get(ownerId)?.get(currentId);
    if (current?.status === "active") current.status = "stale";
  }

  private archiveCurrentVersion(ownerId: string, exceptVersionId: string): void {
    const currentId = this.currentVersionIds.get(ownerId);
    if (!currentId || currentId === exceptVersionId) return;
    const current = this.versions.get(ownerId)?.get(currentId);
    if (current && (current.status === "active" || current.status === "stale")) {
      current.status = "archived";
    }
  }

  private fallback(versionId: string | null): AvatarAnswer {
    return { kind: "fallback", answer: this.fallbackAnswer, versionId, sourceItemIds: [] };
  }

  private isSnapshotCurrentlyAuthorized(
    ownerId: string,
    snapshot: AvatarVersionKnowledgeSnapshot,
  ): boolean {
    if (!snapshot.authorized) return false;
    const currentItem = this.items.get(ownerId)?.get(snapshot.id);
    if (!currentItem || currentItem.status === "prohibited") return false;
    if (currentItem.status === "sensitive") {
      return snapshot.governanceStatus === "sensitive";
    }
    return true;
  }

  private appendCallLog(input: Omit<ModelCallLog, "id" | "createdAt">): void {
    const log: ModelCallLog = {
      id: this.idFactory("call"),
      createdAt: this.clock.now(),
      ...input,
    };
    const logs = this.callLogs.get(input.ownerId) ?? [];
    logs.push(log);
    this.callLogs.set(input.ownerId, logs);
  }
}
