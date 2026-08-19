import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("服务端推荐路由", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  async function loginWithProfile() {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: "13800138000" } });
    const verified = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13800138000", code: "123456" } });
    const refresh = verified.cookies.find((cookie) => cookie.name === "refresh_token");
    const userId = verified.json().data.user.id as string;
    store.profiles.set(userId, {
      userId,
      nickname: "测试用户",
      gender: "女性",
      birthYear: 1980,
      city: "上海",
      district: "徐汇",
      job: "教育",
      maritalStatus: "离异",
      goal: "认真交往",
      introduction: "希望认真认识彼此。",
      preference: { preferredGender: "男性", minAge: "40", maxAge: "55", region: "不限地区" },
      answers: { relationship: "重视坦诚沟通" },
      profileStatus: "approved",
      visibility: "public",
      updatedAt: new Date().toISOString(),
    });
    return { app, store, cookie: `refresh_token=${refresh?.value}` };
  }

  it("拒绝非法筛选参数", async () => {
    const { app, cookie } = await loginWithProfile();
    const generated = await app.inject({ method: "POST", url: "/api/me/avatar-profile/generate", headers: { cookie } });
    expect(generated.statusCode).toBe(201);
    await app.inject({ method: "POST", url: "/api/me/avatar-profile/enable", headers: { cookie } });
    const response = await app.inject({ method: "GET", url: "/api/recommendations?minAge=17", headers: { cookie } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_MATCH_FILTER");
  });

  it("未启用自己的 AI 分身时不能进入正式匹配", async () => {
    const { app, cookie } = await loginWithProfile();
    const response = await app.inject({ method: "GET", url: "/api/recommendations", headers: { cookie } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "AVATAR_PROFILE_REQUIRED" } });
  });

  it("执行服务端筛选并只返回面向用户的解释结果", async () => {
    const { app, store, cookie } = await loginWithProfile();
    const generated = await app.inject({ method: "POST", url: "/api/me/avatar-profile/generate", headers: { cookie } });
    expect(generated.statusCode).toBe(201);
    await app.inject({ method: "POST", url: "/api/me/avatar-profile/enable", headers: { cookie } });
    const response = await app.inject({ method: "GET", url: "/api/recommendations?gender=男性&sort=age-asc", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items.length).toBeGreaterThan(0);
    expect(response.json().data.items.every((item: { member: { gender: string } }) => item.member.gender === "男性")).toBe(true);
    expect(response.json().data.items[0]).toMatchObject({ score: expect.any(Number), reasons: expect.any(Array) });
    expect(response.json().data.items[0]).not.toHaveProperty("algorithmVersion");
    expect(response.json().data.items[0]).not.toHaveProperty("factors");
    expect(store.matchSnapshots.size).toBe(response.json().data.items.length);
    expect([...store.matchSnapshots.values()][0]).toMatchObject({
      algorithmVersion: "bidirectional-rules-v1.0.0",
      factors: expect.any(Array),
    });
  });
});
