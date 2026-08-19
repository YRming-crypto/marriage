import { MAX_STABLE_CURSOR_LENGTH } from "./pagination.js";

const allowedGenders = new Set(["男性", "女性"]);
const allowedMaritalStatuses = new Set(["未婚", "离异", "丧偶"]);
const allowedGoals = new Set(["认真交往", "以结婚为目标", "先认识了解"]);
const allowedSmokingStatuses = new Set(["不吸烟", "偶尔吸烟", "吸烟"]);
const allowedChildrenStatuses = new Set(["无子女", "有子女", "子女已成年"]);
const allowedSorts = new Set(["default", "recent-active", "newest", "age-asc", "age-desc"]);

export class PublicMemberSearchError extends Error {
  readonly code = "INVALID_MEMBER_SEARCH";

  constructor(message: string) {
    super(message);
    this.name = "PublicMemberSearchError";
  }
}

export interface PublicSearchMember {
  id: string;
  gender?: string;
  age?: number;
  city?: string;
  maritalStatus?: string;
  goal?: string;
  smokingStatus?: string;
  childrenStatus?: string;
  photoUrl?: string;
  photoUrls?: string[];
  lastActiveAt?: string;
  joinedAt?: string;
}

export interface PublicMemberSearchFilters {
  gender?: string;
  minAge?: number;
  maxAge?: number;
  city?: string;
  maritalStatus?: string;
  goal?: string;
  smokingStatus?: string;
  childrenStatus?: string;
  onlyWithPhoto?: boolean;
  sort?: "default" | "recent-active" | "newest" | "age-asc" | "age-desc";
}

export interface ParsedPublicMemberSearch {
  filters: PublicMemberSearchFilters;
  pageSize: number;
  cursor?: string;
  includeIncomplete: boolean;
}

export function parsePublicMemberSearchQuery(query: Readonly<Record<string, unknown>>): ParsedPublicMemberSearch {
  const filters: PublicMemberSearchFilters = {};
  const gender = optionalQueryString(query.gender, "gender");
  const city = optionalQueryString(query.city, "city");
  const maritalStatus = optionalQueryString(query.maritalStatus, "marital status");
  const goal = optionalQueryString(query.goal, "relationship goal");
  const smokingStatus = optionalQueryString(query.smokingStatus ?? query.smoking, "smoking status");
  const childrenStatus = optionalQueryString(query.childrenStatus ?? query.children, "children status");
  const sort = optionalQueryString(query.sort, "sort order");
  const minAge = optionalQueryInteger(query.minAge, "minimum age");
  const maxAge = optionalQueryInteger(query.maxAge, "maximum age");
  if (gender !== undefined) filters.gender = gender;
  if (city !== undefined) filters.city = city;
  if (maritalStatus !== undefined) filters.maritalStatus = maritalStatus;
  if (goal !== undefined) filters.goal = goal;
  if (smokingStatus !== undefined) filters.smokingStatus = smokingStatus;
  if (childrenStatus !== undefined) filters.childrenStatus = childrenStatus;
  if (sort !== undefined) filters.sort = sort as PublicMemberSearchFilters["sort"];
  if (minAge !== undefined) filters.minAge = minAge;
  if (maxAge !== undefined) filters.maxAge = maxAge;
  if (query.onlyWithPhoto !== undefined) {
    if (query.onlyWithPhoto !== "true" && query.onlyWithPhoto !== "false" && query.onlyWithPhoto !== true && query.onlyWithPhoto !== false) {
      throw new PublicMemberSearchError("photo filter must be a boolean");
    }
    filters.onlyWithPhoto = query.onlyWithPhoto === "true" || query.onlyWithPhoto === true;
  }
  validateFilters(filters);

  const pageSize = query.pageSize === undefined ? 12 : optionalQueryInteger(query.pageSize, "page size");
  if (pageSize === undefined || pageSize < 1 || pageSize > 50) throw new PublicMemberSearchError("page size must be between 1 and 50");
  const cursor = optionalQueryString(query.cursor, "cursor", false);
  if (cursor && cursor.length > MAX_STABLE_CURSOR_LENGTH) throw new PublicMemberSearchError("cursor is too long");
  const includeIncomplete = query.includeIncomplete === true || query.includeIncomplete === "true";
  if (query.includeIncomplete !== undefined && query.includeIncomplete !== true && query.includeIncomplete !== false && query.includeIncomplete !== "true" && query.includeIncomplete !== "false") {
    throw new PublicMemberSearchError("incomplete member flag must be a boolean");
  }
  return { filters, pageSize, ...(cursor ? { cursor } : {}), includeIncomplete };
}

