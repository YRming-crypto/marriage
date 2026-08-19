import { describe, expect, it } from "vitest";
import { parsePublicMemberSearchQuery, PublicMemberSearchError, searchPublicMembers } from "./public-search.js";

const members = [
  { id: "a", nickname: "A", gender: "女性", age: 46, city: "杭州", maritalStatus: "离异", goal: "认真交往", smokingStatus: "不吸烟", childrenStatus: "有子女", photoUrl: "/a.jpg", lastActiveAt: "2026-08-14T10:00:00.000Z", joinedAt: "2026-08-01T10:00:00.000Z" },
  { id: "b", nickname: "B", gender: "女性", age: 51, city: "杭州", maritalStatus: "丧偶", goal: "以结婚为目标", smokingStatus: "偶尔吸烟", childrenStatus: "子女已成年", photoUrl: "", lastActiveAt: "2026-08-14T12:00:00.000Z", joinedAt: "2026-08-13T10:00:00.000Z" },
  { id: "c", nickname: "C", gender: "男性", age: 49, city: "上海", maritalStatus: "未婚", goal: "先认识了解", smokingStatus: "不吸烟", childrenStatus: "无子女", photoUrl: "/c.jpg", lastActiveAt: "2026-08-13T12:00:00.000Z", joinedAt: "2026-08-14T10:00:00.000Z" },
];

describe("public member search", () => {
  it("applies all public filters on the server", () => {
    const result = searchPublicMembers(members, {
      gender: "女性",
      minAge: 40,
      maxAge: 50,
      city: "杭州",
      maritalStatus: "离异",
      goal: "认真交往",
      smokingStatus: "不吸烟",
      childrenStatus: "有子女",
      onlyWithPhoto: true,
    });

    expect(result.map((member) => member.id)).toEqual(["a"]);
  });

  it("supports stable recent, newest, and age ordering", () => {
    expect(searchPublicMembers(members, { sort: "recent-active" }).map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(searchPublicMembers(members, { sort: "newest" }).map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(searchPublicMembers(members, { sort: "age-asc" }).map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("uses member id as the deterministic final tie breaker", () => {
    const sameAge = [
      { ...members[0]!, id: "member-z", age: 46 },
      { ...members[0]!, id: "member-a", age: 46 },
      { ...members[0]!, id: "member-m", age: 46 },
    ];
    expect(searchPublicMembers(sameAge, { sort: "age-asc" }).map((item) => item.id)).toEqual(["member-a", "member-m", "member-z"]);
  });

  it("rejects invalid ranges and unsupported values", () => {
    expect(() => searchPublicMembers(members, { minAge: 55, maxAge: 40 })).toThrow(PublicMemberSearchError);
    expect(() => searchPublicMembers(members, { sort: "random" as never })).toThrow(PublicMemberSearchError);
    expect(() => searchPublicMembers(members, { gender: "不限性别" })).toThrow(PublicMemberSearchError);
  });

  it("parses an HTTP query into validated search and page options", () => {
    expect(parsePublicMemberSearchQuery({
      gender: "女性",
      minAge: "40",
      maxAge: "55",
      onlyWithPhoto: "true",
      sort: "recent-active",
      pageSize: "12",
      cursor: "v1.YQ",
    })).toEqual({
      filters: {
        gender: "女性",
        minAge: 40,
        maxAge: 55,
        onlyWithPhoto: true,
        sort: "recent-active",
      },
      pageSize: 12,
      cursor: "v1.YQ",
    });

    expect(() => parsePublicMemberSearchQuery({ onlyWithPhoto: "sometimes" })).toThrow(PublicMemberSearchError);
    expect(() => parsePublicMemberSearchQuery({ pageSize: "100" })).toThrow(PublicMemberSearchError);
  });
});
