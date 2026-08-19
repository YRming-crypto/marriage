import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  getAvatarProfile,
  getBlocks,
  getMe,
  getMyPhotos,
  unblockUser,
} from "../api/client";
import { MePage } from "./MePage";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    getAvatarProfile: vi.fn(),
    getBlocks: vi.fn(),
    getMe: vi.fn(),
    getMyPhotos: vi.fn(),
    unblockUser: vi.fn(),
  };
});

const profile = {
  userId: "user-admin",
  nickname: "林女士",
  gender: "女性",
  birthYear: 1978,
  city: "上海",
  district: "徐汇",
  job: "教育工作者",
  maritalStatus: "离异",
  goal: "认真交往",
  introduction: "喜欢阅读和散步。",
  preference: { relationshipGoal: "认真交往", valuedQualities: "真诚" },
  answers: { 生活习惯: "生活规律", 家庭观念: "彼此尊重" },
  profileStatus: "approved" as const,
  updatedAt: "2026-08-13T10:00:00Z",
};

const photos = [
  { id: "photo-approved", userId: "user-admin", filename: "a.jpg", url: "/a.jpg", objectKey: "a", mimeType: "image/jpeg", sizeBytes: 100, isPrimary: true, reviewStatus: "approved" as const, reviewReason: null, createdAt: "2026-08-13T10:00:00Z", updatedAt: "2026-08-13T10:00:00Z" },
  { id: "photo-pending", userId: "user-admin", filename: "b.jpg", url: "/b.jpg", objectKey: "b", mimeType: "image/jpeg", sizeBytes: 100, isPrimary: false, reviewStatus: "pending" as const, reviewReason: null, createdAt: "2026-08-13T10:00:00Z", updatedAt: "2026-08-13T10:00:00Z" },
  { id: "photo-rejected", userId: "user-admin", filename: "c.jpg", url: "/c.jpg", objectKey: "c", mimeType: "image/jpeg", sizeBytes: 100, isPrimary: false, reviewStatus: "rejected" as const, reviewReason: "照片不清晰", createdAt: "2026-08-13T10:00:00Z", updatedAt: "2026-08-13T10:00:00Z" },
];

const avatarProfile = {
  userId: "user-admin",
  version: 1,
  approvedFacts: [{ topic: "生活习惯", fact: "生活规律" }],
  relationshipExpectations: ["认真交往"],
  boundaries: ["不公开手机号"],
  unknownResponse: "建议双方同意后再确认。",
  status: "enabled" as const,
  generatedAt: "2026-08-13T10:00:00Z",
  enabledAt: "2026-08-13T10:05:00Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function setSuccessfulResponses(role: "user" | "moderator" | "admin" = "user") {
  vi.mocked(getMe).mockResolvedValue({
    user: { id: "user-admin", phoneMasked: "138****8000", role, status: "active" },
    profile,
  });
  vi.mocked(getMyPhotos).mockResolvedValue({ items: photos });
  vi.mocked(getAvatarProfile).mockResolvedValue({ avatarProfile });
  vi.mocked(getBlocks).mockResolvedValue({
    items: [{
      id: "block-1",
      blockerUserId: "user-admin",
      blockedUserId: "user-zhou",
      createdAt: "2026-08-13T11:00:00Z",
      member: {
        id: "zhou",
        userId: "user-zhou",
        nickname: "周先生",
        gender: "男性",
        age: 48,
        city: "上海",
        district: "浦东",
        job: "工程师",
        maritalStatus: "离异",
        goal: "认真交往",
        tags: [],
        introduction: "",
        photoUrl: "/zhou.jpg",
        activeLabel: "最近活跃",
        verified: true,
      },
    }],
  });
}

