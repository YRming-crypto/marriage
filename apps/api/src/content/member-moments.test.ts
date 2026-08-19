import { describe, expect, it } from "vitest";
import { ContentActivityService } from "./service.js";

const member = { userId: "member-1", role: "member" as const };
const anotherMember = { userId: "member-2", role: "member" as const };
const admin = { userId: "admin-1", role: "admin" as const };

describe("member moments and complete content management", () => {
  it("lets a member submit a moment for review before it becomes public", () => {
    const service = new ContentActivityService({ now: () => 1_000 });
    const moment = service.createMemberMoment(member, {
      body: "周末去西湖边散步，天气很好。",
      imageUrls: ["/photos/west-lake-1.jpg", "/photos/west-lake-2.jpg"],
    });

    expect(moment).toMatchObject({
      type: "article",
      status: "draft",
      authorId: member.userId,
      tags: ["动态"],
      imageUrls: ["/photos/west-lake-1.jpg", "/photos/west-lake-2.jpg"],
    });
    expect(service.listMyContent(member).map((item) => item.id)).toEqual([moment.id]);
    expect(service.listPublicContent({ type: "article", tag: "动态" }).items).toEqual([]);

    const published = service.publish(admin, moment.id);
    expect(published.status).toBe("published");
    expect(service.listPublicContent({ type: "article", tag: "动态" }).items[0]?.id).toBe(moment.id);
  });

  it("allows only the author to delete a member moment", () => {
    const service = new ContentActivityService();
    const moment = service.createMemberMoment(member, { body: "一条准备删除的动态。", imageUrls: [] });

    expect(() => service.deleteOwnContent(anotherMember, moment.id)).toThrowError("只能删除自己发布的内容");
    expect(service.deleteOwnContent(member, moment.id)).toBe(true);
    expect(service.listMyContent(member)).toEqual([]);
  });

  it("prevents administrators from publishing a moment while its images are uploading", () => {
    const service = new ContentActivityService({ now: () => 2_000 });
    const reserved = service.reserveMemberMoment(member, {
      body: "图片上传完成前不能公开的动态。",
      imageUrls: ["/api/content-images/cGVuZGluZw"],
    });

    expect(reserved.status).toBe("offline");
    expect(() => service.publish(admin, reserved.id)).toThrowError("动态图片仍在上传或清理中");

    const completed = service.completeMemberMomentUpload(member, reserved.id);
    expect(completed).toMatchObject({ status: "draft", tags: ["动态"] });
    expect(service.publish(admin, reserved.id).status).toBe("published");
  });

  it("supports administrator editing and deletion", () => {
    const service = new ContentActivityService();
    const draft = service.createDraft(admin, {
      type: "article",
      title: "旧标题",
      summary: "旧摘要",
      body: "旧正文",
      tags: ["婚恋课堂"],
    });

    const updated = service.updateContent(admin, draft.id, {
      title: "新标题",
      summary: "新摘要",
      body: "新正文",
      tags: ["婚恋课堂", "沟通"],
    });
    expect(updated).toMatchObject({ title: "新标题", summary: "新摘要", body: "新正文" });
    expect(service.deleteContent(admin, draft.id)).toBe(true);
    expect(service.listAdminContent(admin)).toEqual([]);
  });

  it("rejects moments with more than nine images", () => {
    const service = new ContentActivityService();
    expect(() => service.createMemberMoment(member, {
      body: "图片太多的动态。",
      imageUrls: Array.from({ length: 10 }, (_, index) => `/photos/${index}.jpg`),
    })).toThrowError("动态最多上传 9 张图片");
  });

  it("removes moments authored by a deleted member and returns them for object cleanup", () => {
    const service = new ContentActivityService();
    const owned = service.createMemberMoment(member, {
      body: "账号注销后不应继续公开的动态。",
      imageUrls: ["/api/content-images/bW9tZW50LWltYWdl"],
    });
    service.publish(admin, owned.id);
    const survivor = service.createDraft(admin, {
      type: "article",
      title: "保留内容",
      summary: "保留摘要",
      body: "保留正文",
    });
    service.publish(admin, survivor.id);
    service.like(member, survivor.id);

    const removed = service.removeUserActivity(member.userId);

    expect(removed).toEqual([expect.objectContaining({ id: owned.id, imageUrls: owned.imageUrls })]);
    expect(service.listPublicContent().items.map((item) => item.id)).toEqual([survivor.id]);
    expect(service.getPublicContent(survivor.id).likeCount).toBe(0);
  });
});
