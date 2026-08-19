import { afterEach, describe, expect, it } from "vitest";
import { relationshipQuestions } from "@ai-marriage/shared";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("AI 婚恋平台完整纵向闭环", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  function createApp() {
    const app = buildServer({ otpCode: "123456", store: createMemoryStore() });
    apps.push(app);
    return app;
  }

  async function login(app: ReturnType<typeof buildServer>, phone: string) {
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
    const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone, code: "123456" } });
    expect(response.statusCode).toBe(200);
    const cookie = response.cookies.find((item) => item.name === "refresh_token");
    expect(cookie?.value).toBeTruthy();
    return { cookie: `${cookie?.name}=${cookie?.value}`, user: response.json().data.user };
  }

  async function saveProfile(app: ReturnType<typeof buildServer>, cookie: string, nickname: string, gender: string) {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: { cookie },
      payload: {
        nickname,
        gender,
        birthYear: gender === "女性" ? 1978 : 1975,
        city: "上海",
        district: "徐汇",
        job: gender === "女性" ? "教育" : "工程管理",
        maritalStatus: "离异",
        goal: "认真交往",
        smokingStatus: "不吸烟",
        childrenStatus: "子女已成年",
        introduction: "生活稳定，希望从真诚沟通开始认识彼此。",
        preference: {
          preferredGender: gender === "女性" ? "男性" : "女性",
          relationshipGoal: "认真交往",
          region: "同城优先",
          valuedQualities: "真诚、稳定、愿意沟通",
          dealBreakers: "欺骗和不尊重",
        },
        answers: Object.fromEntries(relationshipQuestions.map((question) => [question, `关于“${question}”的真实回答。`])),
      },
    });
    expect(response.statusCode).toBe(200);
  }

  it("从真实建档、审核和推荐走到 AI 分析、真人聊天、通知与安全处置", async () => {
    const app = createApp();
    const userA = await login(app, "13900002001");
    const userB = await login(app, "13900002002");
    const admin = await login(app, "13900139999");

    expect(admin.user.role).toBe("admin");
    await saveProfile(app, userA.cookie, "测试周先生", "男性");
    await saveProfile(app, userB.cookie, "测试林女士", "女性");

    const upload = await app.inject({
      method: "POST",
      url: "/api/me/photos",
      headers: { cookie: userB.cookie },
      payload: {
        filename: "portrait.png",
        mimeType: "image/png",
        sizeBytes: 68,
        dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=",
      },
    });
    expect(upload.statusCode).toBe(201);
    expect(upload.json().data.photo.reviewStatus).toBe("pending");
    const photoId = upload.json().data.photo.id;

    const requesterUpload = await app.inject({
      method: "POST",
      url: "/api/me/photos",
      headers: { cookie: userA.cookie },
      payload: {
        filename: "requester-portrait.png",
        mimeType: "image/png",
        sizeBytes: 68,
        dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=",
      },
    });
    expect(requesterUpload.statusCode).toBe(201);
    const requesterPhotoId = requesterUpload.json().data.photo.id;

    const requesterGenerated = await app.inject({ method: "POST", url: "/api/me/avatar-profile/generate", headers: { cookie: userA.cookie } });
    expect(requesterGenerated.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/me/avatar-profile/enable", headers: { cookie: userA.cookie } })).statusCode).toBe(200);
    const generated = await app.inject({ method: "POST", url: "/api/me/avatar-profile/generate", headers: { cookie: userB.cookie } });
    expect(generated.statusCode).toBe(201);
    expect(generated.json().data.avatarProfile.approvedFacts.length).toBeGreaterThan(0);
    const enabled = await app.inject({ method: "POST", url: "/api/me/avatar-profile/enable", headers: { cookie: userB.cookie } });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().data.avatarProfile.status).toBe("enabled");
    expect((await app.inject({ method: "PATCH", url: "/api/me/visibility", headers: { cookie: userB.cookie }, payload: { visibility: "public" } })).statusCode).toBe(200);

    const moderation = await app.inject({ method: "GET", url: "/api/admin/moderation", headers: { cookie: admin.cookie } });
    expect(moderation.statusCode).toBe(200);
    expect(moderation.json().data.profiles.some((item: { userId: string }) => item.userId === userB.user.id)).toBe(true);
    expect(moderation.json().data.photos.some((item: { id: string }) => item.id === photoId)).toBe(true);
    const moderationProfile = moderation.json().data.profiles.find((item: { userId: string }) => item.userId === userB.user.id);
    expect(moderationProfile).not.toHaveProperty("answers");
    expect(moderationProfile).not.toHaveProperty("preference");

    const profileApproval = await app.inject({ method: "POST", url: `/api/admin/profiles/${userB.user.id}/approve`, headers: { cookie: admin.cookie } });
    expect(profileApproval.statusCode).toBe(200);
    const photoApproval = await app.inject({ method: "POST", url: `/api/admin/photos/${photoId}/approve`, headers: { cookie: admin.cookie } });
    expect(photoApproval.statusCode).toBe(200);
    const requesterProfileApproval = await app.inject({ method: "POST", url: `/api/admin/profiles/${userA.user.id}/approve`, headers: { cookie: admin.cookie } });
    expect(requesterProfileApproval.statusCode).toBe(200);
    const requesterPhotoApproval = await app.inject({ method: "POST", url: `/api/admin/photos/${requesterPhotoId}/approve`, headers: { cookie: admin.cookie } });
    expect(requesterPhotoApproval.statusCode).toBe(200);
    const memberId = profileApproval.json().data.member.id;

    const members = await app.inject({ method: "GET", url: "/api/members?city=上海", headers: { cookie: userA.cookie } });
    expect(members.json().data.items.some((item: { id: string; nickname: string }) => item.id === memberId && item.nickname === "测试林女士")).toBe(true);
    const memberDetail = await app.inject({ method: "GET", url: `/api/members/${memberId}`, headers: { cookie: userA.cookie } });
    expect(memberDetail.statusCode).toBe(200);
    expect(memberDetail.json().data.member.nickname).toBe("测试林女士");
    expect(memberDetail.json().data.member.userId).toBe(userB.user.id);
    expect(memberDetail.json().data.member).toMatchObject({ smokingStatus: "不吸烟", childrenStatus: "子女已成年", joinedAt: expect.any(String) });

    const recommendations = await app.inject({ method: "GET", url: "/api/recommendations", headers: { cookie: userA.cookie } });
    expect(recommendations.statusCode).toBe(200);
    const recommendation = recommendations.json().data.items.find((item: { member: { id: string } }) => item.member.id === memberId);
    expect(recommendation.score).toBeGreaterThanOrEqual(60);
    expect(recommendation.reasons.length).toBeGreaterThan(0);

    expect((await app.inject({ method: "POST", url: `/api/members/${memberId}/interest`, headers: { cookie: userA.cookie } })).statusCode).toBe(201);
    const avatar = await app.inject({ method: "POST", url: "/api/avatar-sessions", headers: { cookie: userA.cookie }, payload: { memberId } });
    expect(avatar.statusCode).toBe(201);
    const sessionId = avatar.json().data.session.id;
    for (const text of ["周末通常怎么安排？", "你希望建立怎样的关系？", "遇到分歧如何沟通？"]) {
      const answer = await app.inject({ method: "POST", url: `/api/avatar-sessions/${sessionId}/messages`, headers: { cookie: userA.cookie }, payload: { text } });
      expect(answer.statusCode).toBe(201);
      expect(answer.json().data.messages[1].text).not.toContain("手机号");
    }

    const analysis = await app.inject({ method: "GET", url: `/api/avatar-sessions/${sessionId}/analysis`, headers: { cookie: userA.cookie } });
    expect(analysis.statusCode).toBe(200);
    expect(analysis.json().data.analysis.canRequestChat).toBe(true);
    expect(analysis.json().data.analysis.commonPoints.length).toBeGreaterThan(0);
    expect(analysis.json().data.analysis.discussionTopics.length).toBeGreaterThan(0);

    const request = await app.inject({ method: "POST", url: "/api/chat-requests", headers: { cookie: userA.cookie }, payload: { avatarSessionId: sessionId } });
    expect(request.statusCode).toBe(201);
    const requestId = request.json().data.request.id;

    const incomingNotice = await app.inject({ method: "GET", url: "/api/notifications", headers: { cookie: userB.cookie } });
    expect(incomingNotice.json().data.items.some((item: { type: string }) => item.type === "chat_request_received")).toBe(true);

    const accepted = await app.inject({ method: "POST", url: `/api/chat-requests/${requestId}/accept`, headers: { cookie: userB.cookie } });
    expect(accepted.statusCode).toBe(200);
    const conversationId = accepted.json().data.conversation.id;

    const message = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: userA.cookie },
      payload: { text: "你好，很高兴认识你。", clientMessageId: "complete-flow-message-1" },
    });
    expect(message.statusCode).toBe(201);
    const newMessageNotice = await app.inject({ method: "GET", url: "/api/notifications", headers: { cookie: userB.cookie } });
    expect(newMessageNotice.json().data.items.some((item: { type: string }) => item.type === "new_message")).toBe(true);

    const report = await app.inject({
      method: "POST",
      url: "/api/reports",
      headers: { cookie: userA.cookie },
      payload: { targetUserId: userB.user.id, reason: "其他", description: "完整流程测试举报。" },
    });
    expect(report.statusCode).toBe(201);
    const reportId = report.json().data.report.id;
    const reportQueue = await app.inject({ method: "GET", url: "/api/admin/reports", headers: { cookie: admin.cookie } });
    expect(reportQueue.json().data.items.some((item: { id: string }) => item.id === reportId)).toBe(true);
    const resolved = await app.inject({ method: "POST", url: `/api/admin/reports/${reportId}/resolve`, headers: { cookie: admin.cookie }, payload: { resolution: "已记录并提醒双方保持尊重。" } });
    expect(resolved.statusCode).toBe(200);

    const blocked = await app.inject({ method: "POST", url: `/api/users/${userA.user.id}/block`, headers: { cookie: userB.cookie } });
    expect(blocked.statusCode).toBe(201);
    const blockedMessage = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: userA.cookie },
      payload: { text: "这条消息不应发送成功。", clientMessageId: "complete-flow-message-2" },
    });
    expect(blockedMessage.statusCode).toBe(409);
    expect(blockedMessage.json().error.code).toBe("CHAT_BLOCKED");
  });
});
