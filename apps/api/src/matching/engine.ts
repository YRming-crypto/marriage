import { memberMatchesFilters } from "./filters.js";
import { checkHardConditions } from "./hard-conditions.js";
import { scoreMatch } from "./scoring.js";
import type { MatchCandidatesInput, MatchResult, MatchSort } from "./types.js";

export const ALGORITHM_VERSION = "bidirectional-rules-v1.0.0";

function compareMemberId(left: MatchResult, right: MatchResult): number {
  if (left.member.id < right.member.id) return -1;
  if (left.member.id > right.member.id) return 1;
  return 0;
}
function resultComparator(sort: MatchSort | undefined) {
  if (sort === "age-asc") {
    return (left: MatchResult, right: MatchResult) => left.member.age - right.member.age || compareMemberId(left, right);
  }
  if (sort === "age-desc") {
    return (left: MatchResult, right: MatchResult) => right.member.age - left.member.age || compareMemberId(left, right);
  }
  return (left: MatchResult, right: MatchResult) => right.score - left.score || compareMemberId(left, right);
}

export function matchCandidates(input: MatchCandidatesInput): MatchResult[] {
  const currentYear = input.currentYear ?? new Date().getFullYear();
  const filters = input.filters ?? {};
  return input.candidates
    .filter((candidate) => memberMatchesFilters(candidate.member, filters))
    .flatMap((candidate) => {
      const hardConditions = checkHardConditions(input.currentProfile, candidate.profile, { currentYear });
      if (!hardConditions.eligible) return [];
      const scored = scoreMatch(input.currentProfile, candidate.profile, candidate.member, currentYear);
      return [{
        member: candidate.member,
        score: scored.score,
        reasons: scored.reasons,
        factors: scored.factors,
        algorithmVersion: ALGORITHM_VERSION,
      }];
    })
    .sort(resultComparator(filters.sort));
}
