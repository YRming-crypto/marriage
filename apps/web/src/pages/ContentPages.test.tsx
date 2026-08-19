import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContentItem } from "@ai-marriage/shared";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActivitiesPage,
  AuthPage,
  ClassroomPage,
  MomentsPage,
  PrivacyPolicyPage,
  StoriesPage,
  UserAgreementPage,
  type ContentPageApi,
} from "./ContentPages";

afterEach(() => { cleanup(); localStorage.clear(); });

function renderPage(page: ReactNode) {
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="当前地址">{`${location.pathname}${location.search}`}</output>;
}

const now = Date.now();

function content(overrides: Partial<ContentItem>): ContentItem {
  return {
    id: "content-1",
    type: "article",
    status: "published",
    title: "周末在公园慢走",
    summary: "天气舒服，沿湖走了一圈。",
    body: "比起匆忙赶路，我更喜欢留一点时间看看树和水。",
    tags: ["动态"],
    coverImageUrl: "/images/moment-walk.jpg",
    imageUrls: ["/images/moment-walk.jpg"],
    authorId: "member-lin",
    likeCount: 6,
    registrationCount: 0,
    event: null,
    createdAt: now - 60_000,
    updatedAt: now - 60_000,
    publishedAt: now - 60_000,
    offlineAt: null,
    ...overrides,
  };
}

function page(items: ContentItem[]) {
  return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0 });
}

function contentApi(overrides: Partial<ContentPageApi> = {}): ContentPageApi {
  return {
    getContent: vi.fn(() => page([])),
    likeContent: vi.fn(async () => ({ liked: true, changed: true, likeCount: 1 })),
    unlikeContent: vi.fn(async () => ({ liked: false, changed: true, likeCount: 0 })),
    registerEvent: vi.fn(async (contentId) => ({
      changed: true,
      registration: { id: "registration-1", contentId, userId: "user-1", status: "registered" as const, registeredAt: now, cancelledAt: null, updatedAt: now },
      registrationCount: 1,
      remainingCapacity: 11,
    })),
    cancelEventRegistration: vi.fn(async () => ({ changed: true, registration: null, registrationCount: 0, remainingCapacity: 12 })),
    getMyEventRegistrations: vi.fn(async () => ({ items: [] })),
    ...overrides,
  };
}

describe("用户内容数据", () => {
  it("从内容接口加载生活动态并支持点赞和取消点赞", async () => {
    const user = userEvent.setup();
    const item = content({ id: "moment-1" });
    const api = contentApi({
      getContent: vi.fn(() => page([item])),
      likeContent: vi.fn(async () => ({ liked: true, changed: true, likeCount: 7 })),
      unlikeContent: vi.fn(async () => ({ liked: false, changed: true, likeCount: 6 })),
    });

    renderPage(<MomentsPage contentApi={api} />);

    expect(screen.getByRole("status", { name: "正在加载生活动态" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "周末在公园慢走" })).toBeVisible();
    expect(api.getContent).toHaveBeenCalledWith({ type: "article", tag: "动态", pageSize: 50 });

    await user.click(screen.getByRole("button", { name: "喜欢动态：周末在公园慢走" }));
    expect(await screen.findByRole("button", { name: "取消喜欢动态：周末在公园慢走" })).toHaveTextContent("7");
    expect(api.likeContent).toHaveBeenCalledWith("moment-1");

    await user.click(screen.getByRole("button", { name: "取消喜欢动态：周末在公园慢走" }));
    expect(await screen.findByRole("button", { name: "喜欢动态：周末在公园慢走" })).toHaveTextContent("6");
    expect(api.unlikeContent).toHaveBeenCalledWith("moment-1");
  });

  it("加载失败时说明原因并允许重新加载", async () => {
    const user = userEvent.setup();
    const getContent = vi.fn()
      .mockRejectedValueOnce(new Error("内容服务暂时不可用"))
      .mockImplementationOnce(() => page([content({ id: "moment-retry" })]));

    renderPage(<MomentsPage contentApi={contentApi({ getContent })} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("内容服务暂时不可用");
    await user.click(screen.getByRole("button", { name: "重新加载" }));

    expect(await screen.findByRole("heading", { name: "周末在公园慢走" })).toBeVisible();
    expect(getContent).toHaveBeenCalledTimes(2);
  });

  it("登录会员可以提交待审核动态、查看并删除自己的内容", async () => {
    localStorage.setItem("ai-marriage-auth-user", JSON.stringify({ id: "user-1", phoneMasked: "138****8000" }));
    const user = userEvent.setup();
    const ownMoment = content({ id: "mine-1", status: "draft", title: "今天去公园散步", body: "今天去公园散步", publishedAt: null });
    const momentApi = {
      createMoment: vi.fn(async () => ({ content: ownMoment })),
      getMyContent: vi.fn(async () => ({ items: [] })),
      deleteMyContent: vi.fn(async () => undefined),
    };

    renderPage(<MomentsPage contentApi={contentApi()} momentApi={momentApi} />);
    await user.type(screen.getByLabelText("动态内容"), "今天去公园散步");
    await user.click(screen.getByRole("button", { name: "提交动态审核" }));

    expect(await screen.findByText("已提交审核")).toBeVisible();
    expect(momentApi.createMoment).toHaveBeenCalledWith({ body: "今天去公园散步", images: [] });
    expect(screen.getByText("今天去公园散步")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "删除动态：今天去公园散步" }));
    expect(momentApi.deleteMyContent).toHaveBeenCalledWith("mine-1");
  });

  it.each([
    ["生活动态", <MomentsPage contentApi={contentApi()} />, "暂时还没有生活动态"],
    ["线下活动", <ActivitiesPage contentApi={contentApi()} />, "暂时还没有可报名的活动"],
    ["幸福案例", <StoriesPage contentApi={contentApi()} />, "暂时还没有幸福案例"],
    ["婚恋课堂", <ClassroomPage contentApi={contentApi()} />, "暂时还没有课堂文章"],
  ])("%s 在没有内容时展示清楚的空状态", async (_name, component, emptyMessage) => {
    renderPage(component);
    expect(await screen.findByText(emptyMessage)).toBeVisible();
  });
});