export function searchPublicMembers<T extends PublicSearchMember>(
  members: readonly T[],
  filters: PublicMemberSearchFilters,
): T[] {
  validateFilters(filters);
  const matching = members.filter((member) => (
    (filters.gender === undefined || member.gender === filters.gender)
    && (filters.minAge === undefined || (member.age !== undefined && member.age >= filters.minAge))
    && (filters.maxAge === undefined || (member.age !== undefined && member.age <= filters.maxAge))
    && (filters.city === undefined || member.city === filters.city)
    && (filters.maritalStatus === undefined || member.maritalStatus === filters.maritalStatus)
    && (filters.goal === undefined || member.goal === filters.goal)
    && (filters.smokingStatus === undefined || member.smokingStatus === filters.smokingStatus)
    && (filters.childrenStatus === undefined || member.childrenStatus === filters.childrenStatus)
    && (!filters.onlyWithPhoto || Boolean(member.photoUrl?.trim() || member.photoUrls?.some((url) => url.trim())))
  ));

  return matching.sort((left, right) => compareMembers(left, right, filters.sort ?? "default")
    || compareStableText(left.id, right.id));
}

export function publicMemberCursorKey(member: PublicSearchMember, sort: NonNullable<PublicMemberSearchFilters["sort"]> = "default") {
  if (sort === "age-asc") return [member.age ?? Number.MAX_SAFE_INTEGER];
  if (sort === "age-desc") return [-(member.age ?? Number.MIN_SAFE_INTEGER)];
  if (sort === "recent-active") return [-timestamp(member.lastActiveAt)];
  if (sort === "newest") return [-timestamp(member.joinedAt)];
  return [];
}

function validateFilters(filters: PublicMemberSearchFilters) {
  if (filters.minAge !== undefined && (!Number.isInteger(filters.minAge) || filters.minAge < 18 || filters.minAge > 120)) {
    throw new PublicMemberSearchError("minimum age is invalid");
  }
  if (filters.maxAge !== undefined && (!Number.isInteger(filters.maxAge) || filters.maxAge < 18 || filters.maxAge > 120)) {
    throw new PublicMemberSearchError("maximum age is invalid");
  }
  if (filters.minAge !== undefined && filters.maxAge !== undefined && filters.minAge > filters.maxAge) {
    throw new PublicMemberSearchError("minimum age cannot exceed maximum age");
  }
  validateOptional(filters.gender, allowedGenders, "gender");
  validateOptional(filters.maritalStatus, allowedMaritalStatuses, "marital status");
  validateOptional(filters.goal, allowedGoals, "relationship goal");
  validateOptional(filters.smokingStatus, allowedSmokingStatuses, "smoking status");
  validateOptional(filters.childrenStatus, allowedChildrenStatuses, "children status");
  validateOptional(filters.sort, allowedSorts, "sort order");
  if (filters.city !== undefined && (!filters.city.trim() || filters.city.length > 100)) {
    throw new PublicMemberSearchError("city is invalid");
  }
}

function validateOptional(value: string | undefined, allowed: ReadonlySet<string>, label: string) {
  if (value !== undefined && !allowed.has(value)) throw new PublicMemberSearchError(`${label} is unsupported`);
}

function optionalQueryString(value: unknown, label: string, treatUnlimitedAsEmpty = true) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new PublicMemberSearchError(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || (treatUnlimitedAsEmpty && normalized === "不限")) return undefined;
  return normalized;
}

function optionalQueryInteger(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isInteger(parsed)) throw new PublicMemberSearchError(`${label} must be an integer`);
  return parsed;
}

function compareMembers(left: PublicSearchMember, right: PublicSearchMember, sort: NonNullable<PublicMemberSearchFilters["sort"]>) {
  if (sort === "age-asc") return (left.age ?? Number.MAX_SAFE_INTEGER) - (right.age ?? Number.MAX_SAFE_INTEGER);
  if (sort === "age-desc") return (right.age ?? Number.MIN_SAFE_INTEGER) - (left.age ?? Number.MIN_SAFE_INTEGER);
  if (sort === "recent-active") return timestamp(right.lastActiveAt) - timestamp(left.lastActiveAt);
  if (sort === "newest") return timestamp(right.joinedAt) - timestamp(left.joinedAt);
  return 0;
}

function timestamp(value: string | undefined) {
  if (!value) return -8_640_000_000_000_000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : -8_640_000_000_000_000;
}

function compareStableText(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
