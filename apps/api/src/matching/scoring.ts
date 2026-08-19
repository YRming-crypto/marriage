import type { MatchFactor, MatchProfile, PublicMemberData } from "./types.js";

const FACTOR_WEIGHTS: Readonly<Record<MatchFactor["factor"], number>> = {
  age: 0.2,
  location: 0.2,
  goal: 0.2,
  maritalStatus: 0.1,
  qualities: 0.2,
  profileTrust: 0.1,
};

function values(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value.split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean);
}
function ageFit(source: MatchProfile, targetAge: number): number {
  const min = Number(source.preference?.minAge);
  const max = Number(source.preference?.maxAge);
  if (!Number.isFinite(min) && !Number.isFinite(max)) return 75;
  const lower = Number.isFinite(min) ? min : targetAge;
  const upper = Number.isFinite(max) ? max : targetAge;
  if (upper <= lower) return 100;
  const center = (lower + upper) / 2;
  const halfRange = (upper - lower) / 2;
  return Math.max(70, Math.round(100 - (Math.abs(targetAge - center) / halfRange) * 30));
}

function overlapScore(currentProfile: MatchProfile, candidateProfile: MatchProfile): number {
  const currentSignals = new Set([
    ...(currentProfile.tags ?? []),
    ...values(currentProfile.preference?.valuedQualities),
  ].map((item) => item.trim()).filter(Boolean));
  const candidateSignals = new Set([
    ...(candidateProfile.tags ?? []),
    ...values(candidateProfile.preference?.valuedQualities),
  ].map((item) => item.trim()).filter(Boolean));
  if (currentSignals.size === 0 || candidateSignals.size === 0) return 65;
  const common = [...currentSignals].filter((item) => candidateSignals.has(item)).length;
  return Math.min(100, 55 + common * 15);
}

export function scoreMatch(
  currentProfile: MatchProfile,
  candidateProfile: MatchProfile,
  member: PublicMemberData,
  currentYear: number,
): { score: number; factors: MatchFactor[]; reasons: string[] } {
  const currentAge = currentYear - currentProfile.birthYear;
  const candidateAge = currentYear - candidateProfile.birthYear;
  const ageScore = Math.round((ageFit(currentProfile, candidateAge) + ageFit(candidateProfile, currentAge)) / 2);
  const sameCity = currentProfile.city === candidateProfile.city;
  const sameGoal = currentProfile.goal === candidateProfile.goal;
  const sameMaritalStatus = currentProfile.maritalStatus === candidateProfile.maritalStatus;
  const qualitiesScore = overlapScore(currentProfile, candidateProfile);

  const factors: MatchFactor[] = [
    {
      factor: "age",
      label: "年龄期待",
      score: ageScore,
      explanation: ageScore >= 90 ? "双方年龄都处于彼此较理想的范围。" : "双方年龄满足明确条件，仍可进一步了解生活阶段。",
    },
    {
      factor: "location",
      label: "生活地点",
      score: sameCity ? 100 : 60,
      explanation: sameCity ? `双方都在${currentProfile.city}，日常见面更便利。` : "双方已接受当前城市组合，但异地相处仍需要沟通安排。",
    },
    {
      factor: "goal",
      label: "关系目标",
      score: sameGoal ? 100 : 70,
      explanation: sameGoal ? `双方公开的关系目标都是“${currentProfile.goal}”。` : "双方关系目标符合彼此范围，但表述并不完全相同。",
    },
    {
      factor: "maritalStatus",
      label: "经历契合",
      score: sameMaritalStatus ? 90 : 72,
      explanation: sameMaritalStatus ? "双方婚姻状态相同，可能更容易理解彼此经历。" : "双方婚姻状态符合彼此明确接受的范围。",
    },
    {
      factor: "qualities",
      label: "看重品质",
      score: qualitiesScore,
      explanation: qualitiesScore >= 70 ? "公开标签和看重的品质存在共同点。" : "公开资料中的品质线索较少，适合通过交流继续确认。",
    },
    {
      factor: "profileTrust",
      label: "资料可信度",
      score: member.verified ? 100 : 65,
      explanation: member.verified ? "候选人的公开会员资料已通过平台验证。" : "候选人的公开资料可用于初步了解，验证信息仍有限。",
    },
  ];

  const score = Math.max(0, Math.min(100, Math.round(factors.reduce(
    (total, factor) => total + factor.score * FACTOR_WEIGHTS[factor.factor],
    0,
  ))));
  const reasons = [...factors]
    .sort((left, right) => right.score - left.score || left.factor.localeCompare(right.factor))
    .slice(0, 3)
    .map((factor) => factor.explanation);
  return { score, factors, reasons };
}
