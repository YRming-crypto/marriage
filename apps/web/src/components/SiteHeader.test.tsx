import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMe, getNotifications, logout } from "../api/client";
import { SiteHeader } from "./SiteHeader";

vi.mock("../api/client", () => ({
  getMe: vi.fn(),
  getNotifications: vi.fn(),
  logout: vi.fn(),
}));

function CurrentPath() {
  return <span data-testid="current-path">{useLocation().pathname}</span>;
}

function renderHeader(initialEntry = "/messages") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SiteHeader />
      <Routes>
        <Route path="*" element={<CurrentPath />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("网站页头会话状态", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(getMe).mockReset();
    vi.mocked(getNotifications).mockReset();
    vi.mocked(getNotifications).mockResolvedValue({ items: [], unreadCount: 0 });
    vi.mocked(logout).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("顶部定位可作为城市下拉菜单切换到对应筛选页", async () => {
    const user = userEvent.setup();
    vi.mocked(getMe).mockResolvedValue({
      user: { id: "user-1", phoneMasked: "138****8000", role: "user", status: "active" },
      profile: { nickname: "林女士" } as Awaited<ReturnType<typeof getMe>>["profile"],
    });

    renderHeader("/find?city=上海");

    const citySelect = await screen.findByLabelText("切换定位城市");
    await user.selectOptions(citySelect, "杭州");

    expect(screen.getByTestId("current-path")).toHaveTextContent("/find");
    expect(screen.getByRole("link", { name: /林女士/ })).toBeVisible();
  });

  it("登录后展示昵称，注销后清理本地摘要并返回首页", async () => {
    const user = userEvent.setup();
    vi.mocked(getMe).mockResolvedValue({
      user: { id: "user-1", phoneMasked: "138****8000", role: "user", status: "active" },
      profile: { nickname: "林女士" } as Awaited<ReturnType<typeof getMe>>["profile"],
    });
    vi.mocked(logout).mockResolvedValue(undefined);
    localStorage.setItem("ai-marriage-auth-user", "saved-account");
    sessionStorage.setItem("ai-marriage-auth-profile", "saved-profile");

    renderHeader();

    expect(await screen.findByRole("link", { name: /林女士/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "退出登录" }));

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(localStorage.getItem("ai-marriage-auth-user")).toBeNull();
    expect(sessionStorage.getItem("ai-marriage-auth-profile")).toBeNull();
    expect(screen.getByTestId("current-path")).toHaveTextContent("/");
    expect(screen.getByRole("link", { name: "登录" })).toBeVisible();
  });

  it("未登录时展示登录和免费加入入口", async () => {
    vi.mocked(getMe).mockRejectedValue(new Error("请先登录。"));

    renderHeader("/");

    expect(await screen.findByRole("link", { name: "登录" })).toHaveAttribute("href", "/auth");
    expect(screen.getByRole("link", { name: "免费加入" })).toHaveAttribute("href", "/onboarding");
    expect(getNotifications).not.toHaveBeenCalled();
  });

  it("退出失败时保留登录状态并显示可见反馈", async () => {
    const user = userEvent.setup();
    vi.mocked(getMe).mockResolvedValue({
      user: { id: "user-1", phoneMasked: "138****8000", role: "user", status: "active" },
      profile: { nickname: "林女士" } as Awaited<ReturnType<typeof getMe>>["profile"],
    });
    vi.mocked(logout).mockRejectedValue(new Error("退出服务暂时不可用"));
    localStorage.setItem("ai-marriage-auth-user", "saved-account");

    renderHeader();
    await user.click(await screen.findByRole("button", { name: "退出登录" }));

    expect(await screen.findByRole("alert", { name: "退出登录失败" })).toHaveTextContent("退出服务暂时不可用");
    expect(localStorage.getItem("ai-marriage-auth-user")).toBe("saved-account");
    expect(screen.getByTestId("current-path")).toHaveTextContent("/messages");
    expect(screen.getByRole("link", { name: /林女士/ })).toBeVisible();
  });

  it("登录后在消息入口显示消息、申请和系统通知的总未读数", async () => {
    vi.mocked(getMe).mockResolvedValue({
      user: { id: "user-1", phoneMasked: "138****8000", role: "user", status: "active" },
      profile: { nickname: "林女士" } as Awaited<ReturnType<typeof getMe>>["profile"],
    });
    vi.mocked(getNotifications).mockResolvedValue({ items: [], unreadCount: 7 });

    renderHeader("/");

    const messagesLink = await screen.findByRole("link", { name: "消息，7 条未读提醒" });
    expect(messagesLink).toHaveAttribute("href", "/messages");
    expect(messagesLink).toHaveTextContent("消息7");
    expect(getNotifications).toHaveBeenCalledOnce();
  });

  it("消息页标记全部已读后立即清除页头未读角标", async () => {
    vi.mocked(getMe).mockResolvedValue({
      user: { id: "user-1", phoneMasked: "138****8000", role: "user", status: "active" },
      profile: { nickname: "林女士" } as Awaited<ReturnType<typeof getMe>>["profile"],
    });
    vi.mocked(getNotifications).mockResolvedValue({ items: [], unreadCount: 2 });
    renderHeader("/messages");
    expect(await screen.findByRole("link", { name: "消息，2 条未读提醒" })).toBeVisible();

    window.dispatchEvent(new CustomEvent("ai-marriage-notifications-updated", { detail: { unreadCount: 0 } }));

    expect(await screen.findByRole("link", { name: "消息" })).toBeVisible();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });

  it("提醒读取失败时不打扰登录状态和导航", async () => {
    vi.mocked(getMe).mockResolvedValue({
      user: { id: "user-1", phoneMasked: "138****8000", role: "user", status: "active" },
      profile: { nickname: "林女士" } as Awaited<ReturnType<typeof getMe>>["profile"],
    });
    vi.mocked(getNotifications).mockRejectedValue(new Error("网络暂不可用"));

    renderHeader("/");

    expect(await screen.findByRole("link", { name: /林女士/ })).toBeVisible();
    expect(screen.getByRole("link", { name: "消息" })).toHaveAttribute("href", "/messages");
    expect(screen.queryByText(/条未读提醒/)).not.toBeInTheDocument();
  });
});
