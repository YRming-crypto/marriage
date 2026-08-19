import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("智能推荐稳定分页", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  async function setup() {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: "13800138000" } });
    const verified = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13800138000", code: "123456" } });
    const cookie = `refresh_token=${verified.cookies.find((item) => item.name === "refresh_token")?.value}`;
    const userId = verified.json().data.user.id as string;
    store.profiles.set(userId, {
      userId,
      nickname: "分页测试用户",
      gender: "男性",
      birthYear: 1978,
      city: "上海",
      district: "静安",
      job: "工程",
      maritalStatus: "离异",
      goal: "认真交往",
      introduction: "希望认真了解彼此。",
      preference: { preferredGender: "女性", minAge: "40", maxAge: "55", region: "不限地区" },
      answers: { relationship: "重视坦诚沟通" },
      profileStatus: "approved",
      visibility: "public",
      updatedAt: new Date().toISOString(),
    });
    await app.inject({ method: "POST", url: "/api/me/avatar-profile/generate", headers: { cookie } });
    await app.inject({ method: "POST", url: "/api/me/avatar-profile/enable", headers: { cookie } });
    return { app, cookie, store };
  }

  it("返回总数和不重复的连续页面", async () => {
    const { app, cookie } = await setup();
    const first = await app.inject({ method: "GET", url: "/api/recommendations?pageSize=1", headers: { cookie } });

    expect(first.statusCode).toBe(200);
    expect(first.json().data.items).toHaveLength(1);
    expect(first.json().data).toMatchObject({ total: 2, hasMore: true, nextCursor: expect.any(String) });

    const second = await app.inject({
      method: "GET",
      url: `/api/recommendations?pageSize=1&cursor=${encodeURIComponent(first.json().data.nextCursor)}`,
      headers: { cookie },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.items).toHaveLength(1);
    expect(second.json().data.items[0].member.id).not.toBe(first.json().data.items[0].member.id);
    expect(second.json().data).toMatchObject({ total: 2, hasMore: false, nextCursor: null });
  });

  it("翻页期间匹配分变化时仍按首屏结果集顺序返回且不重复遗漏", async () => {
    const { app, cookie, store } = await setup();
    const first = await app.inject({ method: "GET", url: "/api/recommendations?pageSize=1", headers: { cookie } });

    expect(first.statusCode).toBe(200);
    expect(first.json().data.items[0].member.id).toBe("lin-wanqing");
    Object.assign(store.members.get("lin-wanqing")!, {
      age: 55,
      city: "杭州",
      maritalStatus: "未婚",
      goal: "以结婚为目标",
      tags: [],
      verified: false,
    });
    Object.assign(store.members.get("chen-jiayi")!, {
      age: 48,
      city: "上海",
      maritalStatus: "离异",
      goal: "认真交往",
      verified: true,
    });

    const second = await app.inject({
      method: "GET",
      url: `/api/recommendations?pageSize=1&cursor=${encodeURIComponent(first.json().data.nextCursor)}`,
      headers: { cookie },
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().data.items.map((item: { member: { id: string } }) => item.member.id)).toEqual(["chen-jiayi"]);
    expect(second.json().data).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("拒绝非法推荐游标", async () => {
    const { app, cookie } = await setup();
    const response = await app.inject({ method: "GET", url: "/api/recommendations?pageSize=1&cursor=broken", headers: { cookie } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_CURSOR" } });
  });

  it("上一页末项被删除后仍能继续，并拒绝跨排序复用游标", async () => {
    const { app, cookie, store } = await setup();
    const first = await app.inject({ method: "GET", url: "/api/recommendations?pageSize=1", headers: { cookie } });
    const firstMemberId = first.json().data.items[0].member.id as string;
    store.members.delete(firstMemberId);

    const continued = await app.inject({
      method: "GET",
      url: `/api/recommendations?pageSize=1&cursor=${encodeURIComponent(first.json().data.nextCursor)}`,
      headers: { cookie },
    });
    const wrongSort = await app.inject({
      method: "GET",
      url: `/api/recommendations?pageSize=1&sort=age-asc&cursor=${encodeURIComponent(first.json().data.nextCursor)}`,
      headers: { cookie },
    });

    expect(continued.statusCode).toBe(200);
    expect(continued.json().data.items).toHaveLength(1);
    expect(continued.json().data.items[0].member.id).not.toBe(firstMemberId);
    expect(wrongSort.statusCode).toBe(400);
    expect(wrongSort.json()).toMatchObject({ error: { code: "INVALID_CURSOR" } });
  });
});
