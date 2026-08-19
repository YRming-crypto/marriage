export interface MatchPreferenceInput {
  [key: string]: unknown;
  genders?: readonly string[];
  preferredGender?: string;
  minAge?: number | string | null;
  maxAge?: number | string | null;
  cities?: readonly string[];
  region?: string;
  maritalStatuses?: readonly string[];
  goals?: readonly string[];
  relationshipGoal?: string;
  acceptsLongDistance?: boolean;
  valuedQualities?: readonly string[] | string;
  dealBreakers?: readonly string[] | string;
}
export interface MatchProfile {
  userId: string;
  gender: string;
  birthYear: number;
  city: string;
  maritalStatus: string;
  goal: string;
  tags?: readonly string[];
  preference?: MatchPreferenceInput | null;
}

export interface PublicMemberData {
  id: string;
  nickname: string;
  gender: string;
  age: number;
  city: string;
  maritalStatus: string;
  goal: string;
  tags?: readonly string[];
  verified?: boolean;
  [key: string]: unknown;
}

export interface MatchCandidate {
  profile: MatchProfile;
  member: PublicMemberData;
}

export type HardCondition = "gender" | "age" | "location" | "maritalStatus" | "goal";
export type PreferenceDirection = "current-to-candidate" | "candidate-to-current";

export interface HardConditionFailure {
  condition: HardCondition;
  direction: PreferenceDirection;
  message: string;
}

export interface HardConditionResult {
  eligible: boolean;
  failures: HardConditionFailure[];
}

export type MatchSort = "default" | "match" | "score-desc" | "age-asc" | "age-desc";

export interface MatchFilters {
  gender?: string;
  minAge?: number;
  maxAge?: number;
  city?: string;
  maritalStatus?: string;
  goal?: string;
  sort?: MatchSort;
}

export interface MatchFactor {
  factor: "age" | "location" | "goal" | "maritalStatus" | "qualities" | "profileTrust";
  label: string;
  score: number;
  explanation: string;
}

export interface MatchResult {
  member: PublicMemberData;
  score: number;
  reasons: string[];
  factors: MatchFactor[];
  algorithmVersion: string;
}

export interface MatchCandidatesInput {
  currentProfile: MatchProfile;
  candidates: readonly MatchCandidate[];
  filters?: MatchFilters;
  currentYear?: number;
}
