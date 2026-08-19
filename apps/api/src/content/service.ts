import { contentError } from "./errors.js";
import type {
  ContentActivityServiceOptions,
  ContentActivityState,
  ContentActor,
  ContentIdPrefix,
  ContentItem,
  ContentPage,
  ContentReactionResult,
  CreateContentInput,
  CreateMemberMomentInput,
  EventRegistration,
  EventRegistrationListItem,
  EventRegistrationResult,
  PublicContentFilters,
  UpdateContentInput,
} from "./types.js";
import {
  requireActor,
  requireAdmin,
  normalizeImageUrls,
  validateCreateContentInput,
  validatePublicContentFilters,
} from "./validation.js";

interface StoredContent extends Omit<ContentItem, "event"> {
  event: ContentItem["event"];
}

const cloneContent = (content: StoredContent): ContentItem => ({
  ...content,
  tags: [...content.tags],
  imageUrls: [...(content.imageUrls ?? [])],
  event: content.event ? { ...content.event } : null,
});

const cloneRegistration = (registration: EventRegistration): EventRegistration => ({ ...registration });
const MOMENT_UPLOAD_PENDING_TAG = "__moment_upload_pending__";
const MOMENT_DELETE_PENDING_TAG = "__moment_delete_pending__";

export class ContentActivityService {
  private readonly content = new Map<string, StoredContent>();
  private readonly likes = new Map<string, Set<string>>();
  private readonly registrations = new Map<string, Map<string, EventRegistration>>();
  private readonly now: () => number;
  private readonly createId: (prefix: ContentIdPrefix) => string;
  private nextId = 1;

  constructor(options: ContentActivityServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.createId = options.createId ?? ((prefix) => `${prefix}-${this.nextId++}`);
  }

  exportState(): ContentActivityState {
    return {
      content: [...this.content.values()].map(cloneContent),
      likes: [...this.likes.entries()].map(([contentId, users]) => ({ contentId, userIds: [...users] })),
      registrations: [...this.registrations.values()]
        .flatMap((items) => [...items.values()].map(cloneRegistration)),
    };
  }

  restoreState(state: ContentActivityState): void {
    this.content.clear();
    this.likes.clear();
    this.registrations.clear();

    for (const item of state.content) this.content.set(item.id, cloneContent(item));
    for (const entry of state.likes) {
      if (this.content.has(entry.contentId)) this.likes.set(entry.contentId, new Set(entry.userIds));
    }
    for (const registration of state.registrations) {
      if (!this.content.has(registration.contentId)) continue;
      const registrations = this.registrations.get(registration.contentId) ?? new Map();
      registrations.set(registration.userId, cloneRegistration(registration));
      this.registrations.set(registration.contentId, registrations);
    }
    for (const item of this.content.values()) {
      item.likeCount = this.likes.get(item.id)?.size ?? 0;
      const registrations = this.registrations.get(item.id) ?? new Map();
      item.registrationCount = this.countActiveRegistrations(registrations);
      if (item.event) item.event.remainingCapacity = Math.max(0, item.event.capacity - item.registrationCount);
    }
  }

