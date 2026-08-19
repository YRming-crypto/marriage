import { contentError } from "./errors.js";
import type {
  ContentActor,
  CreateContentInput,
  EventDetailsInput,
  PublicContentFilters,
} from "./types.js";

const CONTENT_TYPES = new Set(["article", "event"]);
const ACTOR_ROLES = new Set(["member", "admin"]);

function cleanRequiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    contentError("INVALID_CONTENT_INPUT", 400, `${field}必须是文本。`);
  }
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength) {
    contentError("INVALID_CONTENT_INPUT", 400, `${field}不能为空，且不能超过${maxLength}个字符。`);
  }
  return cleaned;
}
function normalizeTags(tags: unknown): string[] {
  if (tags === undefined) return [];
  if (!Array.isArray(tags) || tags.length > 10) {
    contentError("INVALID_CONTENT_INPUT", 400, "标签必须是数组，且最多填写10个。 ");
  }
  const normalized = tags.map((tag) => cleanRequiredText(tag, "标签", 20));
  return [...new Set(normalized)];
}

function normalizeCoverImageUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > 2_000) {
    contentError("INVALID_CONTENT_INPUT", 400, "封面图片地址格式不正确。 ");
  }
  const normalized = value.trim();
  if (normalized.startsWith("/") && !normalized.startsWith("//")) return normalized;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid protocol");
    return url.toString();
  } catch {
    contentError("INVALID_CONTENT_INPUT", 400, "封面图片地址必须是站内地址或有效的 HTTP/HTTPS 地址。 ");
  }
}

export function normalizeImageUrls(value: unknown, maximum = 9): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    contentError("INVALID_CONTENT_INPUT", 400, `动态最多上传 ${maximum} 张图片。`);
  }
  return [...new Set(value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.trim().length > 2_000) {
      contentError("INVALID_CONTENT_INPUT", 400, "动态图片地址格式不正确。 ");
    }
    const normalized = item.trim();
    if (!normalized.startsWith("/") && !/^https?:\/\//i.test(normalized)) {
      contentError("INVALID_CONTENT_INPUT", 400, "动态图片地址格式不正确。 ");
    }
    return normalized;
  }))];
}

function normalizeEventDetails(value: unknown): EventDetailsInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    contentError("INVALID_CONTENT_INPUT", 400, "活动内容必须填写时间、地点和人数上限。 ");
  }
  const event = value as Partial<EventDetailsInput>;
  if (!Number.isFinite(event.startsAt) || !Number.isFinite(event.endsAt)) {
    contentError("INVALID_CONTENT_INPUT", 400, "活动开始和结束时间必须是有效时间。 ");
  }
  if ((event.endsAt as number) <= (event.startsAt as number)) {
    contentError("INVALID_CONTENT_INPUT", 400, "活动结束时间必须晚于开始时间。 ");
  }
  if (!Number.isInteger(event.capacity) || (event.capacity as number) < 1 || (event.capacity as number) > 10_000) {
    contentError("INVALID_CONTENT_INPUT", 400, "活动人数上限必须是1到10000之间的整数。 ");
  }
  return {
    startsAt: event.startsAt as number,
    endsAt: event.endsAt as number,
    location: cleanRequiredText(event.location, "活动地点", 120),
    capacity: event.capacity as number,
  };
}

export function requireActor(actor: ContentActor): void {
  if (!actor || typeof actor.userId !== "string" || !actor.userId.trim()) {
    contentError("UNAUTHENTICATED", 401, "请先登录后再进行此操作。 ");
  }
  if (!ACTOR_ROLES.has(actor.role)) {
    contentError("FORBIDDEN", 403, "当前账号没有执行此操作的权限。 ");
  }
}

export function requireAdmin(actor: ContentActor): void {
  requireActor(actor);
  if (actor.role !== "admin") {
    contentError("FORBIDDEN", 403, "只有管理员可以管理内容。 ");
  }
}

export function validateCreateContentInput(input: CreateContentInput): CreateContentInput {
  if (!input || typeof input !== "object" || !CONTENT_TYPES.has(input.type)) {
    contentError("INVALID_CONTENT_INPUT", 400, "内容类型只能是文章或活动。 ");
  }
  const normalized: CreateContentInput = {
    type: input.type,
    title: cleanRequiredText(input.title, "标题", 100),
    summary: cleanRequiredText(input.summary, "摘要", 300),
    body: cleanRequiredText(input.body, "正文", 20_000),
    tags: normalizeTags(input.tags),
    coverImageUrl: normalizeCoverImageUrl(input.coverImageUrl),
    imageUrls: normalizeImageUrls(input.imageUrls),
  };
  if (input.type === "event") {
    normalized.event = normalizeEventDetails(input.event);
  } else if (input.event !== undefined) {
    contentError("INVALID_CONTENT_INPUT", 400, "文章不能包含活动报名信息。 ");
  }
  return normalized;
}

export interface NormalizedPublicContentFilters {
  type?: "article" | "event";
  tag?: string;
  query?: string;
  upcomingOnly: boolean;
  page: number;
  pageSize: number;
}

export function validatePublicContentFilters(
  filters: PublicContentFilters = {},
): NormalizedPublicContentFilters {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    contentError("INVALID_CONTENT_FILTER", 400, "内容筛选条件格式不正确。 ");
  }
  if (filters.type !== undefined && !CONTENT_TYPES.has(filters.type)) {
    contentError("INVALID_CONTENT_FILTER", 400, "内容类型筛选值不正确。 ");
  }
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  if (!Number.isInteger(page) || page < 1) {
    contentError("INVALID_CONTENT_FILTER", 400, "页码必须是大于0的整数。 ");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    contentError("INVALID_CONTENT_FILTER", 400, "每页数量必须是1到100之间的整数。 ");
  }
  if (filters.upcomingOnly !== undefined && typeof filters.upcomingOnly !== "boolean") {
    contentError("INVALID_CONTENT_FILTER", 400, "活动时间筛选值不正确。 ");
  }

  const normalizeOptionalFilter = (value: unknown, name: string): string | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim() || value.trim().length > 100) {
      contentError("INVALID_CONTENT_FILTER", 400, `${name}筛选值不正确。`);
    }
    return value.trim();
  };

  return {
    type: filters.type,
    tag: normalizeOptionalFilter(filters.tag, "标签"),
    query: normalizeOptionalFilter(filters.query, "关键词"),
    upcomingOnly: filters.upcomingOnly ?? false,
    page,
    pageSize,
  };
}
