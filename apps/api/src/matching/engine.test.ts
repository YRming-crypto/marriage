import { describe, expect, it } from "vitest";
import {
  ALGORITHM_VERSION,
  MatchFilterValidationError,
  checkHardConditions,
  matchCandidates,
  parseMatchFilters,
  type MatchCandidate,
  type MatchProfile,
  type PublicMemberData,
} from "./index.js";

const CURRENT_YEAR = 2026;

function profile(overrides: Partial<MatchProfile> = {}): MatchProfile {
  return {
    userId: "viewer",
    gender: "女性",
    birthYear: 1980,
    city: "上海",
    maritalStatus: "离异",
    goal: "认真交往",
    tags: ["真诚", "阅读"],
    preference: {
      genders: ["男性"],
      minAge: 40,
      maxAge: 55,
      cities: ["上海"],
      maritalStatuses: ["离异", "未婚"],
      goals: ["认真交往", "以结婚为目标"],
      acceptsLongDistance: false,
      valuedQualities: ["真诚", "责任心"],
    },
    ...overrides,
  };
}

function member(overrides: Partial<PublicMemberData> = {}): PublicMemberData {
  return {
    id: "member-b",
    nickname: "候选人",
    gender: "男性",
    age: 48,
    city: "上海",
    maritalStatus: "离异",
    goal: "认真交往",
    tags: ["真诚", "责任心"],
    verified: true,
    ...overrides,
  };
}

function candidate(
  memberOverrides: Partial<PublicMemberData> = {},
  profileOverrides: Partial<MatchProfile> = {},
): MatchCandidate {
  const publicMember = member(memberOverrides);
  return {
    member: publicMember,
    profile: profile({
      userId: `user-${publicMember.id}`,
      gender: publicMember.gender,
      birthYear: CURRENT_YEAR - publicMember.age,
      city: publicMember.city,
      maritalStatus: publicMember.maritalStatus,
      goal: publicMember.goal,
      tags: publicMember.tags,
      preference: {
        genders: ["女性"],
        minAge: 40,
        maxAge: 52,
        cities: ["上海"],
        maritalStatuses: ["离异"],
        goals: ["认真交往"],
        acceptsLongDistance: false,
        valuedQualities: ["真诚"],
      },
      ...profileOverrides,
    }),
  };
}

describe("双向硬条件", () => {
  it("同时报告当前用户拒绝候选人与候选人拒绝当前用户", () => {
    const result = checkHardConditions(
      profile({ preference: { genders: ["男性"] } }),
      candidate({}, { preference: { genders: ["男性"] } }).profile,
      { currentYear: CURRENT_YEAR },
    );

    expect(result.eligible).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ condition: "gender", direction: "candidate-to-current" }),
    ]));

    const currentRejects = checkHardConditions(
      profile({ preference: { genders: ["女性"] } }),
      candidate().profile,
      { currentYear: CURRENT_YEAR },
    );
    expect(currentRejects.failures).toContainEqual(expect.objectContaining({
      condition: "gender",
      direction: "current-to-candidate",
    }));
  });

  it("异地时仅在双方都未明确拒绝且城市偏好允许时通过", () => {
    const viewer = profile({
      preference: { genders: ["男性"], cities: ["杭州"], acceptsLongDistance: true },
    });
    const remote = candidate(
      { city: "杭州" },
      { preference: { genders: ["女性"], cities: ["上海"], acceptsLongDistance: true } },
    );

    expect(checkHardConditions(viewer, remote.profile, { currentYear: CURRENT_YEAR }).eligible).toBe(true);

    remote.profile.preference = { genders: ["女性"], acceptsLongDistance: false };
    expect(checkHardConditions(viewer, remote.profile, { currentYear: CURRENT_YEAR }).failures)
      .toContainEqual(expect.objectContaining({ condition: "location", direction: "candidate-to-current" }));
  });

  it("年龄上下边界按包含关系检查双方偏好", () => {
    const viewer = profile({ birthYear: 1986, preference: { genders: ["男性"], minAge: 48, maxAge: 48 } });
    const boundary = candidate({}, { preference: { genders: ["女性"], minAge: 40, maxAge: 40 } });

    expect(checkHardConditions(viewer, boundary.profile, { currentYear: CURRENT_YEAR }).eligible).toBe(true);

    boundary.profile.preference = { genders: ["女性"], minAge: 41, maxAge: 50 };
    expect(checkHardConditions(viewer, boundary.profile, { currentYear: CURRENT_YEAR }).failures)
      .toContainEqual(expect.objectContaining({ condition: "age", direction: "candidate-to-current" }));
  });

  it("缺少偏好时采用宽松默认，同时仍尊重另一方的明确条件", () => {
    const viewer = profile({ preference: undefined });
    const openCandidate = candidate({ city: "北京" }, { preference: undefined });
    expect(checkHardConditions(viewer, openCandidate.profile, { currentYear: CURRENT_YEAR }).eligible).toBe(true);

    openCandidate.profile.preference = { maritalStatuses: ["未婚"] };
    expect(checkHardConditions(viewer, openCandidate.profile, { currentYear: CURRENT_YEAR }).failures)
      .toContainEqual(expect.objectContaining({ condition: "maritalStatus", direction: "candidate-to-current" }));
  });

  it("关系目标必须同时满足双方明确偏好", () => {
    const viewer = profile({ preference: { goals: ["认真交往"] } });
    const incompatible = candidate(
      { goal: "以结婚为目标" },
      { preference: { goals: ["以结婚为目标"] } },
    );

    const result = checkHardConditions(viewer, incompatible.profile, { currentYear: CURRENT_YEAR });
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ condition: "goal", direction: "current-to-candidate" }),
      expect.objectContaining({ condition: "goal", direction: "candidate-to-current" }),
    ]));
  });
});

