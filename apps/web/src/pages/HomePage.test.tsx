import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";

const member = { id: "member-1", userId: "user-1", nickname: "林婉清", gender: "女性", age: 45, city: "上海", district: "徐汇", job: "教育", maritalStatus: "离异", goal: "认真交往", tags: ["阅读"], introduction: "愿意认真了解。", photoUrl: "/images/member-lin-v2.jpg", activeLabel: "今天活跃", verified: true };

const now = Date.parse("2026-08-14T02:00:00Z");
const contentItems = {
  moment: {
    id: "moment-live-1", type: "article", status: "published", title: "清晨沿江散步", summary: "天气凉快，走走很舒服。", body: "天气凉快，走走很舒服。", tags: ["动态"], coverImageUrl: "/images/moment-live.jpg", authorId: "member-1", likeCount: 3, registrationCount: 0, event: null, createdAt: now, updatedAt: now, publishedAt: now, offlineAt: null,
  },
  activity: {
    id: "event-live-1", type: "event", status: "published", title: "周末滨江漫步", summary: "在公共场所轻松认识同城朋友。", body: "由工作人员带队。", tags: ["上海", "户外"], coverImageUrl: null, authorId: "admin-1", likeCount: 5, registrationCount: 14, event: { startsAt: Date.parse("2026-08-20T02:00:00Z"), endsAt: Date.parse("2026-08-20T04:00:00Z"), location: "上海市徐汇区滨江步道", capacity: 20, remainingCapacity: 6 }, createdAt: now, updatedAt: now, publishedAt: now, offlineAt: null,
  },
  story: {
    id: "story-live-1", type: "article", status: "published", title: "从一顿家常饭开始了解", summary: "两个人在认真沟通中逐渐确认心意。", body: "先了解，再决定。", tags: ["幸福案例"], coverImageUrl: "/images/story-live.jpg", authorId: "admin-1", likeCount: 8, registrationCount: 0, event: null, createdAt: now, updatedAt: now, publishedAt: now, offlineAt: null,
  },
  classroom: {
    id: "classroom-live-1", type: "article", status: "published", title: "第一次见面怎样更安心", summary: "选择公共场所并告诉家人行程。", body: "选择公共场所并告诉家人行程。", tags: ["婚恋课堂", "见面"], coverImageUrl: null, authorId: "admin-1", likeCount: 2, registrationCount: 0, event: null, createdAt: now, updatedAt: now, publishedAt: now, offlineAt: null,
  },
} as const;

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function contentFor(url: URL) {
  if (url.searchParams.get("type") === "event") return [contentItems.activity];
  if (url.searchParams.get("tag") === "动态") return [contentItems.moment];
  if (url.searchParams.get("tag") === "幸福案例") return [contentItems.story];
  if (url.searchParams.get("tag") === "婚恋课堂") return [contentItems.classroom];
  return [];
}

function installApiMock(options: { emptyContent?: boolean; failedTag?: string } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/members") return jsonResponse({ items: [member], total: 1 });
    if (url.pathname === "/api/content") {
      if (url.searchParams.get("tag") === options.failedTag) throw new Error("offline");
      const items = options.emptyContent ? [] : contentFor(url);
      return jsonResponse({ items, page: 1, pageSize: Number(url.searchParams.get("pageSize")), total: items.length, totalPages: items.length ? 1 : 0 });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

beforeEach(() => {
  installApiMock();
});

describe("婚恋门户首页", () => {
  it("首屏提供清晰的找对象入口和信任信息", () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "认真认识，安心交往" })).toBeVisible();
    expect(screen.getByRole("link", { name: /寻找合适对象/ })).toHaveAttribute("href", "/find");
    expect(screen.getByText("双方同意后聊天")).toBeVisible();
  });

  it("展示 API 返回的审核会员且不伪装成演示资料", async () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect((await screen.findAllByRole("heading", { name: /林婉清/ })).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("演示资料")).not.toBeInTheDocument();
  });

  it("明确标注 API 返回的演示资料", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/members") return jsonResponse({ items: [{ ...member, demo: true }], total: 1 });
      if (url.pathname === "/api/content") {
        const items = contentFor(url);
        return jsonResponse({ items, page: 1, pageSize: 4, total: items.length, totalPages: 1 });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect((await screen.findAllByText("演示资料")).length).toBeGreaterThanOrEqual(1);
  });

  it("会员接口失败时显示错误，不回退到静态人物", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/members") throw new Error("offline");
      if (url.pathname === "/api/content") {
        const items = contentFor(url);
        return jsonResponse({ items, page: 1, pageSize: 4, total: items.length, totalPages: 1 });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    }));
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(await screen.findByText("会员资料暂时无法加载")).toBeVisible();
    expect(screen.queryByRole("heading", { name: /林婉清/ })).not.toBeInTheDocument();
  });

  it("不在首页公开核心算法说明", () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.queryByText(/匹配权重|Prompt|分数阈值/)).not.toBeInTheDocument();
  });

  it("从公开内容接口展示四类真实内容并链接到对应页面", async () => {
    const fetchMock = installApiMock();
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(await screen.findByText("清晨沿江散步")).toBeVisible();
    expect(screen.getByRole("link", { name: /周末滨江漫步/ })).toHaveAttribute("href", "/activities");
    expect(screen.getByText(/8月20日/)).toBeVisible();
    expect(screen.getByText("上海市徐汇区滨江步道")).toBeVisible();
    expect(screen.getByText("剩余 6 个名额")).toBeVisible();
    expect(screen.getByRole("link", { name: /从一顿家常饭开始了解/ })).toHaveAttribute("href", "/stories");
    expect(screen.getByRole("link", { name: /第一次见面怎样更安心/ })).toHaveAttribute("href", "/classroom");

    const contentRequests = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname === "/api/content");
    expect(contentRequests).toHaveLength(4);
    expect(contentRequests.map((url) => Object.fromEntries(url.searchParams))).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "article", tag: "动态" }),
      expect.objectContaining({ type: "event", upcomingOnly: "true" }),
      expect.objectContaining({ type: "article", tag: "幸福案例" }),
      expect.objectContaining({ type: "article", tag: "婚恋课堂" }),
    ]));
  });

  it("单个内容分区失败时保留会员主区和其他公开内容", async () => {
    installApiMock({ failedTag: "动态" });
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(await screen.findByText("生活动态暂时无法加载")).toBeVisible();
    expect((await screen.findAllByRole("heading", { name: /林婉清/ })).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("周末滨江漫步")).toBeVisible();
    expect(screen.getByText("从一顿家常饭开始了解")).toBeVisible();
    expect(screen.getByText("第一次见面怎样更安心")).toBeVisible();
  });

  it("公开内容为空时显示简短提示且不伪造演示内容", async () => {
    installApiMock({ emptyContent: true });
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(await screen.findByText("暂时没有生活动态")).toBeVisible();
    expect(screen.getByText("暂时没有可报名的活动")).toBeVisible();
    expect(screen.getByText("暂时没有幸福案例")).toBeVisible();
    expect(screen.getByText("暂时没有课堂文章")).toBeVisible();
    expect(screen.queryByText("初秋江边散步会")).not.toBeInTheDocument();
    expect(screen.queryByText("演示活动")).not.toBeInTheDocument();
  });
});
