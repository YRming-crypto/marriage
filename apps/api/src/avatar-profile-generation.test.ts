import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("AI avatar profile generation", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  it("includes all 15 non-empty relationship answers in approved facts", async () => {
    const store = createMemoryStore();
    const app = buildServer({ otpCode: "123456", store });
    apps.push(app);

    const phone = "13900003915";
    await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { phone, code: "123456" },
    });
    const cookie = login.cookies.find((item) => item.name === "refresh_token");
    expect(login.statusCode).toBe(200);
    expect(cookie).toBeDefined();

    const userId = login.json().data.user.id as string;
    const answers = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [
        `relationship-question-${index + 1}`,
        `relationship-answer-${index + 1}`,
      ]),
    );
    store.profiles.set(userId, {
      userId,
      nickname: "十五题用户",
      gender: "女性",
      birthYear: 1978,
      city: "上海",
      district: "徐汇",
      job: "教育",
      maritalStatus: "离异",
      goal: "认真交往",
      introduction: "希望认真了解彼此。",
      preference: {
        preferredGender: "男性",
        relationshipGoal: "认真交往",
        valuedQualities: "真诚",
      },
      answers,
      profileStatus: "approved",
      visibility: "approved_only",
      updatedAt: new Date().toISOString(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/me/avatar-profile/generate",
      headers: { cookie: `${cookie?.name}=${cookie?.value}` },
    });

    expect(response.statusCode).toBe(201);
    const expectedFacts = Object.entries(answers).map(([topic, fact]) => ({ topic, fact }));
    expect(response.json().data.avatarProfile.approvedFacts).toEqual(expectedFacts);
    expect(store.avatarProfiles.get(userId)?.approvedFacts).toEqual(expectedFacts);
  });
});