describe("服务端过滤", () => {
  it("解析全部过滤参数并拒绝非法年龄范围", () => {
    expect(parseMatchFilters({
      gender: "男性",
      minAge: "40",
      maxAge: "55",
      city: " 上海 ",
      maritalStatus: "离异",
      goal: "认真交往",
      sort: "age-asc",
    })).toEqual({
      gender: "男性",
      minAge: 40,
      maxAge: 55,
      city: "上海",
      maritalStatus: "离异",
      goal: "认真交往",
      sort: "age-asc",
    });

    expect(() => parseMatchFilters({ minAge: "56", maxAge: "55" })).toThrow(MatchFilterValidationError);
    expect(() => parseMatchFilters({ minAge: "17" })).toThrow(/minAge/);
    expect(() => parseMatchFilters({ sort: "random" })).toThrow(/sort/);
  });

  it("在评分前应用性别、年龄、城市、婚姻状态和目标过滤", () => {
    const items = matchCandidates({
      currentProfile: profile({ preference: undefined }),
      candidates: [
        candidate({ id: "member-a", age: 45, city: "上海", maritalStatus: "未婚", goal: "认真交往" }, { preference: undefined }),
        candidate({ id: "member-b", age: 50, city: "杭州", maritalStatus: "离异", goal: "以结婚为目标" }, { preference: undefined }),
      ],
      filters: { gender: "男性", minAge: 44, maxAge: 46, city: "上海", maritalStatus: "未婚", goal: "认真交往" },
      currentYear: CURRENT_YEAR,
    });

    expect(items.map((item) => item.member.id)).toEqual(["member-a"]);
  });
});

describe("评分、解释与排序", () => {
  it("返回 0-100 整数分、原因、因素明细和算法版本，但不输出权重", () => {
    const [result] = matchCandidates({
      currentProfile: profile(),
      candidates: [candidate()],
      currentYear: CURRENT_YEAR,
    });

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.factors.length).toBeGreaterThan(0);
    expect(result.factors.every((factor) => factor.score >= 0 && factor.score <= 100 && factor.explanation.length > 0)).toBe(true);
    expect(result.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(JSON.stringify(result)).not.toMatch(/weight|权重/i);
  });

  it("同分时始终按 member id 升序稳定排序", () => {
    const result = matchCandidates({
      currentProfile: profile(),
      candidates: [
        candidate({ id: "member-c" }),
        candidate({ id: "member-a" }),
        candidate({ id: "member-b" }),
      ],
      currentYear: CURRENT_YEAR,
    });

    expect(new Set(result.map((item) => item.score)).size).toBe(1);
    expect(result.map((item) => item.member.id)).toEqual(["member-a", "member-b", "member-c"]);
  });

  it("兼容当前 API 的字符串偏好字段", () => {
    const viewer = profile({
      preference: {
        preferredGender: "男性",
        minAge: "40",
        maxAge: "55",
        region: "不限地区",
        relationshipGoal: "认真交往",
      },
    });
    const legacyCandidate = candidate({}, {
      preference: {
        preferredGender: "女性",
        minAge: "40",
        maxAge: "52",
        region: "不限地区",
        relationshipGoal: "认真交往",
      },
    });

    expect(matchCandidates({
      currentProfile: viewer,
      candidates: [legacyCandidate],
      currentYear: CURRENT_YEAR,
    })).toHaveLength(1);
  });
});
