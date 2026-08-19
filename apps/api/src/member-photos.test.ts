import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { createMemoryStore } from "./store/index.js";
import type { StoredPhoto } from "./store/types.js";

describe("会员公开照片", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  it("只公开已审核照片，并把主照片排在第一张", async () => {
    const store = createMemoryStore([]);
    const app = buildServer({ store, otpCode: "123456" });
    apps.push(app);

    await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone: "13800138000" } });
    const login = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone: "13800138000", code: "123456" } });
    const cookie = login.cookies.find((item) => item.name === "refresh_token");
    const ownerCookie = `${cookie?.name}=${cookie?.value}`;
    const userId = store.usersByPhone.get("13800138000")!;
    const now = "2026-08-14T08:00:00.000Z";

    store.profiles.set(userId, {
      userId,
      nickname: "多照片用户",
      gender: "女性",
      birthYear: 1980,
      city: "杭州",
      district: "西湖",
      job: "教师",
      maritalStatus: "离异",
      goal: "认真交往",
      introduction: "希望认真了解彼此。",
      preference: {},
      answers: {},
      profileStatus: "approved",
      visibility: "public",
      updatedAt: now,
    });
    store.avatarProfiles.set(userId, {
      userId,
      version: 1,
      approvedFacts: [],
      relationshipExpectations: [],
      boundaries: [],
      unknownResponse: "建议真人确认。",
      status: "enabled",
      generatedAt: now,
      enabledAt: now,
    });

    const photos: StoredPhoto[] = [
      { id: "approved-older", userId, filename: "older.png", objectKey: "older.png", url: "/photos/older.png", mimeType: "image/png", sizeBytes: 8, isPrimary: false, reviewStatus: "approved", reviewReason: null, createdAt: "2026-08-12T08:00:00.000Z", updatedAt: now },
      { id: "approved-primary", userId, filename: "primary.png", objectKey: "primary.png", url: "/photos/primary.png", mimeType: "image/png", sizeBytes: 8, isPrimary: true, reviewStatus: "approved", reviewReason: null, createdAt: "2026-08-14T08:00:00.000Z", updatedAt: now },
      { id: "pending", userId, filename: "pending.png", objectKey: "pending.png", url: "/photos/pending.png", mimeType: "image/png", sizeBytes: 8, isPrimary: false, reviewStatus: "pending", reviewReason: null, createdAt: now, updatedAt: now },
      { id: "rejected", userId, filename: "rejected.png", objectKey: "rejected.png", url: "/photos/rejected.png", mimeType: "image/png", sizeBytes: 8, isPrimary: false, reviewStatus: "rejected", reviewReason: "不符合要求", createdAt: now, updatedAt: now },
    ];
    for (const photo of photos) store.photos.set(photo.id, photo);

    const synced = await app.inject({ method: "POST", url: "/api/me/photos/approved-primary/primary", headers: { cookie: ownerCookie } });
    expect(synced.statusCode).toBe(200);

    const response = await app.inject({ method: "GET", url: "/api/members" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toEqual([
      expect.objectContaining({
        nickname: "多照片用户",
        photoUrl: "/photos/primary.png",
        photoUrls: ["/photos/primary.png", "/photos/older.png"],
      }),
    ]);
    expect(JSON.stringify(response.json())).not.toContain("pending.png");
    expect(JSON.stringify(response.json())).not.toContain("rejected.png");
  });
});