  removeUserActivity(userId: string): ContentItem[] {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) return [];
    const removedContent = [...this.content.values()]
      .filter((content) => content.authorId === normalizedUserId)
      .map(cloneContent);
    for (const content of removedContent) this.removeContent(content.id);
    for (const [contentId, users] of this.likes) {
      users.delete(normalizedUserId);
      if (users.size === 0) this.likes.delete(contentId);
      const content = this.content.get(contentId);
      if (content) content.likeCount = users.size;
    }
    for (const [contentId, registrations] of this.registrations) {
      registrations.delete(normalizedUserId);
      if (registrations.size === 0) this.registrations.delete(contentId);
      const content = this.content.get(contentId);
      if (content) this.syncRegistrationCount(content, registrations);
    }
    return removedContent;
  }

  createDraft(actor: ContentActor, input: CreateContentInput): ContentItem {
    requireAdmin(actor);
    const value = validateCreateContentInput(input);
    const now = this.currentTime();
    const id = this.newId("content");
    const content: StoredContent = {
      id,
      type: value.type,
      status: "draft",
      title: value.title,
      summary: value.summary,
      body: value.body,
      tags: [...(value.tags ?? [])],
      coverImageUrl: value.coverImageUrl ?? null,
      imageUrls: [...(value.imageUrls ?? [])],
      authorId: actor.userId.trim(),
      likeCount: 0,
      registrationCount: 0,
      event: value.event ? { ...value.event, remainingCapacity: value.event.capacity } : null,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      offlineAt: null,
    };
    this.content.set(id, content);
    return cloneContent(content);
  }

  createMemberMoment(actor: ContentActor, input: CreateMemberMomentInput): ContentItem {
    requireActor(actor);
    if (actor.role !== "member") contentError("FORBIDDEN", 403, "只有会员可以发布生活动态。 ");
    const body = typeof input?.body === "string" ? input.body.trim() : "";
    if (!body || body.length > 2_000) {
      contentError("INVALID_CONTENT_INPUT", 400, "动态内容不能为空，且不能超过2000个字符。 ");
    }
    const imageUrls = normalizeImageUrls(input.imageUrls);
    const now = this.currentTime();
    const content: StoredContent = {
      id: this.newId("content"),
      type: "article",
      status: "draft",
      title: body.length > 30 ? `${body.slice(0, 30)}...` : body,
      summary: body.length > 100 ? `${body.slice(0, 100)}...` : body,
      body,
      tags: ["动态"],
      coverImageUrl: imageUrls[0] ?? null,
      imageUrls,
      authorId: actor.userId.trim(),
      likeCount: 0,
      registrationCount: 0,
      event: null,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      offlineAt: null,
    };
    this.content.set(content.id, content);
    return cloneContent(content);
  }

  reserveMemberMoment(actor: ContentActor, input: CreateMemberMomentInput): ContentItem {
    const created = this.createMemberMoment(actor, input);
    const content = this.requireExistingContent(created.id);
    content.status = "offline";
    content.offlineAt = this.currentTime();
    content.tags.push(MOMENT_UPLOAD_PENDING_TAG);
    return cloneContent(content);
  }

  completeMemberMomentUpload(actor: ContentActor, contentId: string): ContentItem {
    requireActor(actor);
    const content = this.requireExistingContent(contentId);
    if (content.authorId !== actor.userId.trim() || !content.tags.includes(MOMENT_UPLOAD_PENDING_TAG)) {
      contentError("INVALID_CONTENT_STATE", 409, "这条动态不处于图片上传状态。");
    }
    content.tags = content.tags.filter((tag) => tag !== MOMENT_UPLOAD_PENDING_TAG);
    content.status = "draft";
    content.offlineAt = null;
    content.updatedAt = this.currentTime();
    return cloneContent(content);
  }

  listMyContent(actor: ContentActor): ContentItem[] {
    requireActor(actor);
    const userId = actor.userId.trim();
    return [...this.content.values()]
      .filter((content) => content.authorId === userId)
      .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id, "zh-CN"))
      .map(cloneContent);
  }

  stageOwnContentDeletion(actor: ContentActor, contentId: string): ContentItem {
    requireActor(actor);
    const content = this.requireExistingContent(contentId);
    if (content.authorId !== actor.userId.trim()) {
      contentError("FORBIDDEN", 403, "只能删除自己发布的内容。");
    }
    return this.stageDeletion(content);
  }

  stageContentDeletion(actor: ContentActor, contentId: string): ContentItem {
    requireAdmin(actor);
    return this.stageDeletion(this.requireExistingContent(contentId));
  }

  stageUserContentDeletion(userId: string): ContentItem[] {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) return [];
    return [...this.content.values()]
      .filter((content) => content.authorId === normalizedUserId)
      .map((content) => this.stageDeletion(content));
  }

  deleteOwnContent(actor: ContentActor, contentId: string): boolean {
    requireActor(actor);
    const content = this.requireExistingContent(contentId);
    if (content.authorId !== actor.userId.trim()) {
      contentError("FORBIDDEN", 403, "只能删除自己发布的内容。 ");
    }
    return this.removeContent(content.id);
  }

  updateContent(actor: ContentActor, contentId: string, input: UpdateContentInput): ContentItem {
    requireAdmin(actor);
    const content = this.requireExistingContent(contentId);
    if (this.hasPendingObjectMutation(content)) {
      contentError("INVALID_CONTENT_STATE", 409, "动态图片仍在上传或清理中，暂时不能编辑。");
    }
    const value = validateCreateContentInput({
      type: input.type ?? content.type,
      title: input.title ?? content.title,
      summary: input.summary ?? content.summary,
      body: input.body ?? content.body,
      tags: input.tags ?? content.tags,
      coverImageUrl: input.coverImageUrl === undefined ? content.coverImageUrl : input.coverImageUrl,
      imageUrls: input.imageUrls ?? content.imageUrls,
      event: input.event ?? (content.event ? {
        startsAt: content.event.startsAt,
        endsAt: content.event.endsAt,
        location: content.event.location,
        capacity: content.event.capacity,
      } : undefined),
    });
    content.type = value.type;
    content.title = value.title;
    content.summary = value.summary;
    content.body = value.body;
    content.tags = [...(value.tags ?? [])];
    content.coverImageUrl = value.coverImageUrl ?? null;
    content.imageUrls = [...(value.imageUrls ?? [])];
    content.event = value.event ? {
      ...value.event,
      remainingCapacity: Math.max(0, value.event.capacity - content.registrationCount),
    } : null;
    content.updatedAt = this.currentTime();
    return cloneContent(content);
  }

  deleteContent(actor: ContentActor, contentId: string): boolean {
    requireAdmin(actor);
    return this.removeContent(this.requireExistingContent(contentId).id);
  }

  getAdminContent(actor: ContentActor, contentId: string): ContentItem {
    requireAdmin(actor);
    return cloneContent(this.requireExistingContent(contentId));
  }

  listAdminContent(actor: ContentActor): ContentItem[] {
    requireAdmin(actor);
    return [...this.content.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id, "zh-CN"))
      .map(cloneContent);
  }

  publish(actor: ContentActor, contentId: string): ContentItem {
    requireAdmin(actor);
    const content = this.requireExistingContent(contentId);
    if (this.hasPendingObjectMutation(content)) {
      contentError("INVALID_CONTENT_STATE", 409, "动态图片仍在上传或清理中，暂时不能发布。");
    }
    if (content.status === "published") return cloneContent(content);

    const now = this.currentTime();
    content.status = "published";
    content.publishedAt = now;
    content.offlineAt = null;
    content.updatedAt = now;
    return cloneContent(content);
  }

  takeOffline(actor: ContentActor, contentId: string): ContentItem {
    requireAdmin(actor);
    const content = this.requireExistingContent(contentId);
    if (content.status !== "published") {
      contentError("INVALID_CONTENT_STATE", 409, "只有已发布的内容可以下线。 ");
    }
    const now = this.currentTime();
    content.status = "offline";
    content.offlineAt = now;
    content.updatedAt = now;
    return cloneContent(content);
  }

  listPublicContent(filters: PublicContentFilters = {}): ContentPage {
    const normalized = validatePublicContentFilters(filters);
    const query = normalized.query?.toLocaleLowerCase("zh-CN");
    const now = this.currentTime();
    const matches = [...this.content.values()]
      .filter((content) => content.status === "published")
      .filter((content) => normalized.type === undefined || content.type === normalized.type)
      .filter((content) => normalized.tag === undefined || content.tags.includes(normalized.tag))
      .filter((content) => !query || [content.title, content.summary, content.body, ...content.tags]
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(query)))
      .filter((content) => !normalized.upcomingOnly
        || (content.type === "event" && content.event !== null && content.event.endsAt > now))
      .sort((left, right) =>
        (right.publishedAt ?? 0) - (left.publishedAt ?? 0)
        || right.createdAt - left.createdAt
        || right.id.localeCompare(left.id, "zh-CN"));

    const start = (normalized.page - 1) * normalized.pageSize;
    return {
      items: matches.slice(start, start + normalized.pageSize).map(cloneContent),
      page: normalized.page,
      pageSize: normalized.pageSize,
      total: matches.length,
      totalPages: matches.length === 0 ? 0 : Math.ceil(matches.length / normalized.pageSize),
    };
  }

  getPublicContent(contentId: string): ContentItem {
    return cloneContent(this.requirePublishedContent(contentId));
  }

  like(actor: ContentActor, contentId: string): ContentReactionResult {
    requireActor(actor);
    const content = this.requirePublishedContent(contentId);
    const users = this.likes.get(content.id) ?? new Set<string>();
    const previousSize = users.size;
    users.add(actor.userId.trim());
    this.likes.set(content.id, users);
    this.syncLikeCount(content, users.size);
    return { liked: true, changed: users.size !== previousSize, likeCount: users.size };
  }

  unlike(actor: ContentActor, contentId: string): ContentReactionResult {
    requireActor(actor);
    const content = this.requirePublishedContent(contentId);
    const users = this.likes.get(content.id) ?? new Set<string>();
    const changed = users.delete(actor.userId.trim());
    this.likes.set(content.id, users);
    this.syncLikeCount(content, users.size);
    return { liked: false, changed, likeCount: users.size };
  }

  registerForEvent(actor: ContentActor, contentId: string): EventRegistrationResult {
    requireActor(actor);
    const content = this.requirePublishedContent(contentId);
    const event = this.requireEvent(content);
    const now = this.currentTime();
    if (event.endsAt <= now) {
      contentError("EVENT_ENDED", 409, "该活动已经结束，无法继续报名。 ");
    }

    const registrations = this.registrations.get(content.id) ?? new Map<string, EventRegistration>();
    const userId = actor.userId.trim();
    const existing = registrations.get(userId);
    if (existing?.status === "registered") {
      contentError("ALREADY_REGISTERED", 409, "您已经报名该活动，请勿重复报名。 ");
    }
    const registrationCount = this.countActiveRegistrations(registrations);
    if (registrationCount >= event.capacity) {
      contentError("EVENT_FULL", 409, "该活动名额已满，暂时无法报名。 ");
    }

    const registration: EventRegistration = existing ?? {
      id: this.newId("registration"),
      contentId: content.id,
      userId,
      status: "registered",
      registeredAt: now,
      cancelledAt: null,
      updatedAt: now,
    };
    registration.status = "registered";
    registration.registeredAt = now;
    registration.cancelledAt = null;
    registration.updatedAt = now;
    registrations.set(userId, registration);
    this.registrations.set(content.id, registrations);
    this.syncRegistrationCount(content, registrations);
    return this.registrationResult(content, registration, true);
  }

  cancelEventRegistration(actor: ContentActor, contentId: string): EventRegistrationResult {
    requireActor(actor);
    const content = this.requireExistingContent(contentId);
    this.requireEvent(content);
    const registrations = this.registrations.get(content.id) ?? new Map<string, EventRegistration>();
    const registration = registrations.get(actor.userId.trim());
    if (!registration || registration.status === "cancelled") {
      this.syncRegistrationCount(content, registrations);
      return this.registrationResult(content, registration ?? null, false);
    }

    const now = this.currentTime();
    registration.status = "cancelled";
    registration.cancelledAt = now;
    registration.updatedAt = now;
    this.syncRegistrationCount(content, registrations);
    return this.registrationResult(content, registration, true);
  }

  listMyEventRegistrations(actor: ContentActor): EventRegistrationListItem[] {
    requireActor(actor);
    const userId = actor.userId.trim();
    return [...this.registrations.entries()]
      .flatMap(([contentId, registrations]) => {
        const registration = registrations.get(userId);
        const content = this.content.get(contentId);
        return registration?.status === "registered" && content
          ? [{ registration: cloneRegistration(registration), content: cloneContent(content) }]
          : [];
      })
      .sort((left, right) =>
        (left.content.event?.startsAt ?? Number.POSITIVE_INFINITY) - (right.content.event?.startsAt ?? Number.POSITIVE_INFINITY)
        || right.registration.updatedAt - left.registration.updatedAt);
  }

  private requireExistingContent(contentId: string): StoredContent {
    if (typeof contentId !== "string" || !contentId.trim()) {
      contentError("CONTENT_NOT_FOUND", 404, "没有找到对应内容。 ");
    }
    const content = this.content.get(contentId.trim());
    if (!content) contentError("CONTENT_NOT_FOUND", 404, "没有找到对应内容。 ");
    return content;
  }

  private removeContent(contentId: string): boolean {
    this.likes.delete(contentId);
    this.registrations.delete(contentId);
    return this.content.delete(contentId);
  }

  private stageDeletion(content: StoredContent): ContentItem {
    if (!content.tags.includes(MOMENT_DELETE_PENDING_TAG)) content.tags.push(MOMENT_DELETE_PENDING_TAG);
    if (content.status !== "offline") {
      const now = this.currentTime();
      content.status = "offline";
      content.offlineAt = now;
      content.updatedAt = now;
    }
    return cloneContent(content);
  }

  private hasPendingObjectMutation(content: StoredContent): boolean {
    return content.tags.includes(MOMENT_UPLOAD_PENDING_TAG) || content.tags.includes(MOMENT_DELETE_PENDING_TAG);
  }

  private requirePublishedContent(contentId: string): StoredContent {
    const content = this.requireExistingContent(contentId);
    if (content.status !== "published") {
      contentError("CONTENT_NOT_FOUND", 404, "没有找到对应内容。 ");
    }
    return content;
  }

  private requireEvent(content: StoredContent): NonNullable<StoredContent["event"]> {
    if (content.type !== "event" || !content.event) {
      contentError("NOT_AN_EVENT", 400, "该内容不是可报名的活动。 ");
    }
    return content.event;
  }

  private countActiveRegistrations(registrations: Map<string, EventRegistration>): number {
    return [...registrations.values()].filter((registration) => registration.status === "registered").length;
  }

  private syncLikeCount(content: StoredContent, likeCount: number): void {
    if (content.likeCount === likeCount) return;
    content.likeCount = likeCount;
    content.updatedAt = this.currentTime();
  }

  private syncRegistrationCount(
    content: StoredContent,
    registrations: Map<string, EventRegistration>,
  ): void {
    const count = this.countActiveRegistrations(registrations);
    content.registrationCount = count;
    if (content.event) content.event.remainingCapacity = content.event.capacity - count;
    content.updatedAt = this.currentTime();
  }

  private registrationResult(
    content: StoredContent,
    registration: EventRegistration | null,
    changed: boolean,
  ): EventRegistrationResult {
    const event = this.requireEvent(content);
    return {
      changed,
      registration: registration ? cloneRegistration(registration) : null,
      registrationCount: content.registrationCount,
      remainingCapacity: event.remainingCapacity,
    };
  }

  private currentTime(): number {
    const value = this.now();
    if (!Number.isFinite(value)) throw new Error("内容服务时钟必须返回有效时间。 ");
    return value;
  }

  private newId(prefix: ContentIdPrefix): string {
    const id = this.createId(prefix);
    if (typeof id !== "string" || !id.trim()) throw new Error("内容服务 ID 生成器返回了无效 ID。 ");
    const normalized = id.trim();
    if (prefix === "content" && this.content.has(normalized)) {
      throw new Error("内容服务 ID 生成器返回了重复 ID。 ");
    }
    return normalized;
  }
}
