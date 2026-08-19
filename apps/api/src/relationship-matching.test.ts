import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("心意与匹配管理", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];
  afterEach(async () => { await Promise.all(apps.map((app) => app.close())); apps.length = 0; });

  async function setup() {
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);
    async function login(phone: string) {
      await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
      const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone, code: "123456" } });
      const cookie = response.cookies.find((item) => item.name === "refresh_token");
      return { cookie: `refresh_token=${cookie?.value}`, userId: response.json().data.user.id as string };
    }
    return { app, store, first: await login("13800138000"), second: await login("13900139000") };
  }

  it("喜欢可取消，并在双方喜欢后显示互相心仪", async () => {
    const { app, store, first, second } = await setup();
    store.members.set("member-first", { ...store.members.get("zhou-mingyuan")!, id: "member-first", ownerUserId: first.userId });

    const sent = await app.inject({ method: "POST", url: "/api/members/lin-wanqing/interest", headers: { cookie: first.cookie } });
    expect(sent.statusCode).toBe(201);
    const returned = await app.inject({ method: "POST", url: "/api/members/member-first/interest", headers: { cookie: second.cookie } });
    expect(returned.statusCode).toBe(201);

    const firstList = await app.inject({ method: "GET", url: "/api/me/interests", headers: { cookie: first.cookie } });
    expect(firstList.statusCode).toBe(200);
    expect(firstList.json().data.mutual).toEqual(expect.arrayContaining([expect.objectContaining({ member: expect.objectContaining({ id: "lin-wanqing" }) })]));

    const cancelled = await app.inject({ method: "DELETE", url: "/api/members/lin-wanqing/interest", headers: { cookie: first.cookie } });
    expect(cancelled.statusCode).toBe(204);
    const afterCancel = await app.inject({ method: "GET", url: "/api/me/interests", headers: { cookie: first.cookie } });
    expect(afterCancel.json().data.mutual).toHaveLength(0);
  });

  it("跳过后从推荐中隐藏，恢复后重新出现", async () => {
    const { app, store, first } = await setup();
    store.profiles.set(first.userId, { userId: first.userId, nickname: "用户", gender: "男性", birthYear: 1978, city: "上海", district: "徐汇", job: "工程", maritalStatus: "离异", goal: "认真交往", introduction: "认真认识。", preference: {}, answers: {}, profileStatus: "approved", visibility: "public", updatedAt: new Date().toISOString() });
    store.avatarProfiles.set(first.userId, { userId: first.userId, version: 1, approvedFacts: [{ topic: "生活", fact: "生活规律。" }], relationshipExpectations: ["认真交往"], boundaries: ["不公开联系方式"], unknownResponse: "建议真人确认。", status: "enabled", generatedAt: new Date().toISOString(), enabledAt: new Date().toISOString() });
    const skipped = await app.inject({ method: "POST", url: "/api/members/lin-wanqing/skip", headers: { cookie: first.cookie } });
    expect(skipped.statusCode).toBe(204);
    const hidden = await app.inject({ method: "GET", url: "/api/recommendations", headers: { cookie: first.cookie } });
    expect(hidden.json().data.items.some((item: { member: { id: string } }) => item.member.id === "lin-wanqing")).toBe(false);
    await app.inject({ method: "DELETE", url: "/api/members/lin-wanqing/skip", headers: { cookie: first.cookie } });
    const restored = await app.inject({ method: "GET", url: "/api/recommendations", headers: { cookie: first.cookie } });
    expect(restored.json().data.items.some((item: { member: { id: string } }) => item.member.id === "lin-wanqing")).toBe(true);
  });

  it("保存、列出和删除筛选方案", async () => {
    const { app, first } = await setup();
    const saved = await app.inject({ method: "POST", url: "/api/me/match-filters", headers: { cookie: first.cookie }, payload: { name: "上海同龄人", criteria: { city: "上海", minAge: 40, maxAge: 55 }, isDefault: true } });
    expect(saved.statusCode).toBe(201);
    const listed = await app.inject({ method: "GET", url: "/api/me/match-filters", headers: { cookie: first.cookie } });
    expect(listed.json().data.items).toHaveLength(1);
    expect(listed.json().data.items[0]).toMatchObject({ name: "上海同龄人", isDefault: true });
    const deleted = await app.inject({ method: "DELETE", url: `/api/me/match-filters/${saved.json().data.filter.id}`, headers: { cookie: first.cookie } });
    expect(deleted.statusCode).toBe(204);
  });
});
