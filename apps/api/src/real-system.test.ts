import { afterEach, describe, expect, it } from "vitest";
import { relationshipQuestions } from "@ai-marriage/shared";
import { buildServer } from "./server.js";

const completeAnswers = Object.fromEntries(relationshipQuestions.map((question) => [question, "先冷静，再认真沟通。"]));

describe("真实系统第一阶段 API", () => {
  const apps: Array<Awaited<ReturnType<typeof buildServer>>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  function createApp() {
    const app = buildServer({ otpCode: "123456" });
    apps.push(app);
    return app;
  }

  async function login(app: ReturnType<typeof buildServer>, phone = "13800138000") {
    const request = await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone },
    });
    expect(request.statusCode).toBe(200);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { phone, code: "123456" },
    });
    expect(response.statusCode).toBe(200);
    const cookie = response.cookies.find((item) => item.name === "refresh_token");
    expect(cookie?.value).toBeTruthy();
    return { response, cookie: `${cookie?.name}=${cookie?.value}` };
  }

  it("可以通过 OTP 注册并在后续请求中恢复当前用户", async () => {
    const app = createApp();
    const { response, cookie } = await login(app);
    const user = response.json().data.user;

    expect(user).toMatchObject({ id: expect.any(String), phoneMasked: "138****8000" });

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.user.id).toBe(user.id);
  });

  it("拒绝错误验证码且不会创建会话", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone: "13900139000" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { phone: "13900139000", code: "000000" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("OTP_INVALID");
    expect(response.cookies).toHaveLength(0);
  });

  it("保存资料后只向公开成员接口返回审核通过的公开字段", async () => {
    const app = createApp();
    const { cookie } = await login(app);

    const profile = await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: { cookie },
      payload: {
        nickname: "李先生",
        gender: "男性",
        birthYear: 1977,
        city: "上海",
        district: "静安",
        job: "项目管理",
        maritalStatus: "离异",
        goal: "认真交往",
        introduction: "希望从真诚聊天开始。",
        preference: { preferredGender: "女性", valuedQualities: "真诚、有责任心" },
        answers: completeAnswers,
      },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().data.profile).toMatchObject({
      nickname: "李先生",
      profileStatus: "pending_review",
      preference: { valuedQualities: "真诚、有责任心" },
      answers: { "出现分歧时，你通常怎样处理？": "先冷静，再认真沟通。" },
    });

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.json().data.profile).toMatchObject({
      preference: { preferredGender: "女性" },
      answers: { "出现分歧时，你通常怎样处理？": "先冷静，再认真沟通。" },
    });

    const members = await app.inject({ method: "GET", url: "/api/members?city=上海" });
    expect(members.statusCode).toBe(200);
    expect(members.json().data.items.every((item: Record<string, unknown>) => !("phone" in item) && !("score" in item))).toBe(true);
    expect(members.json().data.items.some((item: Record<string, unknown>) => item.nickname === "李先生")).toBe(false);
  });

  it("拒绝超长或非对象的交往期待与关系问答", async () => {
    const app = createApp();
    const { cookie } = await login(app, "13800138001");
    const baseProfile = {
      nickname: "张女士",
      gender: "女性",
      birthYear: 1978,
      city: "上海",
      district: "徐汇",
      job: "教育",
      maritalStatus: "未婚",
      goal: "认真交往",
      introduction: "希望认真认识彼此。",
    };

    const invalidPreference = await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: { cookie },
      payload: { ...baseProfile, preference: [], answers: {} },
    });
    expect(invalidPreference.statusCode).toBe(400);

    const oversizedAnswer = await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: { cookie },
      payload: { ...baseProfile, preference: {}, answers: { question: "a".repeat(2_001) } },
    });
    expect(oversizedAnswer.statusCode).toBe(400);
  });

  it("服务端要求当前15题全部完成并忽略旧题目键", async () => {
    const app = createApp();
    const { cookie } = await login(app, "13800138002");
    const baseProfile = {
      nickname: "完整问答用户",
      gender: "女性",
      birthYear: 1978,
      city: "上海",
      district: "徐汇",
      job: "教育",
      maritalStatus: "未婚",
      goal: "认真交往",
      introduction: "希望认真认识彼此。",
      preference: {},
    };

    const incomplete = await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: { cookie },
      payload: { ...baseProfile, answers: Object.fromEntries(relationshipQuestions.slice(0, 14).map((question) => [question, "认真回答。"])) },
    });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().error.code).toBe("PROFILE_INVALID");

    const legacyAnswers = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`旧题目${index + 1}`, "旧答案"]));
    const complete = await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: { cookie },
      payload: { ...baseProfile, answers: { ...legacyAnswers, ...completeAnswers } },
    });
    expect(complete.statusCode).toBe(200);
    expect(Object.keys(complete.json().data.profile.answers)).toEqual(relationshipQuestions);
    expect(complete.json().data.profile.answers).not.toHaveProperty("旧题目1");
  });

  it.each([
    ["gender", "未知性别", "13800138010"],
    ["maritalStatus", "未知婚姻状态", "13800138011"],
    ["goal", "未知交往目标", "13800138012"],
  ])("拒绝不受支持的资料枚举 %s", async (field, value, phone) => {
    const app = createApp();
    const { cookie } = await login(app, phone);
    const response = await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: { cookie },
      payload: {
        nickname: "枚举校验用户",
        gender: "女性",
        birthYear: 1978,
        city: "上海",
        district: "徐汇",
        job: "教育",
        maritalStatus: "未婚",
        goal: "认真交往",
        introduction: "希望认真认识彼此。",
        preference: {},
        answers: {},
        [field]: value,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("PROFILE_INVALID");
  });

  it("感兴趣操作是幂等的且需要登录", async () => {
    const app = createApp();
    const anonymous = await app.inject({ method: "POST", url: "/api/members/lin-wanqing/interest" });
    expect(anonymous.statusCode).toBe(401);

    const { cookie } = await login(app);
    const first = await app.inject({ method: "POST", url: "/api/members/lin-wanqing/interest", headers: { cookie } });
    const second = await app.inject({ method: "POST", url: "/api/members/lin-wanqing/interest", headers: { cookie } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.interest.id).toBe(first.json().data.interest.id);
  });
});