describe("线下活动", () => {
  it("可以按城市和关键词筛选，并展开查看完整活动安排", async () => {
    const user = userEvent.setup();
    const shanghai = content({
      id: "event-shanghai",
      type: "event",
      title: "徐汇滨江散步",
      summary: "边走边聊。",
      body: "工作人员在地铁站集合并全程带队。",
      tags: ["上海", "户外"],
      event: { startsAt: now + 86_400_000, endsAt: now + 90_000_000, location: "上海市徐汇区滨江步道", capacity: 20, remainingCapacity: 8 },
    });
    const hangzhou = content({
      id: "event-hangzhou",
      type: "event",
      title: "西湖茶话会",
      summary: "安静交流。",
      body: "在公共茶室分组交流。",
      tags: ["杭州", "茶话会"],
      event: { startsAt: now + 86_400_000, endsAt: now + 90_000_000, location: "杭州西湖区", capacity: 12, remainingCapacity: 4 },
    });
    renderPage(<ActivitiesPage contentApi={contentApi({ getContent: vi.fn(() => page([shanghai, hangzhou])) })} />);

    await screen.findByRole("heading", { name: "徐汇滨江散步" });
    await user.selectOptions(screen.getByLabelText("活动城市"), "杭州");
    expect(screen.queryByRole("heading", { name: "徐汇滨江散步" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "西湖茶话会" })).toBeVisible();

    await user.type(screen.getByLabelText("搜索活动"), "西湖");
    const card = screen.getByRole("heading", { name: "西湖茶话会" }).closest("article")!;
    await user.click(within(card).getByRole("button", { name: "查看详情" }));
    expect(within(card).getByText("在公共茶室分组交流。")).toBeVisible();
    expect(within(card).getByText("12 人")).toBeVisible();
  });

  it("展示真实名额并完成报名和取消报名", async () => {
    const user = userEvent.setup();
    const activity = content({
      id: "event-1",
      type: "event",
      title: "初秋江边散步会",
      summary: "在公开场所轻松认识同城朋友。",
      body: "工作人员全程在场，活动结束前可随时离开。",
      tags: ["活动", "上海"],
      event: { startsAt: now + 86_400_000, endsAt: now + 90_000_000, location: "上海徐汇滨江", capacity: 12, remainingCapacity: 12 },
      registrationCount: 0,
    });
    const api = contentApi({ getContent: vi.fn(() => page([activity])) });

    renderPage(<ActivitiesPage contentApi={api} />);

    expect(await screen.findByText("剩余 12 个名额")).toBeVisible();
    expect(api.getContent).toHaveBeenCalledWith({ type: "event", upcomingOnly: true, pageSize: 50 });

    await user.click(screen.getByRole("button", { name: "报名活动：初秋江边散步会" }));
    expect(await screen.findByText("已报名")).toBeVisible();
    expect(screen.getByRole("button", { name: "取消报名：初秋江边散步会" })).toBeEnabled();
    expect(api.registerEvent).toHaveBeenCalledWith("event-1");

    await user.click(screen.getByRole("button", { name: "取消报名：初秋江边散步会" }));
    expect(await screen.findByRole("button", { name: "报名活动：初秋江边散步会" })).toBeEnabled();
    expect(api.cancelEventRegistration).toHaveBeenCalledWith("event-1");
  });

  it("名额已满时禁用报名操作", async () => {
    const activity = content({
      id: "event-full",
      type: "event",
      title: "周末茶话会",
      tags: ["活动"],
      event: { startsAt: now + 86_400_000, endsAt: now + 90_000_000, location: "杭州西湖区", capacity: 8, remainingCapacity: 0 },
      registrationCount: 8,
    });

    renderPage(<ActivitiesPage contentApi={contentApi({ getContent: vi.fn(() => page([activity])) })} />);

    expect(await screen.findByRole("button", { name: "活动已满：周末茶话会" })).toBeDisabled();
  });

  it("刷新后恢复已报名状态并在我的活动中单独查看", async () => {
    const user = userEvent.setup();
    const registeredActivity = content({
      id: "event-registered",
      type: "event",
      title: "已报名的城市漫步",
      tags: ["上海", "活动"],
      event: { startsAt: now + 86_400_000, endsAt: now + 90_000_000, location: "上海徐汇滨江", capacity: 12, remainingCapacity: 11 },
      registrationCount: 1,
    });
    const otherActivity = content({
      id: "event-other",
      type: "event",
      title: "尚未报名的茶话会",
      tags: ["杭州", "活动"],
      event: { startsAt: now + 172_800_000, endsAt: now + 176_400_000, location: "杭州西湖区", capacity: 10, remainingCapacity: 10 },
    });
    const registration = { id: "registration-existing", contentId: registeredActivity.id, userId: "user-1", status: "registered" as const, registeredAt: now, cancelledAt: null, updatedAt: now };
    const api = contentApi({
      getContent: vi.fn(() => page([registeredActivity, otherActivity])),
      getMyEventRegistrations: vi.fn(async () => ({ items: [{ registration, content: registeredActivity }] })),
    });

    renderPage(<ActivitiesPage contentApi={api} />);

    expect(await screen.findByRole("button", { name: "取消报名：已报名的城市漫步" })).toBeEnabled();
    expect(api.getMyEventRegistrations).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "我的活动（1）" }));
    expect(screen.getByRole("heading", { name: "已报名的城市漫步" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "尚未报名的茶话会" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消报名：已报名的城市漫步" }));
    expect(await screen.findByText("还没有已报名的活动")).toBeVisible();
  });
});

