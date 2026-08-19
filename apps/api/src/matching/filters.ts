import type { MatchFilters, MatchSort, PublicMemberData } from "./types.js";

const MIN_ALLOWED_AGE = 18;
const MAX_ALLOWED_AGE = 120;
const allowedGenders = new Set(["男性", "女性", "男", "女"]);
const allowedMaritalStatuses = new Set(["未婚", "离异", "丧偶"]);
const allowedGoals = new Set(["认真交往", "以结婚为目标", "先认识了解"]);
const allowedSorts = new Set<MatchSort>(["default", "match", "score-desc", "age-asc", "age-desc"]);

export class MatchFilterValidationError extends Error {
  readonly code = "INVALID_MATCH_FILTER";

  constructor(message: string) {
    super(message);
    this.name = "MatchFilterValidationError";
  }
}
function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new MatchFilterValidationError(`${field} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized === "不限") return undefined;
  return normalized;
}

function enumValue(value: unknown, field: string, allowed: ReadonlySet<string>): string | undefined {
  const normalized = optionalString(value, field);
  if (normalized !== undefined && !allowed.has(normalized)) {
    throw new MatchFilterValidationError(`${field} is not supported.`);
  }
  return normalized;
}

function ageValue(value: unknown, field: "minAge" | "maxAge"): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < MIN_ALLOWED_AGE || parsed > MAX_ALLOWED_AGE) {
    throw new MatchFilterValidationError(`${field} must be an integer between ${MIN_ALLOWED_AGE} and ${MAX_ALLOWED_AGE}.`);
  }
  return parsed;
}

export function parseMatchFilters(query: Readonly<Record<string, unknown>>): MatchFilters {
  const minAge = ageValue(query.minAge, "minAge");
  const maxAge = ageValue(query.maxAge, "maxAge");
  if (minAge !== undefined && maxAge !== undefined && minAge > maxAge) {
    throw new MatchFilterValidationError("minAge cannot be greater than maxAge.");
  }

  const city = optionalString(query.city, "city");
  if (city && city.length > 100) throw new MatchFilterValidationError("city must be at most 100 characters.");

  const rawSort = optionalString(query.sort, "sort");
  if (rawSort !== undefined && !allowedSorts.has(rawSort as MatchSort)) {
    throw new MatchFilterValidationError("sort is not supported.");
  }

  const filters: MatchFilters = {};
  const gender = enumValue(query.gender, "gender", allowedGenders);
  const maritalStatus = enumValue(query.maritalStatus, "maritalStatus", allowedMaritalStatuses);
  const goal = enumValue(query.goal, "goal", allowedGoals);
  if (gender !== undefined) filters.gender = gender;
  if (minAge !== undefined) filters.minAge = minAge;
  if (maxAge !== undefined) filters.maxAge = maxAge;
  if (city !== undefined) filters.city = city;
  if (maritalStatus !== undefined) filters.maritalStatus = maritalStatus;
  if (goal !== undefined) filters.goal = goal;
  if (rawSort !== undefined) filters.sort = rawSort as MatchSort;
  return filters;
}

export function memberMatchesFilters(member: PublicMemberData, filters: MatchFilters): boolean {
  return (filters.gender === undefined || member.gender === filters.gender)
    && (filters.minAge === undefined || member.age >= filters.minAge)
    && (filters.maxAge === undefined || member.age <= filters.maxAge)
    && (filters.city === undefined || member.city === filters.city)
    && (filters.maritalStatus === undefined || member.maritalStatus === filters.maritalStatus)
    && (filters.goal === undefined || member.goal === filters.goal);
}