describe("我的账户中心", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("并行读取四个真实接口并展示账户、资料、照片和 AI 状态", async () => {
    const me = deferred<Awaited<ReturnType<typeof getMe>>>();
    const myPhotos = deferred<Awaited<ReturnType<typeof getMyPhotos>>>();
    const avatar = deferred<Awaited<ReturnType<typeof getAvatarProfile>>>();
    const blocks = deferred<Awaited<ReturnType<typeof getBlocks>>>();
    vi.mocked(getMe).mockReturnValue(me.promise);
    vi.mocked(getMyPhotos).mockReturnValue(myPhotos.promise);
    vi.mocked(getAvatarProfile).mockReturnValue(avatar.promise);
    vi.mocked(getBlocks).mockReturnValue(blocks.promise);

    render(<MemoryRouter><MePage /></MemoryRouter>);

    await waitFor(() => {
      expect(getMe).toHaveBeenCalledOnce();
      expect(getMyPhotos).toHaveBeenCalledOnce();
      expect(getAvatarProfile).toHaveBeenCalledOnce();
      expect(getBlocks).toHaveBeenCalledOnce();
    });

    me.resolve({ user: { id: "user-admin", phoneMasked: "138****8000", role: "admin", status: "active" }, profile });
    myPhotos.resolve({ items: photos });
    avatar.resolve({ avatarProfile });
    blocks.resolve({ items: [] });

    expect(await screen.findByRole("heading", { name: "林女士的账户中心" })).toBeVisible();
    expect(screen.getByText("138****8000")).toBeVisible();
    expect(screen.getByText("100%")).toBeVisible();
    expect(screen.getByText("资料审核通过")).toBeVisible();
    expect(screen.getByText("共 3 张照片")).toBeVisible();
    expect(screen.getByText("1 张通过，1 张审核中，1 张需调整")).toBeVisible();
    expect(screen.getByText("AI 分身已启用")).toBeVisible();
  });

  it("管理员和审核员都能看到符合身份的后台入口，普通用户看不到", async () => {
    setSuccessfulResponses("admin");
    const { unmount } = render(<MemoryRouter><MePage /></MemoryRouter>);

    expect(await screen.findByRole("link", { name: /完善婚恋资料/ })).toHaveAttribute("href", "/onboarding");
    expect(screen.getByRole("link", { name: /管理照片与建档/ })).toHaveAttribute("href", "/onboarding");
    expect(screen.getByRole("link", { name: /管理 AI 分身/ })).toHaveAttribute("href", "/me/avatar");
    expect(screen.getByRole("link", { name: /查看消息/ })).toHaveAttribute("href", "/messages");
    expect(screen.getByRole("link", { name: /进入匹配大厅/ })).toHaveAttribute("href", "/matchmaking");
    expect(screen.getByRole("link", { name: /管理员审核/ })).toHaveAttribute("href", "/admin/review");

    unmount();
    setSuccessfulResponses("moderator");
    const moderatorView = render(<MemoryRouter><MePage /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: /进入审核后台/ })).toHaveAttribute("href", "/admin/review");
    expect(screen.queryByRole("link", { name: /管理员审核/ })).not.toBeInTheDocument();

    moderatorView.unmount();
    setSuccessfulResponses("user");
    render(<MemoryRouter><MePage /></MemoryRouter>);
    await screen.findByRole("heading", { name: "林女士的账户中心" });
    expect(screen.queryByRole("link", { name: /管理员审核/ })).not.toBeInTheDocument();
  });

  it("展示黑名单并可以解除屏蔽", async () => {
    setSuccessfulResponses();
    vi.mocked(unblockUser).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<MemoryRouter><MePage /></MemoryRouter>);

    expect(await screen.findByText("周先生")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "解除对周先生的屏蔽" }));

    expect(unblockUser).toHaveBeenCalledWith("user-zhou");
    expect(await screen.findByText("已解除对周先生的屏蔽")).toBeVisible();
    expect(screen.queryByText("周先生")).not.toBeInTheDocument();
    expect(screen.getByText("黑名单中暂无用户")).toBeVisible();
  });

  it("未登录时明确引导登录且不显示演示资料", async () => {
    const authError = new ApiError("当前会话不可用。", "AUTH_REQUIRED", 401);
    vi.mocked(getMe).mockRejectedValue(authError);
    vi.mocked(getMyPhotos).mockRejectedValue(authError);
    vi.mocked(getAvatarProfile).mockRejectedValue(authError);
    vi.mocked(getBlocks).mockRejectedValue(authError);
    render(<MemoryRouter><MePage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "请先登录后查看账户中心" })).toBeVisible();
    expect(screen.getByRole("link", { name: "去登录" })).toHaveAttribute("href", "/auth");
    expect(screen.queryByText("40%")).not.toBeInTheDocument();
    expect(screen.queryByText("林女士")).not.toBeInTheDocument();
  });

  it("接口失败时显示原因并允许重新加载", async () => {
    vi.mocked(getMe).mockRejectedValueOnce(new Error("账户服务暂时不可用"));
    vi.mocked(getMyPhotos).mockResolvedValue({ items: [] });
    vi.mocked(getAvatarProfile).mockResolvedValue({ avatarProfile: null });
    vi.mocked(getBlocks).mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    render(<MemoryRouter><MePage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "账户信息读取失败" })).toBeVisible();
    expect(screen.getByText("账户服务暂时不可用")).toBeVisible();

    setSuccessfulResponses();
    await user.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("heading", { name: "林女士的账户中心" })).toBeVisible();
    expect(getMe).toHaveBeenCalledTimes(2);
  });

  it("照片、AI 分身和黑名单局部失败时保留账户主体并显示分区错误", async () => {
    vi.mocked(getMe).mockResolvedValue({
      user: { id: "user-admin", phoneMasked: "138****8000", role: "user", status: "active" },
      profile,
    });
    vi.mocked(getMyPhotos).mockRejectedValue(new Error("照片服务暂时不可用"));
    vi.mocked(getAvatarProfile).mockRejectedValue(new Error("AI 分身服务暂时不可用"));
    vi.mocked(getBlocks).mockRejectedValue(new Error("黑名单服务暂时不可用"));

    render(<MemoryRouter><MePage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "林女士的账户中心" })).toBeVisible();
    expect(screen.getByText("138****8000")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "账户信息读取失败" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert", { name: "照片状态读取失败" })).toHaveTextContent("照片服务暂时不可用");
    expect(screen.getByRole("alert", { name: "AI 分身状态读取失败" })).toHaveTextContent("AI 分身服务暂时不可用");
    expect(screen.getByRole("alert", { name: "黑名单读取失败" })).toHaveTextContent("黑名单服务暂时不可用");
  });
});
