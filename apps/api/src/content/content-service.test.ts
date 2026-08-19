import { describe, expect, it } from "vitest";
import {
  ContentActivityService,
  ContentDomainError,
  type ContentActor,
  type CreateContentInput,
} from "./index.js";

const NOW = Date.parse("2026-08-14T00:00:00.000Z");
const admin: ContentActor = { userId: "admin-1", role: "admin" };
const memberA: ContentActor = { userId: "member-a", role: "member" };
const memberB: ContentActor = { userId: "member-b", role: "member" };

function buildService() {
  let nextId = 1;
  return new ContentActivityService({
    now: () => NOW,
    createId: (prefix) => `${prefix}-${nextId++}`,
  });
}

function article(overrides: Partial<CreateContentInput> = {}): CreateContentInput {
  return {
    type: "article",
    title: "中年相处中的真诚沟通",
    summary: "从日常表达开始，建立稳定而坦诚的关系。",
    body: "认真倾听、清楚表达，也尊重彼此的生活节奏。",
    tags: ["沟通", "关系"],
    ...overrides,
  };
}

function event(overrides: Partial<CreateContentInput> = {}): CreateContentInput {
  return {
    type: "event",
    title: "周末城市漫步",
    summary: "在轻松、安全的线下活动中认识新朋友。",
    body: "集合后由领队带领完成两小时城市漫步。",
    tags: ["上海", "线下活动"],
    event: {
      startsAt: NOW + 86_400_000,
      endsAt: NOW + 93_600_000,
      location: "上海市徐汇区",
      capacity: 2,
    },
    ...overrides,
  };
}

function expectDomainError(action: () => unknown, code: string, statusCode: number) {
  try {
    action();
    throw new Error("预期操作抛出领域错误");
  } catch (error) {
    expect(error).toBeInstanceOf(ContentDomainError);
    expect(error).toMatchObject({ code, statusCode });
    expect((error as Error).message).toMatch(/[\u4e00-\u9fff]/);
  }
}

describe("内容后台管理", () => {
  it("仅管理员可创建草稿，且创建结果不会被调用方篡改", () => {
    const service = buildService();

    expectDomainError(
      () => service.createDraft(memberA, article()),
      "FORBIDDEN",
      403,
    );

    const draft = service.createDraft(admin, article());
    expect(draft).toMatchObject({
      id: "content-1",
      status: "draft",
      authorId: "admin-1",
      likeCount: 0,
      registrationCount: 0,
    });

    draft.tags.push("被篡改");
    expect(service.getAdminContent(admin, draft.id).tags).toEqual(["沟通", "关系"]);
  });

  it("校验内容类型、文本、标签与活动字段，并返回中文错误", () => {
    const service = buildService();

    expectDomainError(
      () => service.createDraft(admin, article({ title: " " })),
      "INVALID_CONTENT_INPUT",
      400,
    );
    expectDomainError(
      () => service.createDraft(admin, article({ tags: Array.from({ length: 11 }, (_, index) => `标签${index}`) })),
      "INVALID_CONTENT_INPUT",
      400,
    );
    expectDomainError(
      () => service.createDraft(admin, event({ event: undefined })),
      "INVALID_CONTENT_INPUT",
      400,
    );
    expectDomainError(
      () => service.createDraft(admin, event({
        event: {
          startsAt: NOW + 10_000,
          endsAt: NOW + 5_000,
          location: "上海",
          capacity: 0,
        },
      })),
      "INVALID_CONTENT_INPUT",
      400,
    );
  });

  it("支持发布、下线和重新发布，并限制管理员权限与非法状态", () => {
    const service = buildService();
    const draft = service.createDraft(admin, article());

    expectDomainError(() => service.publish(memberA, draft.id), "FORBIDDEN", 403);
    expect(service.publish(admin, draft.id)).toMatchObject({ status: "published", publishedAt: NOW });
    expect(service.publish(admin, draft.id)).toMatchObject({ status: "published" });

    expect(service.takeOffline(admin, draft.id)).toMatchObject({ status: "offline" });
    expectDomainError(
      () => service.takeOffline(admin, draft.id),
      "INVALID_CONTENT_STATE",
      409,
    );
    expect(service.publish(admin, draft.id)).toMatchObject({ status: "published" });
    expectDomainError(() => service.publish(admin, "missing"), "CONTENT_NOT_FOUND", 404);
  });
});

