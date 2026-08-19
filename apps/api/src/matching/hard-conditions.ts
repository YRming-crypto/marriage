import type {
  HardCondition,
  HardConditionFailure,
  HardConditionResult,
  MatchPreferenceInput,
  MatchProfile,
  PreferenceDirection,
} from "./types.js";

interface HardConditionOptions {
  currentYear?: number;
}
function finiteAge(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function acceptedGenders(preference: MatchPreferenceInput): string[] {
  const structured = stringList(preference.genders);
  if (structured.length > 0) return structured;
  return typeof preference.preferredGender === "string" && preference.preferredGender.trim()
    ? [preference.preferredGender.trim()]
    : [];
}

function acceptedGoals(preference: MatchPreferenceInput): string[] {
  const structured = stringList(preference.goals);
  if (structured.length > 0) return structured;
  return typeof preference.relationshipGoal === "string" && preference.relationshipGoal.trim()
    ? [preference.relationshipGoal.trim()]
    : [];
}

function acceptsLocation(source: MatchProfile, target: MatchProfile): boolean {
  if (source.city === target.city) return true;
  const preference = source.preference;
  if (!preference) return true;

  const cities = stringList(preference.cities);
  if (cities.length > 0 && !cities.includes(target.city)) return false;
  if (preference.acceptsLongDistance === false) return false;
  return true;
}

function directionFailures(
  source: MatchProfile,
  target: MatchProfile,
  direction: PreferenceDirection,
  currentYear: number,
): HardConditionFailure[] {
  const preference = source.preference;
  if (!preference) return [];
  const failures: HardConditionFailure[] = [];
  const add = (condition: HardCondition, message: string) => failures.push({ condition, direction, message });

  const genders = acceptedGenders(preference);
  if (genders.length > 0 && !genders.includes(target.gender)) {
    add("gender", "对方性别不在明确偏好范围内。");
  }

  const targetAge = currentYear - target.birthYear;
  const minAge = finiteAge(preference.minAge);
  const maxAge = finiteAge(preference.maxAge);
  if ((minAge !== undefined && targetAge < minAge) || (maxAge !== undefined && targetAge > maxAge)) {
    add("age", "对方年龄不在明确偏好范围内。");
  }

  if (!acceptsLocation(source, target)) {
    add("location", "双方城市不同，且异地或目标城市条件不满足。");
  }

  const maritalStatuses = stringList(preference.maritalStatuses);
  if (maritalStatuses.length > 0 && !maritalStatuses.includes(target.maritalStatus)) {
    add("maritalStatus", "对方婚姻状态不在明确偏好范围内。");
  }

  const goals = acceptedGoals(preference);
  if (goals.length > 0 && !goals.includes(target.goal)) {
    add("goal", "对方关系目标不在明确偏好范围内。");
  }

  return failures;
}

export function checkHardConditions(
  currentProfile: MatchProfile,
  candidateProfile: MatchProfile,
  options: HardConditionOptions = {},
): HardConditionResult {
  const currentYear = options.currentYear ?? new Date().getFullYear();
  const failures = [
    ...directionFailures(currentProfile, candidateProfile, "current-to-candidate", currentYear),
    ...directionFailures(candidateProfile, currentProfile, "candidate-to-current", currentYear),
  ];
  return { eligible: failures.length === 0, failures };
}
