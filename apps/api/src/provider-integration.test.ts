import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";

describe("buildServer provider integration", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
    vi.restoreAllMocks();
  });

  function createApp(overrides: Record<string, unknown> = {}) {
    const app = buildServer({
      store: createMemoryStore(),
      otpCode: "123456",
      ...overrides,
    } as Parameters<typeof buildServer>[0]);
    apps.push(app);
    return app;
  }

  async function login(app: ReturnType<typeof buildServer>, phone = "13800138000") {
    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { phone, code: "123456" },
    });
    return response.headers["set-cookie"];
  }

  it("saves a verifiable OTP only after the SMS provider succeeds", async () => {
    const store = createMemoryStore();
    const sendCode = vi.fn().mockResolvedValue(undefined);
    const app = buildServer({
      store,
      otpCode: "123456",
      providers: { sms: { sendCode } },
    } as Parameters<typeof buildServer>[0]);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone: "13800138000" },
    });

    expect(response.statusCode).toBe(200);
    expect(sendCode).toHaveBeenCalledWith({
      phone: "13800138000",
      code: "123456",
      expiresInSeconds: 300,
    });
    expect(store.otpRequests.get("13800138000")?.code).toBe("123456");
  });

  it("does not save an OTP when the SMS provider fails", async () => {
    const store = createMemoryStore();
    store.otpRequests.set("13800138000", {
      phone: "13800138000",
      code: "111111",
      expiresAt: Date.now() + 60_000,
    });
    const app = buildServer({
      store,
      otpCode: "123456",
      providers: { sms: { sendCode: vi.fn().mockRejectedValue(new Error("gateway unavailable")) } },
    } as Parameters<typeof buildServer>[0]);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/otp/request",
      payload: { phone: "13800138000" },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: { code: "SMS_SEND_FAILED" } });
    expect(store.otpRequests.has("13800138000")).toBe(false);
  });

  it("uploads photo bytes and deletes the object with the photo", async () => {
    const upload = vi.fn().mockResolvedValue({
      key: "photos/user/object.png",
      url: "https://cdn.example/photos/user/object.png",
    });
    const remove = vi.fn().mockResolvedValue(undefined);
    const app = createApp({
      providers: {
        sms: { sendCode: vi.fn().mockResolvedValue(undefined) },
        objectStorage: { upload, read: vi.fn(), delete: remove },
      },
    });
    const cookie = await login(app);

    const uploaded = await app.inject({
      method: "POST",
      url: "/api/me/photos",
      headers: { cookie },
      payload: {
        filename: "portrait.png",
        mimeType: "image/png",
        sizeBytes: 8,
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
    });

    expect(uploaded.statusCode).toBe(201);
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({
      data: Buffer.from("89504e470d0a1a0a", "hex"),
      filename: "portrait.png",
      mimeType: "image/png",
    }));
    expect(uploaded.json().data.photo).toMatchObject({
      objectKey: "photos/user/object.png",
    });
    expect(uploaded.json().data.photo.url).toMatch(/^\/api\/photos\/.+\/content$/);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/me/photos/${uploaded.json().data.photo.id}`,
      headers: { cookie },
    });

    expect(removed.statusCode).toBe(204);
    expect(remove).toHaveBeenCalledWith("photos/user/object.png");
  });

  it("rejects photo metadata that does not match the decoded file", async () => {
    const upload = vi.fn().mockResolvedValue({ key: "unused", url: "https://cdn.example/unused" });
    const app = createApp({
      providers: {
        sms: { sendCode: vi.fn().mockResolvedValue(undefined) },
        objectStorage: { upload, read: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) },
      },
    });
    const cookie = await login(app);

    const wrongSize = await app.inject({
      method: "POST",
      url: "/api/me/photos",
      headers: { cookie },
      payload: {
        filename: "portrait.png",
        mimeType: "image/png",
        sizeBytes: 7,
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
    });
    const wrongSignature = await app.inject({
      method: "POST",
      url: "/api/me/photos",
      headers: { cookie },
      payload: {
        filename: "portrait.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 8,
        dataUrl: "data:image/jpeg;base64,iVBORw0KGgo=",
      },
    });

    expect(wrongSize.statusCode).toBe(400);
    expect(wrongSignature.statusCode).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("serves private photo bytes only to the owner until moderation approves them", async () => {
    const store = createMemoryStore();
    const image = Buffer.from("89504e470d0a1a0a", "hex");
    const read = vi.fn().mockResolvedValue({ data: image, mimeType: "image/png" });
    const app = buildServer({
      store,
      otpCode: "123456",
      providers: {
        sms: { sendCode: vi.fn().mockResolvedValue(undefined) },
        objectStorage: {
          upload: vi.fn().mockResolvedValue({ key: "photos/private.png", url: "s3://private/photos/private.png" }),
          read,
          delete: vi.fn().mockResolvedValue(undefined),
        },
      },
    } as Parameters<typeof buildServer>[0]);
    apps.push(app);
    const cookie = await login(app);
    const adminCookie = await login(app, "13900139999");
    const otherCookie = await login(app, "13800138001");
    const ownerId = store.usersByPhone.get("13800138000")!;
    const otherId = store.usersByPhone.get("13800138001")!;
    store.profiles.set(ownerId, {
      userId: ownerId,
      nickname: "照片所有者",
      gender: "女性",
      birthYear: 1978,
      city: "上海",
      district: "徐汇",
      job: "教育",
      maritalStatus: "离异",
      goal: "认真交往",
      introduction: "用于验证照片访问权限。",
      preference: {},
      answers: {},
      profileStatus: "approved",
      visibility: "public",
      updatedAt: new Date().toISOString(),
    });
    store.members.set("photo-owner-member", {
      id: "photo-owner-member",
      nickname: "照片所有者",
      gender: "女性",
      age: 48,
      city: "上海",
      district: "徐汇",
      job: "教育",
      maritalStatus: "离异",
      goal: "认真交往",
      tags: ["生活规律"],
      introduction: "用于验证照片访问权限。",
      photoUrl: "/api/photos/photo/content",
      activeLabel: "近期活跃",
      verified: true,
      ownerUserId: ownerId,
    });
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/me/photos",
      headers: { cookie },
      payload: { filename: "portrait.png", mimeType: "image/png", sizeBytes: 8, dataUrl: "data:image/png;base64,iVBORw0KGgo=" },
    });
    const photoId = uploaded.json().data.photo.id as string;

    const anonymousPending = await app.inject({ method: "GET", url: `/api/photos/${photoId}/content` });
    const ownerPending = await app.inject({ method: "GET", url: `/api/photos/${photoId}/content`, headers: { cookie } });
    const adminPending = await app.inject({ method: "GET", url: `/api/photos/${photoId}/content`, headers: { cookie: adminCookie } });
    const otherPending = await app.inject({ method: "GET", url: `/api/photos/${photoId}/content`, headers: { cookie: otherCookie } });
    store.photos.get(photoId)!.reviewStatus = "approved";
    const anonymousApproved = await app.inject({ method: "GET", url: `/api/photos/${photoId}/content` });
    store.profiles.get(ownerId)!.visibility = "approved_only";
    const anonymousApprovedOnly = await app.inject({ method: "GET", url: `/api/photos/${photoId}/content` });
    const unmatchedApprovedOnly = await app.inject({ method: "GET", url: `/api/photos/${photoId}/content`, headers: { cookie: otherCookie } });
    store.profiles.set(otherId, {
      userId: otherId,
      nickname: "匹配查看者",
      gender: "男性",
      birthYear: 1976,
      city: "上海",
      district: "浦东",
      job: "工程",
      maritalStatus: "离异",
      goal: "认真交往",
      introduction: "希望认真认识彼此。",
      preference: { preferredGender: "女性", minAge: "35", maxAge: "60", region: "不限地区" },
      answers: {},
      profileStatus: "approved",
      visibility: "public",
      updatedAt: new Date().toISOString(),
    });
    const matchedApprovedOnly = await app.inject({ method: "GET", url: `/api/photos/${photoId}/content`, headers: { cookie: otherCookie } });
    store.blocks.set(`${otherId}:${ownerId}`, { id: "photo-block", blockerUserId: otherId, blockedUserId: ownerId, createdAt: new Date().toISOString() });
    const blockedApprovedOnly = await app.inject({ method: "GET", url: `/api/photos/${photoId}/content`, headers: { cookie: otherCookie } });
    store.blocks.clear();
    store.users.get(ownerId)!.status = "suspended";
    const suspendedApproved = await app.inject({ method: "GET", url: `/api/photos/${photoId}/content` });
    store.users.get(ownerId)!.status = "active";
    store.profiles.get(ownerId)!.visibility = "private";
    const privateApproved = await app.inject({ method: "GET", url: `/api/photos/${photoId}/content` });

    expect(anonymousPending.statusCode).toBe(404);
    expect(ownerPending.statusCode).toBe(200);
    expect(adminPending.statusCode).toBe(200);
    expect(otherPending.statusCode).toBe(404);
    expect(ownerPending.headers["content-type"]).toContain("image/png");
    expect(ownerPending.rawPayload).toEqual(image);
    expect(anonymousApproved.statusCode).toBe(200);
    expect(anonymousApprovedOnly.statusCode).toBe(404);
    expect(unmatchedApprovedOnly.statusCode).toBe(404);
    expect(matchedApprovedOnly.statusCode).toBe(200);
    expect(blockedApprovedOnly.statusCode).toBe(404);
    expect(suspendedApproved.statusCode).toBe(404);
    expect(privateApproved.statusCode).toBe(404);
    expect(read).toHaveBeenCalledWith("photos/private.png");
  });

  it("accepts a valid photo payload larger than Fastify's former 1 MiB default", async () => {
    const upload = vi.fn().mockResolvedValue({ key: "photos/large.png", url: "s3://private/photos/large.png" });
    const app = createApp({
      providers: {
        sms: { sendCode: vi.fn().mockResolvedValue(undefined) },
        objectStorage: { upload, read: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) },
      },
    });
    const cookie = await login(app);
    const image = Buffer.alloc(1024 * 1024 + 128);
    Buffer.from("89504e470d0a1a0a", "hex").copy(image);

    const response = await app.inject({
      method: "POST",
      url: "/api/me/photos",
      headers: { cookie },
      payload: {
        filename: "large.png",
        mimeType: "image/png",
        sizeBytes: image.length,
        dataUrl: `data:image/png;base64,${image.toString("base64")}`,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ data: image }));
  });

  it("uses only the avatar provider result for an AI reply", async () => {
    const reply = vi.fn().mockResolvedValue("这是模型基于授权资料生成的回答。");
    const app = createApp({
      providers: {
        sms: { sendCode: vi.fn().mockResolvedValue(undefined) },
        avatarModel: { reply },
      },
    });
    const cookie = await login(app);
    const sessionResponse = await app.inject({
      method: "POST",
      url: "/api/avatar-sessions",
      headers: { cookie },
      payload: { memberId: "lin-wanqing" },
    });
    const sessionId = sessionResponse.json().data.session.id;

    const response = await app.inject({
      method: "POST",
      url: `/api/avatar-sessions/${sessionId}/messages`,
      headers: { cookie },
      payload: { text: "你平时周末喜欢做什么？" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.messages[1].text).toBe("这是模型基于授权资料生成的回答。");
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      question: "你平时周末喜欢做什么？",
      approvedFacts: expect.any(Array),
      expectations: expect.any(Array),
      boundaries: expect.any(Array),
    }));
    expect(reply.mock.calls[0][0]).not.toHaveProperty("phone");
  });

  it("persists the user message but not topic progress when the avatar model fails", async () => {
    const store = createMemoryStore();
    const app = buildServer({
      store,
      otpCode: "123456",
      providers: {
        sms: { sendCode: vi.fn().mockResolvedValue(undefined) },
        avatarModel: { reply: vi.fn().mockRejectedValue(new Error("model timeout")) },
      },
    } as Parameters<typeof buildServer>[0]);
    apps.push(app);
    const cookie = await login(app);
    const sessionResponse = await app.inject({
      method: "POST",
      url: "/api/avatar-sessions",
      headers: { cookie },
      payload: { memberId: "lin-wanqing" },
    });
    const sessionId = sessionResponse.json().data.session.id;

    const response = await app.inject({
      method: "POST",
      url: `/api/avatar-sessions/${sessionId}/messages`,
      headers: { cookie },
      payload: { text: "你平时周末喜欢做什么？" },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: { code: "AVATAR_MODEL_UNAVAILABLE" } });
    expect([...store.avatarMessages.values()].filter((message) => message.sessionId === sessionId)).toEqual([
      expect.objectContaining({ sender: "user", text: "你平时周末喜欢做什么？" }),
    ]);
    expect(response.json().data).toMatchObject({
      message: { sender: "user" },
      failureTask: { sessionId, status: "pending", attempts: 1 },
    });
    expect(store.avatarSessions.get(sessionId)?.completedTopics).toEqual([]);
  });
});