describe("公开内容查询", () => {
  it("列表和详情仅暴露已发布内容，并支持类型、标签、关键词与活动时间筛选", () => {
    const service = buildService();
    const publishedArticle = service.createDraft(admin, article());
    const draftArticle = service.createDraft(admin, article({ title: "尚未发布的文章" }));
    const upcomingEvent = service.createDraft(admin, event());
    const endedEvent = service.createDraft(admin, event({
      title: "已经结束的读书会",
      event: {
        startsAt: NOW - 7_200_000,
        endsAt: NOW - 3_600_000,
        location: "上海市静安区",
        capacity: 10,
      },
    }));
    service.publish(admin, publishedArticle.id);
    service.publish(admin, upcomingEvent.id);
    service.publish(admin, endedEvent.id);

    expect(service.listPublicContent().items.map((item) => item.id)).toEqual([
      endedEvent.id,
      upcomingEvent.id,
      publishedArticle.id,
    ]);
    expect(service.listPublicContent({ type: "article" }).items.map((item) => item.id)).toEqual([
      publishedArticle.id,
    ]);
    expect(service.listPublicContent({ tag: "上海", query: "漫步", upcomingOnly: true }).items.map((item) => item.id))
      .toEqual([upcomingEvent.id]);
    expect(service.getPublicContent(publishedArticle.id).body).toContain("认真倾听");
    expectDomainError(() => service.getPublicContent(draftArticle.id), "CONTENT_NOT_FOUND", 404);
  });

  it("支持稳定分页并拒绝非法筛选参数", () => {
    const service = buildService();
    for (let index = 0; index < 3; index += 1) {
      const draft = service.createDraft(admin, article({ title: `关系课堂第${index + 1}期` }));
      service.publish(admin, draft.id);
    }

    const firstPage = service.listPublicContent({ page: 1, pageSize: 2 });
    const secondPage = service.listPublicContent({ page: 2, pageSize: 2 });
    expect(firstPage).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(secondPage.items).toHaveLength(1);

    expectDomainError(
      () => service.listPublicContent({ type: "video" as "article", pageSize: 101 }),
      "INVALID_CONTENT_FILTER",
      400,
    );
  });
});

describe("内容点赞", () => {
  it("点赞和取消均幂等，并实时返回准确计数", () => {
    const service = buildService();
    const content = service.createDraft(admin, article());
    service.publish(admin, content.id);

    expect(service.like(memberA, content.id)).toEqual({ liked: true, changed: true, likeCount: 1 });
    expect(service.like(memberA, content.id)).toEqual({ liked: true, changed: false, likeCount: 1 });
    expect(service.like(memberB, content.id)).toEqual({ liked: true, changed: true, likeCount: 2 });
    expect(service.unlike(memberA, content.id)).toEqual({ liked: false, changed: true, likeCount: 1 });
    expect(service.unlike(memberA, content.id)).toEqual({ liked: false, changed: false, likeCount: 1 });
    expect(service.getPublicContent(content.id).likeCount).toBe(1);
  });

  it("拒绝无效用户、缺失内容和未发布内容", () => {
    const service = buildService();
    const draft = service.createDraft(admin, article());

    expectDomainError(
      () => service.like({ userId: " ", role: "member" }, draft.id),
      "UNAUTHENTICATED",
      401,
    );
    expectDomainError(() => service.like(memberA, draft.id), "CONTENT_NOT_FOUND", 404);
    expectDomainError(() => service.like(memberA, "missing"), "CONTENT_NOT_FOUND", 404);
  });
});

