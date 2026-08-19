import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { ContentActivityService } from "./content/index.js";
import { createMemoryStore } from "./store/index.js";

describe("内容与活动 HTTP 接口", () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];
  afterEach(async () => { await Promise.all(apps.map((app) => app.close())); apps.length = 0; });

  async function setup(objectStorage?: { upload: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }) {
    const contentService = new ContentActivityService({ now: () => Date.parse("2026-08-14T00:00:00Z") });
    const store = createMemoryStore();
    const app = buildServer({ store, otpCode: "123456", contentService, adminPhones: ["13900139999"], ...(objectStorage ? { providers: { objectStorage } } : {}) });
    apps.push(app);
    async function login(phone: string) {
      await app.inject({ method: "POST", url: "/api/auth/otp/request", payload: { phone } });
      const response = await app.inject({ method: "POST", url: "/api/auth/otp/verify", payload: { phone, code: "123456" } });
      return `refresh_token=${response.cookies.find((item) => item.name === "refresh_token")?.value}`;
    }
    return { app, store, user: await login("13800138000"), admin: await login("13900139999") };
  }

  function objectKeyFromImageUrl(url: string) {
    return Buffer.from(url.split("/").at(-1)!, "base64url").toString("utf8");
  }

  it("管理员发布内容后公开列表和详情可见", async () => {
    const { app, admin } = await setup();
    const created = await app.inject({ method: "POST", url: "/api/admin/content", headers: { cookie: admin }, payload: { type: "article", title: "第一次见面的安全准备", summary: "选择公共场所并告知亲友。", body: "第一次见面建议选择交通方便、人流稳定的公共场所，并提前把行程告诉亲友。", tags: ["安全", "见面"] } });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.content.id as string;
    await app.inject({ method: "POST", url: `/api/admin/content/${id}/publish`, headers: { cookie: admin } });
    const list = await app.inject({ method: "GET", url: "/api/content?type=article" });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.items).toEqual([expect.objectContaining({ id, title: "第一次见面的安全准备" })]);
    const detail = await app.inject({ method: "GET", url: `/api/content/${id}` });
    expect(detail.statusCode).toBe(200);
  });

  it("普通用户可点赞和报名活动，管理员接口拒绝普通用户", async () => {
    const { app, admin, user } = await setup();
    const created = await app.inject({ method: "POST", url: "/api/admin/content", headers: { cookie: admin }, payload: { type: "event", title: "周末公园漫步", summary: "轻松认识同城朋友。", body: "由工作人员带队，在公共公园进行两小时轻松步行和交流。", tags: ["上海", "户外"], event: { startsAt: Date.parse("2026-08-20T02:00:00Z"), endsAt: Date.parse("2026-08-20T04:00:00Z"), location: "上海世纪公园", capacity: 20 } } });
    const id = created.json().data.content.id as string;
    await app.inject({ method: "POST", url: `/api/admin/content/${id}/publish`, headers: { cookie: admin } });
    const liked = await app.inject({ method: "POST", url: `/api/content/${id}/like`, headers: { cookie: user } });
    const registered = await app.inject({ method: "POST", url: `/api/content/${id}/register`, headers: { cookie: user } });
    const mine = await app.inject({ method: "GET", url: "/api/me/event-registrations", headers: { cookie: user } });
    const anonymous = await app.inject({ method: "GET", url: "/api/me/event-registrations" });
    expect(liked.statusCode).toBe(200);
    expect(registered.statusCode).toBe(201);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data.items).toEqual([
      expect.objectContaining({
        registration: expect.objectContaining({ contentId: id, status: "registered" }),
        content: expect.objectContaining({ id, title: "周末公园漫步" }),
      }),
    ]);
    expect(anonymous.statusCode).toBe(401);
    const forbidden = await app.inject({ method: "POST", url: "/api/admin/content", headers: { cookie: user }, payload: {} });
    expect(forbidden.statusCode).toBe(403);
  });

  it("会员动态经过提交、后台编辑发布和删除的完整流程", async () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    const objectStorage = {
      upload: vi.fn().mockImplementation(async (request: { objectKey?: string }) => ({ key: request.objectKey!, url: "ignored" })),
      read: vi.fn().mockResolvedValue({ data: image, mimeType: "image/png" }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const { app, store, admin, user } = await setup(objectStorage);
    const created = await app.inject({
      method: "POST",
      url: "/api/me/moments",
      headers: { cookie: user },
      payload: {
        body: "今天在公园散步，拍下了傍晚的湖面。",
        images: [{ filename: "lake.png", mimeType: "image/png", sizeBytes: image.length, dataUrl: `data:image/png;base64,${image.toString("base64")}` }],
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.content.id as string;
    const imageUrl = created.json().data.content.imageUrls[0] as string;
    const momentObjectKey = objectKeyFromImageUrl(imageUrl);
    expect(imageUrl).toMatch(/^\/api\/content-images\//);
    expect(store.photos.size).toBe(0);
    expect(objectStorage.upload).toHaveBeenCalledWith(expect.objectContaining({ userId: expect.any(String), filename: "lake.png", purpose: "moment-image", data: image }));

    expect((await app.inject({ method: "GET", url: imageUrl })).statusCode).toBe(404);
    const privateImage = await app.inject({ method: "GET", url: imageUrl, headers: { cookie: user } });
    expect(privateImage.statusCode).toBe(200);
    expect(privateImage.headers["cache-control"]).toBe("private, no-store");

    const mine = await app.inject({ method: "GET", url: "/api/me/content", headers: { cookie: user } });
    expect(mine.json().data.items).toEqual([expect.objectContaining({ id, status: "draft", imageUrls: [imageUrl] })]);
    expect((await app.inject({ method: "GET", url: "/api/content?tag=%E5%8A%A8%E6%80%81" })).json().data.items).toEqual([]);

    const updated = await app.inject({ method: "PATCH", url: `/api/admin/content/${id}`, headers: { cookie: admin }, payload: { title: "傍晚湖边散步" } });
    expect(updated.json().data.content.title).toBe("傍晚湖边散步");
    expect((await app.inject({ method: "POST", url: `/api/admin/content/${id}/publish`, headers: { cookie: admin } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/content?tag=%E5%8A%A8%E6%80%81" })).json().data.items[0]).toMatchObject({ id, title: "傍晚湖边散步" });
    const publicImage = await app.inject({ method: "GET", url: imageUrl });
    expect(publicImage.statusCode).toBe(200);
    expect(publicImage.headers["cache-control"]).toBe("private, no-store");

    expect((await app.inject({ method: "DELETE", url: `/api/me/content/${id}`, headers: { cookie: user } })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/me/content", headers: { cookie: user } })).json().data.items).toEqual([]);
    expect(objectStorage.delete).toHaveBeenCalledWith(momentObjectKey);
    expect((await app.inject({ method: "GET", url: imageUrl })).statusCode).toBe(404);
  });

  it("动态图片批量上传失败时回滚本次对象且不创建动态", async () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    const objectStorage = {
      upload: vi.fn()
        .mockImplementationOnce(async (request: { objectKey?: string }) => ({ key: request.objectKey!, url: "ignored" }))
        .mockRejectedValueOnce(new Error("storage unavailable")),
      read: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const { app, user } = await setup(objectStorage);
    const encoded = `data:image/png;base64,${image.toString("base64")}`;

    const response = await app.inject({
      method: "POST",
      url: "/api/me/moments",
      headers: { cookie: user },
      payload: { body: "这条动态不应留下半成品。", images: [
        { filename: "first.png", mimeType: "image/png", sizeBytes: image.length, dataUrl: encoded },
        { filename: "second.png", mimeType: "image/png", sizeBytes: image.length, dataUrl: encoded },
      ] },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: { code: "MOMENT_IMAGE_STORAGE_FAILED" } });
    expect(objectStorage.delete).toHaveBeenCalledTimes(2);
    expect(objectStorage.delete.mock.calls.every(([key]) => String(key).startsWith("moments/"))).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/me/content", headers: { cookie: user } })).json().data.items).toEqual([]);
  });

  it("管理员删除会员动态时同步删除动态图片对象", async () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    const objectStorage = {
      upload: vi.fn().mockImplementation(async (request: { objectKey?: string }) => ({ key: request.objectKey!, url: "ignored" })),
      read: vi.fn().mockResolvedValue({ data: image, mimeType: "image/png" }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const { app, user, admin } = await setup(objectStorage);
    const created = await app.inject({
      method: "POST",
      url: "/api/me/moments",
      headers: { cookie: user },
      payload: { body: "由管理员删除的动态。", images: [{ filename: "moment.png", mimeType: "image/png", sizeBytes: image.length, dataUrl: `data:image/png;base64,${image.toString("base64")}` }] },
    });
    const contentId = created.json().data.content.id as string;
    const objectKey = objectKeyFromImageUrl(created.json().data.content.imageUrls[0] as string);

    const deleted = await app.inject({ method: "DELETE", url: `/api/admin/content/${contentId}`, headers: { cookie: admin } });

    expect(deleted.statusCode).toBe(204);
    expect(objectStorage.delete).toHaveBeenCalledWith(objectKey);
    expect((await app.inject({ method: "GET", url: "/api/admin/content", headers: { cookie: admin } })).json().data.items).toEqual([]);
  });

  it("对象存储删除失败时保留动态记录，以便重试清理", async () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    let cleanupAttempt = 0;
    const objectStorage = {
      upload: vi.fn().mockImplementation(async (request: { objectKey?: string }) => ({ key: request.objectKey!, url: "ignored" })),
      read: vi.fn().mockResolvedValue({ data: image, mimeType: "image/png" }),
      delete: vi.fn().mockImplementation(async () => {
        cleanupAttempt += 1;
        if (cleanupAttempt === 2) throw new Error("storage unavailable");
      }),
    };
    const { app, user } = await setup(objectStorage);
    const created = await app.inject({
      method: "POST",
      url: "/api/me/moments",
      headers: { cookie: user },
      payload: {
        body: "删除失败后仍可重试的动态。",
        images: [
          { filename: "retry-1.png", mimeType: "image/png", sizeBytes: image.length, dataUrl: `data:image/png;base64,${image.toString("base64")}` },
          { filename: "retry-2.png", mimeType: "image/png", sizeBytes: image.length, dataUrl: `data:image/png;base64,${image.toString("base64")}` },
        ],
      },
    });
    const contentId = created.json().data.content.id as string;
    const objectKeys = (created.json().data.content.imageUrls as string[]).map(objectKeyFromImageUrl);

    const failed = await app.inject({ method: "DELETE", url: `/api/me/content/${contentId}`, headers: { cookie: user } });
    expect(failed.statusCode).toBe(500);
    expect((await app.inject({ method: "GET", url: "/api/me/content", headers: { cookie: user } })).json().data.items)
      .toEqual([expect.objectContaining({ id: contentId, status: "offline" })]);
    expect((await app.inject({ method: "GET", url: "/api/content?tag=%E5%8A%A8%E6%80%81" })).json().data.items).toEqual([]);

    const retried = await app.inject({ method: "DELETE", url: `/api/me/content/${contentId}`, headers: { cookie: user } });
    expect(retried.statusCode).toBe(204);
    expect(objectStorage.delete).toHaveBeenCalledTimes(4);
    expect(objectStorage.delete.mock.calls.slice(-2).map(([key]) => key)).toEqual(objectKeys);
    expect((await app.inject({ method: "GET", url: "/api/me/content", headers: { cookie: user } })).json().data.items).toEqual([]);
  });

  it("上传回滚清理失败时保留不可公开的索引记录供后续删除", async () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    let cleanupAvailable = false;
    const objectStorage = {
      upload: vi.fn()
        .mockImplementationOnce(async (request: { objectKey?: string }) => ({ key: request.objectKey!, url: "ignored" }))
        .mockRejectedValueOnce(new Error("upload unavailable")),
      read: vi.fn().mockResolvedValue({ data: image, mimeType: "image/png" }),
      delete: vi.fn().mockImplementation(async () => {
        if (!cleanupAvailable) throw new Error("delete unavailable");
      }),
    };
    const { app, user } = await setup(objectStorage);
    const encoded = `data:image/png;base64,${image.toString("base64")}`;

    const response = await app.inject({
      method: "POST",
      url: "/api/me/moments",
      headers: { cookie: user },
      payload: { body: "上传失败但仍可安全清理的动态。", images: [
        { filename: "first.png", mimeType: "image/png", sizeBytes: image.length, dataUrl: encoded },
        { filename: "second.png", mimeType: "image/png", sizeBytes: image.length, dataUrl: encoded },
      ] },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "MOMENT_IMAGE_CLEANUP_PENDING" } });
    const pending = (await app.inject({ method: "GET", url: "/api/me/content", headers: { cookie: user } })).json().data.items[0];
    expect(pending).toMatchObject({ status: "offline", imageUrls: [expect.stringMatching(/^\/api\/content-images\//), expect.stringMatching(/^\/api\/content-images\//)] });
    expect((await app.inject({ method: "GET", url: pending.imageUrls[0] })).statusCode).toBe(404);

    cleanupAvailable = true;
    expect((await app.inject({ method: "DELETE", url: `/api/me/content/${pending.id}`, headers: { cookie: user } })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/me/content", headers: { cookie: user } })).json().data.items).toEqual([]);
  });
});
