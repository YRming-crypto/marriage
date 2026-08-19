import "@testing-library/jest-dom/vitest";
import type { Member, Recommendation, SavedMatchFilter } from "@ai-marriage/shared";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  cancelInterest,
  createInterest,
  deleteMatchFilter,
  getInterests,
  getMatchFilters,
  getRecommendations,
  restoreSkippedMember,
  saveMatchFilter,
  skipMember,
} from "../api/client";
import { MatchmakingPage } from "./MatchmakingPage";

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly code: string, public readonly status: number) {
      super(message);
      this.name = "ApiError";
    }
  },
  cancelInterest: vi.fn(),
  createInterest: vi.fn(),
  deleteMatchFilter: vi.fn(),
  getInterests: vi.fn(),
  getMatchFilters: vi.fn(),
  getRecommendations: vi.fn(),
  restoreSkippedMember: vi.fn(),
  saveMatchFilter: vi.fn(),
  skipMember: vi.fn(),
}));

const member: Member = {
  id: "member-lin",
  userId: "user-lin",
  nickname: "林婉清",
  gender: "女性",
  age: 46,
  city: "杭州",
  district: "西湖",
  job: "教育工作者",
  maritalStatus: "离异",
  goal: "认真交往",
  tags: ["阅读", "散步"],
  introduction: "期待真诚、稳定的关系。",
  photoUrl: "https://example.com/lin.jpg",
  activeLabel: "今日活跃",
  verified: true,
};

const secondMember: Member = {
  ...member,
  id: "member-zhou",
  userId: "user-zhou",
  nickname: "周明远",
  gender: "男性",
  age: 49,
  city: "上海",
  job: "工程师",
  photoUrl: "https://example.com/zhou.jpg",
};

const recommendation: Recommendation = {
  member,
  score: 86,
  reasons: ["你们都希望认真交往", "生活城市距离较近"],
};

const savedFilter: SavedMatchFilter = {
  id: "filter-1",
  userId: "user-me",
  name: "杭州同龄人",
  criteria: { city: "杭州", minAge: 40, maxAge: 55 },
  isDefault: false,
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
};

const emptyInterests = { sent: [], received: [], mutual: [] };

function relation(memberValue: Member) {
  return {
    id: `interest-${memberValue.id}`,
    userId: "user-me",
    memberId: memberValue.id,
    status: "active" as const,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    member: memberValue,
  };
}

function renderPage() {
  return render(<MemoryRouter><MatchmakingPage /></MemoryRouter>);
}

function authRequiredError() {
  return new ApiError("当前会话不可用。", "AUTH_REQUIRED", 401);
}

function answersRequiredError() {
  return new ApiError("请先补充 AI 问答。", "ANSWERS_REQUIRED", 409);
}