describe("活动报名", () => {
  it("支持报名和幂等取消，取消后释放容量并允许重新报名", () => {
    const service = buildService();
    const activity = service.createDraft(admin, event());
    service.publish(admin, activity.id);

    const first = service.registerForEvent(memberA, activity.id);
    expect(first).toMatchObject({
      changed: true,
      registration: { contentId: activity.id, userId: "member-a", status: "registered" },
      registrationCount: 1,
      remainingCapacity: 1,
    });
    expectDomainError(
      () => service.registerForEvent(memberA, activity.id),
      "ALREADY_REGISTERED",
      409,
    );
    expect(service.cancelEventRegistration(memberA, activity.id)).toMatchObject({
      changed: true,
      registration: { status: "cancelled", cancelledAt: NOW },
      registrationCount: 0,
      remainingCapacity: 2,
    });
    expect(service.cancelEventRegistration(memberA, activity.id)).toMatchObject({
      changed: false,
      registration: { status: "cancelled" },
    });
    expect(service.registerForEvent(memberA, activity.id)).toMatchObject({
      changed: true,
      registration: { status: "registered" },
      registrationCount: 1,
    });
  });

  it("执行容量限制，并拒绝文章、已结束或未发布活动", () => {
    const service = buildService();
    const activity = service.createDraft(admin, event({
      event: {
        startsAt: NOW + 86_400_000,
        endsAt: NOW + 93_600_000,
        location: "上海市徐汇区",
        capacity: 1,
      },
    }));
    const articleDraft = service.createDraft(admin, article());
    const endedActivity = service.createDraft(admin, event({
      title: "已经结束的活动",
      event: {
        startsAt: NOW - 7_200_000,
        endsAt: NOW - 3_600_000,
        location: "上海市静安区",
        capacity: 10,
      },
    }));
    service.publish(admin, activity.id);
    service.publish(admin, articleDraft.id);
    service.publish(admin, endedActivity.id);

    service.registerForEvent(memberA, activity.id);
    expectDomainError(() => service.registerForEvent(memberB, activity.id), "EVENT_FULL", 409);
    expectDomainError(() => service.registerForEvent(memberA, articleDraft.id), "NOT_AN_EVENT", 400);
    expectDomainError(() => service.registerForEvent(memberA, endedActivity.id), "EVENT_ENDED", 409);

    const offlineActivity = service.createDraft(admin, event({ title: "未发布活动" }));
    expectDomainError(
      () => service.registerForEvent(memberA, offlineActivity.id),
      "CONTENT_NOT_FOUND",
      404,
    );
  });

  it("只列出当前用户仍然有效的活动报名", () => {
    const service = buildService();
    const firstActivity = service.createDraft(admin, event({ title: "城市漫步" }));
    const secondActivity = service.createDraft(admin, event({ title: "周末茶话会" }));
    service.publish(admin, firstActivity.id);
    service.publish(admin, secondActivity.id);
    service.registerForEvent(memberA, firstActivity.id);
    service.registerForEvent(memberA, secondActivity.id);
    service.registerForEvent(memberB, firstActivity.id);
    service.cancelEventRegistration(memberA, secondActivity.id);

    expect(service.listMyEventRegistrations(memberA)).toEqual([
      expect.objectContaining({
        registration: expect.objectContaining({ userId: memberA.userId, contentId: firstActivity.id, status: "registered" }),
        content: expect.objectContaining({ id: firstActivity.id, title: "城市漫步" }),
      }),
    ]);
  });
});

describe("内容状态恢复", () => {
  it("恢复内容、点赞和报名后继续保持人数与幂等状态", () => {
    const original = buildService();
    const activity = original.createDraft(admin, event());
    original.publish(admin, activity.id);
    original.like(memberA, activity.id);
    original.registerForEvent(memberA, activity.id);

    const restored = buildService();
    restored.restoreState(original.exportState());

    expect(restored.getPublicContent(activity.id)).toMatchObject({
      likeCount: 1,
      registrationCount: 1,
      event: { remainingCapacity: 1 },
    });
    expect(restored.like(memberA, activity.id)).toEqual({
      liked: true,
      changed: false,
      likeCount: 1,
    });
    expectDomainError(
      () => restored.registerForEvent(memberA, activity.id),
      "ALREADY_REGISTERED",
      409,
    );
  });
});