describe("幸福案例", () => {
  it("从接口加载案例并在当前页面展开完整内容", async () => {
    const user = userEvent.setup();
    const story = content({
      id: "story-1",
      title: "从一顿家常饭聊起",
      summary: "他们先从生活节奏开始了解。",
      body: "第一次聊了近一个小时。\n\n经过几次认真交流，他们才决定线下见面。",
      tags: ["幸福案例"],
      coverImageUrl: "/images/story-1.jpg",
    });
    const api = contentApi({ getContent: vi.fn(() => page([story])) });

    renderPage(<StoriesPage contentApi={api} />);

    expect(screen.queryByRole("link", { name: /阅读完整案例/ })).not.toBeInTheDocument();
    const readButton = await screen.findByRole("button", { name: "阅读完整案例：从一顿家常饭聊起" });
    expect(readButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/第一次聊了近一个小时/)).not.toBeInTheDocument();
    expect(api.getContent).toHaveBeenCalledWith({ type: "article", tag: "幸福案例", pageSize: 50 });

    await user.click(readButton);

    expect(screen.getByText(/第一次聊了近一个小时/)).toBeVisible();
    expect(screen.getByRole("button", { name: "收起完整案例：从一顿家常饭聊起" })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("婚恋课堂", () => {
  it("点击分类后真正过滤文章，并可恢复全部文章", async () => {
    const user = userEvent.setup();
    const articles = [
      content({ id: "class-1", title: "先别急着转账", summary: "识别风险信号。", body: "认识不久就反复强调高收益项目时，请立即停止转账。", tags: ["婚恋课堂", "安全"] }),
      content({ id: "class-2", title: "第一次聊天怎样更自然", summary: "给彼此留出表达空间。", body: "一次只问一个问题。", tags: ["婚恋课堂", "沟通"] }),
      content({ id: "class-3", title: "再婚前谈清家庭安排", summary: "提前谈清责任边界。", body: "说明照护父母和子女的安排。", tags: ["婚恋课堂", "家庭"] }),
      content({ id: "class-4", title: "第一次线下见面", summary: "公共场所更安心。", body: "把见面行程告诉可信任的亲友。", tags: ["婚恋课堂", "见面"] }),
    ];
    const api = contentApi({ getContent: vi.fn(() => page(articles)) });
    renderPage(<ClassroomPage contentApi={api} />);

    const articleList = await screen.findByRole("region", { name: "文章列表" });
    expect(await within(articleList).findAllByRole("article")).toHaveLength(4);
    expect(api.getContent).toHaveBeenCalledWith({ type: "article", tag: "婚恋课堂", pageSize: 50 });

    await user.click(screen.getByRole("button", { name: "安全防骗" }));

    expect(screen.getByRole("button", { name: "安全防骗" })).toHaveAttribute("aria-pressed", "true");
    expect(within(articleList).getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "先别急着转账" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "第一次聊天怎样更自然" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全部文章" }));
    expect(within(articleList).getAllByRole("article")).toHaveLength(4);
  });

  it("在当前页面展开本地文章内容，不使用返回自身的链接", async () => {
    const user = userEvent.setup();
    const article = content({ id: "class-safe", title: "先别急着转账", summary: "识别风险信号。", body: "认识不久就反复强调高收益项目时，请立即停止转账。", tags: ["婚恋课堂", "安全"] });
    renderPage(<ClassroomPage contentApi={contentApi({ getContent: vi.fn(() => page([article])) })} />);

    expect(screen.queryByRole("link", { name: /先别急着转账/ })).not.toBeInTheDocument();
    const readButton = await screen.findByRole("button", { name: /阅读文章：先别急着转账/ });
    expect(screen.queryByText(/认识不久就反复强调高收益项目/)).not.toBeInTheDocument();

    await user.click(readButton);

    expect(screen.getByText(/认识不久就反复强调高收益项目/)).toBeVisible();
    expect(screen.getByRole("button", { name: /收起文章：先别急着转账/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("课堂文章可以点赞，并在失败时保留原状态", async () => {
    const user = userEvent.setup();
    const article = content({ id: "class-like", title: "认真倾听的三个方法", tags: ["婚恋课堂", "沟通"], likeCount: 2 });
    const api = contentApi({
      getContent: vi.fn(() => page([article])),
      likeContent: vi.fn(async () => { throw new Error("请先登录后再点赞"); }),
    });
    renderPage(<ClassroomPage contentApi={api} />);

    await user.click(await screen.findByRole("button", { name: "喜欢文章：认真倾听的三个方法" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请先登录后再点赞");
    expect(screen.getByRole("button", { name: "喜欢文章：认真倾听的三个方法" })).toHaveTextContent("2");
  });
});

describe("登录和法律文本", () => {
  it("登录后把安全的站内返回地址传给建档页", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { user: { id: "user-1", phoneMasked: "138****0000" }, profile: null } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    render(
      <MemoryRouter initialEntries={["/auth?next=%2Fmatchmaking%2Fmember-1%2Fchat%3Ftopic%3Dfamily"]}>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/onboarding" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("手机号码"), "13800000000");
    await user.type(screen.getByLabelText("验证码"), "123456");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "登录并继续" }));

    expect(await screen.findByLabelText("当前地址")).toHaveTextContent("/onboarding?next=%2Fmatchmaking%2Fmember-1%2Fchat%3Ftopic%3Dfamily");
  });

  it("审核员登录后从正常流程进入审核后台", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: {
      user: { id: "moderator-1", phoneMasked: "138****0000", role: "moderator", status: "active" },
      profile: { nickname: "审核员" },
    } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    render(
      <MemoryRouter initialEntries={["/auth"]}>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/admin/review" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("手机号码"), "13800000000");
    await user.type(screen.getByLabelText("验证码"), "123456");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "登录并继续" }));

    expect(await screen.findByLabelText("当前地址")).toHaveTextContent("/admin/review");
  });

  it("拒绝使用反斜杠伪装的站外 next，并保留建档页原有默认流程", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { user: { id: "user-1", phoneMasked: "138****0000" }, profile: null } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    render(
      <MemoryRouter initialEntries={["/auth?next=%2F%5Cevil.example%2Fsteal"]}>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/onboarding" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("手机号码"), "13800000000");
    await user.type(screen.getByLabelText("验证码"), "123456");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "登录并继续" }));

    expect(await screen.findByLabelText("当前地址")).toHaveTextContent(/^\/onboarding$/);
  });

  it("登录同意文字链接到可阅读的用户协议和隐私政策", () => {
    renderPage(<AuthPage />);

    expect(screen.getByRole("link", { name: "用户协议" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "隐私政策" })).toHaveAttribute("href", "/privacy");
  });

  it("用户协议和隐私政策页面展示独立正文", () => {
    const { rerender } = renderPage(<UserAgreementPage />);
    expect(screen.getByRole("heading", { name: "用户协议" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "账号与使用规则" })).toBeVisible();

    rerender(<MemoryRouter><PrivacyPolicyPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "隐私政策" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "我们收集的信息" })).toBeVisible();
  });
});