function accountReviewRequiredError() {
  return new ApiError("资料和照片审核通过后才能联系正式会员。", "ACCOUNT_REVIEW_REQUIRED", 409);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("匹配大厅", () => {
  beforeEach(() => {
    vi.mocked(getRecommendations).mockReset().mockResolvedValue({ items: [recommendation] });
    vi.mocked(getInterests).mockReset().mockResolvedValue(emptyInterests);
    vi.mocked(getMatchFilters).mockReset().mockResolvedValue({ items: [] });
    vi.mocked(createInterest).mockReset().mockResolvedValue({ interest: { id: "interest-1", memberId: member.id } });
    vi.mocked(cancelInterest).mockReset().mockResolvedValue(undefined);
    vi.mocked(skipMember).mockReset().mockResolvedValue(undefined);
    vi.mocked(restoreSkippedMember).mockReset().mockResolvedValue(undefined);
    vi.mocked(saveMatchFilter).mockReset().mockResolvedValue({ filter: savedFilter });
    vi.mocked(deleteMatchFilter).mockReset().mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("加载推荐和关系数据，只展示容易理解的匹配理由", async () => {
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("正在为你整理推荐");
    expect(await screen.findByRole("heading", { name: "林婉清，46 岁" })).toBeVisible();
    expect(screen.getByText("你们都希望认真交往")).toBeVisible();
    expect(screen.getByText("生活城市距离较近")).toBeVisible();
    expect(screen.queryByText("86%")).not.toBeInTheDocument();
    expect(screen.queryByText("bidirectional-rules-v1.0.0")).not.toBeInTheDocument();
    expect(getRecommendations).toHaveBeenCalledOnce();
    expect(getInterests).toHaveBeenCalledOnce();
    expect(getMatchFilters).toHaveBeenCalledOnce();
  });

  it("按游标加载更多推荐并去除重复会员", async () => {
    const user = userEvent.setup();
    vi.mocked(getRecommendations)
      .mockResolvedValueOnce({ items: [recommendation], total: 2, pageSize: 1, nextCursor: "next-page", hasMore: true })
      .mockResolvedValueOnce({ items: [recommendation, { ...recommendation, member: secondMember }], total: 2, pageSize: 1, nextCursor: null, hasMore: false });

    renderPage();
    await screen.findByRole("heading", { name: "林婉清，46 岁" });
    await user.click(screen.getByRole("button", { name: "加载更多推荐" }));

    expect(getRecommendations).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "next-page", pageSize: 1 }));
    expect(await screen.findByRole("heading", { name: "周明远，49 岁" })).toBeVisible();
    expect(screen.getAllByRole("heading", { name: "林婉清，46 岁" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "加载更多推荐" })).not.toBeInTheDocument();
  });

  it("会汇总收到的喜欢和互相心仪，给用户更明确的互动提醒", async () => {
    vi.mocked(getInterests).mockResolvedValue({
      sent: [relation(member)],
      received: [relation(secondMember)],
      mutual: [relation(member)],
    });

    renderPage();

    expect(await screen.findByText("你有 1 位用户对你表达了喜欢")).toBeVisible();
    expect(screen.getByText("还有 1 组互相心仪，适合继续和对方的 AI 分身聊聊")).toBeVisible();
    expect(screen.getByRole("button", { name: /查看收到的喜欢/ })).toBeVisible();
  });

  it("在顶部设置专属的谁喜欢我入口，减少用户错过回应的机会", async () => {
    const user = userEvent.setup();
    vi.mocked(getInterests).mockResolvedValue({
      sent: [],
      received: [relation(secondMember)],
      mutual: [],
    });

    renderPage();

    expect(await screen.findByRole("heading", { name: "谁喜欢我" })).toBeVisible();
    expect(screen.getByText("周明远想和你认识")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "回复周明远的喜欢" }));
    expect(createInterest).toHaveBeenCalledWith(secondMember.id);
  });

  it("在匹配大厅中提前给出 AI 约会顾问建议，帮助用户更稳妥地推进聊聊", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "林婉清，46 岁" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "AI 约会顾问" })).toBeVisible();
    expect(screen.getByRole("button", { name: "先问她周末怎么安排" })).toBeVisible();
    expect(screen.getByRole("button", { name: "先了解她的关系期待" })).toBeVisible();
  });

  it("应用新筛选后忽略尚未完成的旧分页结果和游标", async () => {
    const user = userEvent.setup();
    const oldPage = deferred<Awaited<ReturnType<typeof getRecommendations>>>();
    const filteredRecommendation = { ...recommendation, member: secondMember };
    const staleMember = { ...member, id: "member-stale", userId: "user-stale", nickname: "旧分页会员" };
    vi.mocked(getRecommendations)
      .mockResolvedValueOnce({ items: [recommendation], total: 3, pageSize: 1, nextCursor: "old-next", hasMore: true })
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce({ items: [filteredRecommendation], total: 2, pageSize: 1, nextCursor: "filtered-next", hasMore: true })
      .mockResolvedValueOnce({ items: [], total: 2, pageSize: 1, nextCursor: null, hasMore: false });

    renderPage();
    await screen.findByRole("heading", { name: "林婉清，46 岁" });
    await user.click(screen.getByRole("button", { name: "加载更多推荐" }));
    await user.clear(screen.getByLabelText("所在城市"));
    await user.type(screen.getByLabelText("所在城市"), "上海");
    await user.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(await screen.findByRole("heading", { name: "周明远，49 岁" })).toBeVisible();
    await act(async () => {
      oldPage.resolve({
        items: [{ ...recommendation, member: staleMember }],
        total: 3,
        pageSize: 1,
        nextCursor: "stale-next",
        hasMore: true,
      });
      await oldPage.promise;
    });

    expect(screen.queryByRole("heading", { name: "旧分页会员，46 岁" })).not.toBeInTheDocument();
    expect(screen.getByText("已显示 1 / 2")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "加载更多推荐" }));
    expect(getRecommendations).toHaveBeenLastCalledWith(expect.objectContaining({
      city: "上海",
      cursor: "filtered-next",
      pageSize: 1,
    }));
  });

  it("同一批次连续触发加载更多时只发送一个分页请求", async () => {
    const pendingPage = deferred<Awaited<ReturnType<typeof getRecommendations>>>();
    vi.mocked(getRecommendations)
      .mockResolvedValueOnce({ items: [recommendation], total: 2, pageSize: 1, nextCursor: "next-page", hasMore: true })
      .mockReturnValue(pendingPage.promise);

    renderPage();
    await screen.findByRole("heading", { name: "林婉清，46 岁" });
    const loadMoreButton = screen.getByRole("button", { name: "加载更多推荐" });
    act(() => {
      loadMoreButton.click();
      loadMoreButton.click();
    });

    expect(getRecommendations).toHaveBeenCalledTimes(2);
    await act(async () => {
      pendingPage.resolve({ items: [], total: 2, pageSize: 1, nextCursor: null, hasMore: false });
      await pendingPage.promise;
    });
  });

  it("分页游标失效时自动刷新当前筛选首屏并给出非阻断提示", async () => {
    const user = userEvent.setup();
    const refreshedRecommendation = { ...recommendation, member: secondMember };
    vi.mocked(getRecommendations)
      .mockResolvedValueOnce({ items: [recommendation], total: 2, pageSize: 1, nextCursor: "expired", hasMore: true })
      .mockRejectedValueOnce(new ApiError("分页游标已失效。", "INVALID_CURSOR", 400))
      .mockResolvedValueOnce({ items: [refreshedRecommendation], total: 1, pageSize: 1, nextCursor: null, hasMore: false });

    renderPage();
    await screen.findByRole("heading", { name: "林婉清，46 岁" });
    await user.click(screen.getByRole("button", { name: "加载更多推荐" }));

    expect(await screen.findByRole("heading", { name: "周明远，49 岁" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "林婉清，46 岁" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("推荐列表已自动刷新，请继续浏览");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getRecommendations).toHaveBeenCalledTimes(3);
    expect(getRecommendations).toHaveBeenLastCalledWith(expect.not.objectContaining({ cursor: expect.anything() }));
  });

  it("把筛选条件发送给服务端并展示筛选后的空状态", async () => {
    const user = userEvent.setup();
    vi.mocked(getRecommendations)
      .mockResolvedValueOnce({ items: [recommendation] })
      .mockResolvedValueOnce({ items: [] });
    renderPage();
    await screen.findByRole("heading", { name: "林婉清，46 岁" });

    await user.selectOptions(screen.getByLabelText("想认识"), "女性");
    await user.clear(screen.getByLabelText("所在城市"));
    await user.type(screen.getByLabelText("所在城市"), "苏州");
    await user.selectOptions(screen.getByLabelText("排序方式"), "age-asc");
    await user.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(getRecommendations).toHaveBeenLastCalledWith(expect.objectContaining({
      gender: "女性",
      city: "苏州",
      minAge: 35,
      maxAge: 65,
      sort: "age-asc",
    }));
    expect(await screen.findByRole("heading", { name: "暂时没有符合条件的推荐" })).toBeVisible();
  });

  it("可以喜欢和取消喜欢推荐会员", async () => {
    const user = userEvent.setup();
    vi.mocked(getInterests)
      .mockResolvedValueOnce(emptyInterests)
      .mockResolvedValueOnce({ sent: [relation(member)], received: [], mutual: [] })
      .mockResolvedValueOnce(emptyInterests);
    renderPage();

    await user.click(await screen.findByRole("button", { name: "喜欢林婉清" }));
    expect(createInterest).toHaveBeenCalledWith(member.id);
    expect(await screen.findByRole("button", { name: "取消喜欢林婉清" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "取消喜欢林婉清" }));
    expect(cancelInterest).toHaveBeenCalledWith(member.id);
    expect(await screen.findByRole("button", { name: "喜欢林婉清" })).toBeVisible();
  });

  it("展示收到的喜欢和互相心仪，并允许回应喜欢", async () => {
    const user = userEvent.setup();
    vi.mocked(getInterests)
      .mockResolvedValueOnce({ sent: [], received: [relation(secondMember)], mutual: [] })
      .mockResolvedValueOnce({ sent: [relation(secondMember)], received: [relation(secondMember)], mutual: [relation(secondMember)] });
    renderPage();
    await screen.findByRole("heading", { name: "林婉清，46 岁" });

    await user.click(screen.getByRole("tab", { name: /收到的喜欢/ }));
    expect(await screen.findByRole("heading", { name: "周明远，49 岁" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "也喜欢周明远" }));
    expect(createInterest).toHaveBeenCalledWith(secondMember.id);

    await user.click(screen.getByRole("tab", { name: /互相心仪/ }));
    expect(screen.getByRole("link", { name: "和周明远的 AI 分身聊聊" })).toHaveAttribute(
      "href",
      `/matchmaking/${secondMember.id}/chat`,
    );
  });

  it("在我的心仪中查看并取消已表达喜欢的会员", async () => {
    const user = userEvent.setup();
    vi.mocked(getInterests)
      .mockResolvedValueOnce({ sent: [relation(secondMember)], received: [], mutual: [] })
      .mockResolvedValueOnce(emptyInterests);
    renderPage();
    await screen.findByRole("heading", { name: "林婉清，46 岁" });

    await user.click(screen.getByRole("tab", { name: /我的心仪/ }));

    expect(await screen.findByRole("heading", { name: "周明远，49 岁" })).toBeVisible();
    expect(screen.getByRole("link", { name: "查看周明远的资料" })).toHaveAttribute("href", `/member/${secondMember.id}`);
    await user.click(screen.getByRole("button", { name: "取消喜欢周明远" }));

    expect(cancelInterest).toHaveBeenCalledWith(secondMember.id);
    expect(await screen.findByRole("heading", { name: "还没有加入心仪的人" })).toBeVisible();
  });

  it("跳过后可在本次浏览中恢复会员", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "暂时跳过林婉清" }));
    expect(skipMember).toHaveBeenCalledWith(member.id);
    expect(screen.queryByRole("heading", { name: "林婉清，46 岁" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /刚刚跳过/ }));
    await user.click(screen.getByRole("button", { name: "恢复林婉清" }));
    expect(restoreSkippedMember).toHaveBeenCalledWith(member.id);

    await user.click(screen.getByRole("tab", { name: /为你推荐/ }));
    expect(screen.getByRole("heading", { name: "林婉清，46 岁" })).toBeVisible();
  });

  it("保存、应用和删除筛选方案", async () => {
    const user = userEvent.setup();
    vi.mocked(getMatchFilters).mockResolvedValue({ items: [savedFilter] });
    renderPage();
    await screen.findByRole("heading", { name: "林婉清，46 岁" });

    await user.selectOptions(screen.getByLabelText("筛选方案"), savedFilter.id);
    expect(screen.getByLabelText("所在城市")).toHaveValue("杭州");
    await waitFor(() => expect(getRecommendations).toHaveBeenLastCalledWith(expect.objectContaining({ city: "杭州", minAge: 40, maxAge: 55 })));

    await user.clear(screen.getByLabelText("方案名称"));
    await user.type(screen.getByLabelText("方案名称"), "周末有空");
    await user.click(screen.getByRole("button", { name: "保存当前筛选" }));
    expect(saveMatchFilter).toHaveBeenCalledWith(expect.objectContaining({ name: "周末有空" }));

    const schemes = screen.getByRole("region", { name: "已保存的筛选方案" });
    await user.click(within(schemes).getByRole("button", { name: "删除杭州同龄人" }));
    expect(deleteMatchFilter).toHaveBeenCalledWith(savedFilter.id);
  });

  it("后续应用筛选发现缺少问答时直达关系问答", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "林婉清，46 岁" });
    vi.mocked(getRecommendations).mockRejectedValueOnce(answersRequiredError());

    await user.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(await screen.findByRole("link", { name: "去补充问答" })).toHaveAttribute(
      "href",
      "/onboarding?step=questions&next=%2Fmatchmaking",
    );
  });

  it("后续喜欢发现会话失效时直达登录", async () => {
    const user = userEvent.setup();
    vi.mocked(createInterest).mockRejectedValueOnce(authRequiredError());
    renderPage();

    await user.click(await screen.findByRole("button", { name: "喜欢林婉清" }));

    expect(await screen.findByRole("link", { name: "登录或注册" })).toHaveAttribute("href", "/auth?next=%2Fmatchmaking");
  });

  it("后续喜欢发现资料仍在审核时直达建档审核步骤", async () => {
    const user = userEvent.setup();
    vi.mocked(createInterest).mockRejectedValueOnce(accountReviewRequiredError());
    renderPage();

    await user.click(await screen.findByRole("button", { name: "喜欢林婉清" }));

    expect(await screen.findByRole("heading", { name: "资料和照片审核通过后再联系" })).toBeVisible();
    expect(screen.getByRole("link", { name: "查看审核状态" })).toHaveAttribute(
      "href",
      "/onboarding?step=photos&next=%2Fmatchmaking",
    );
  });

  it("后续跳过发现缺少问答时直达关系问答", async () => {
    const user = userEvent.setup();
    vi.mocked(skipMember).mockRejectedValueOnce(answersRequiredError());
    renderPage();

    await user.click(await screen.findByRole("button", { name: "暂时跳过林婉清" }));

    expect(await screen.findByRole("link", { name: "去补充问答" })).toHaveAttribute(
      "href",
      "/onboarding?step=questions&next=%2Fmatchmaking",
    );
  });

  it("后续恢复发现会话失效时直达登录", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "暂时跳过林婉清" }));
    vi.mocked(restoreSkippedMember).mockRejectedValueOnce(authRequiredError());
    await user.click(screen.getByRole("tab", { name: /刚刚跳过/ }));

    await user.click(screen.getByRole("button", { name: "恢复林婉清" }));

    expect(await screen.findByRole("link", { name: "登录或注册" })).toHaveAttribute("href", "/auth?next=%2Fmatchmaking");
  });

  it("保存筛选方案发现缺少问答时直达关系问答", async () => {
    const user = userEvent.setup();
    vi.mocked(saveMatchFilter).mockRejectedValueOnce(answersRequiredError());
    renderPage();
    await screen.findByRole("heading", { name: "林婉清，46 岁" });
    await user.type(screen.getByLabelText("方案名称"), "周末有空");

    await user.click(screen.getByRole("button", { name: "保存当前筛选" }));

    expect(await screen.findByRole("link", { name: "去补充问答" })).toHaveAttribute(
      "href",
      "/onboarding?step=questions&next=%2Fmatchmaking",
    );
  });

  it("删除筛选方案发现会话失效时直达登录", async () => {
    const user = userEvent.setup();
    vi.mocked(getMatchFilters).mockResolvedValueOnce({ items: [savedFilter] });
    vi.mocked(deleteMatchFilter).mockRejectedValueOnce(authRequiredError());
    renderPage();
    const schemes = await screen.findByRole("region", { name: "已保存的筛选方案" });

    await user.click(within(schemes).getByRole("button", { name: "删除杭州同龄人" }));

    expect(await screen.findByRole("link", { name: "登录或注册" })).toHaveAttribute("href", "/auth?next=%2Fmatchmaking");
  });

  it("推荐加载失败时显示原因并支持重试", async () => {
    const user = userEvent.setup();
    vi.mocked(getRecommendations)
      .mockRejectedValueOnce(new Error("推荐服务暂时繁忙"))
      .mockResolvedValueOnce({ items: [recommendation] });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("推荐服务暂时繁忙");
    await user.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("heading", { name: "林婉清，46 岁" })).toBeVisible();
  });

  it("未登录和未建档时提供正确入口", async () => {
    vi.mocked(getRecommendations).mockRejectedValue(new ApiError("当前会话不可用。", "AUTH_REQUIRED", 401));
    const view = renderPage();
    expect(await screen.findByRole("link", { name: "登录或注册" })).toHaveAttribute("href", "/auth?next=%2Fmatchmaking");

    view.unmount();
    vi.mocked(getRecommendations).mockRejectedValue(new ApiError("还需要完成下一步。", "PROFILE_REQUIRED", 409));
    renderPage();
    expect(await screen.findByRole("link", { name: "去完善资料" })).toHaveAttribute("href", "/onboarding?next=%2Fmatchmaking");
  });

  it("首次推荐发现缺少问答或 AI 分身时提供对应入口", async () => {
    vi.mocked(getRecommendations).mockRejectedValue(answersRequiredError());
    const answersView = renderPage();
    expect(await screen.findByText("需要完成全部 15 道关系问答，系统才能继续整理专属推荐。")).toBeVisible();
    expect(await screen.findByRole("link", { name: "去补充问答" })).toHaveAttribute(
      "href",
      "/onboarding?step=questions&next=%2Fmatchmaking",
    );

    answersView.unmount();
    vi.mocked(getRecommendations).mockRejectedValue(new ApiError("请先生成 AI 分身。", "AVATAR_PROFILE_REQUIRED", 409));
    renderPage();
    expect(await screen.findByRole("link", { name: "去生成 AI 分身" })).toHaveAttribute("href", "/me/avatar");
  });

  it("首次关系请求发现会话失效时直达登录", async () => {
    vi.mocked(getInterests).mockRejectedValueOnce(authRequiredError());

    renderPage();

    expect(await screen.findByRole("link", { name: "登录或注册" })).toHaveAttribute("href", "/auth?next=%2Fmatchmaking");
  });

  it("首次筛选方案请求发现缺少问答时直达关系问答", async () => {
    vi.mocked(getMatchFilters).mockRejectedValueOnce(answersRequiredError());

    renderPage();

    expect(await screen.findByRole("link", { name: "去补充问答" })).toHaveAttribute(
      "href",
      "/onboarding?step=questions&next=%2Fmatchmaking",
    );
  });

  it("首次关系数据普通错误时可单独重试并恢复", async () => {
    const user = userEvent.setup();
    vi.mocked(getInterests)
      .mockRejectedValueOnce(new Error("关系数据暂时不可用"))
      .mockResolvedValueOnce(emptyInterests);

    renderPage();

    expect(await screen.findByRole("heading", { name: "林婉清，46 岁" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("关系和筛选方案暂时未完整更新");
    await user.click(screen.getByRole("button", { name: "重新加载关系和筛选方案" }));

    await waitFor(() => expect(getInterests).toHaveBeenCalledTimes(2));
    expect(getMatchFilters).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "重新加载关系和筛选方案" })).not.toBeInTheDocument();
  });

  it("首次筛选方案普通错误时可重试并恢复方案列表", async () => {
    const user = userEvent.setup();
    vi.mocked(getMatchFilters)
      .mockRejectedValueOnce(new Error("筛选方案暂时不可用"))
      .mockResolvedValueOnce({ items: [savedFilter] });

    renderPage();

    expect(await screen.findByRole("heading", { name: "林婉清，46 岁" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重新加载关系和筛选方案" }));

    const schemes = await screen.findByRole("region", { name: "已保存的筛选方案" });
    expect(within(schemes).getByText("杭州同龄人")).toBeVisible();
    expect(getMatchFilters).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "重新加载关系和筛选方案" })).not.toBeInTheDocument();
  });
});
