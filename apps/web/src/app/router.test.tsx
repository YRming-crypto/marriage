import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, useLocation, useRoutes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRoutes } from "./router";

vi.mock("../components/AppShell", () => ({
  AppShell: () => <Outlet />,
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authRequiredResponse() {
  return jsonResponse({ error: { code: "AUTH_REQUIRED", message: "当前会话不可用。" } }, 401);
}

function currentUserResponse(role: "user" | "moderator" | "admin", status: "active" | "suspended" | "deleted" = "active") {
  return jsonResponse({
    data: {
      user: {
        id: `${role}-1`,
        phoneMasked: "138****8000",
        role,
        status,
      },
      profile: null,
    },
  });
}

function RoutedApp() {
  const location = useLocation();
  return <>
    <output data-testid="route-location">{`${location.pathname}${location.search}${location.hash}`}</output>
    {useRoutes(appRoutes)}
  </>;
}

function renderRoute(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><RoutedApp /></MemoryRouter>);
}

describe("前端路由访问控制", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => authRequiredResponse()));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    ["个人中心", "/me"],
    ["建档", "/onboarding"],
    ["AI 分身", "/me/avatar"],
    ["消息", "/messages?tab=chats#latest"],
    ["真人聊天", "/matchmaking/lin-wanqing/chat"],
  ])("未登录访问%s时跳转登录并保留完整 next", async (_label, privatePath) => {
    renderRoute(privatePath);

    expect(await screen.findByRole("heading", { name: "登录缘来相伴" })).toBeVisible();
    await waitFor(() => {
      expect(screen.getByTestId("route-location")).toHaveTextContent(
        `/auth?next=${encodeURIComponent(privatePath)}`,
      );
    });
  });

  it.each([
    ["匹配大厅", "/find", "匹配大厅"],
    ["会员详情", "/member/member-zhou", "会员资料暂时无法显示"],
    ["专属推荐", "/matchmaking", "认真了解，从合适的人开始"],
  ])("未登录时仍可浏览公开%s", async (_label, publicPath, heading) => {
    renderRoute(publicPath);

    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
    expect(screen.getByTestId("route-location")).toHaveTextContent(publicPath);
  });

  it("注销清理后会话失效时按真实 401 契约作为匿名游客浏览公开大厅", async () => {
    localStorage.setItem("ai-marriage-auth-user", JSON.stringify({ id: "deleted-user", status: "deleted" }));
    renderRoute("/find");

    expect(await screen.findByRole("heading", { name: "匹配大厅" })).toBeVisible();
    expect(screen.getByTestId("route-location")).toHaveTextContent("/find");
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/me"))).toBe(true);
  });

  it("公开匹配路由确认会话发生网络错误时闭锁内容并支持重试", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(authRequiredResponse());

    renderRoute("/find");

    expect(await screen.findByRole("heading", { name: "暂时无法确认账号状态" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "匹配大厅" })).not.toBeInTheDocument();
    expect(screen.getByTestId("route-location")).toHaveTextContent("/find");

    await user.click(screen.getByRole("button", { name: "重新检查" }));
    expect(await screen.findByRole("heading", { name: "匹配大厅" })).toBeVisible();
  });

  it("公开匹配路由确认会话收到服务异常时显示可恢复状态", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      error: { code: "SERVICE_UNAVAILABLE", message: "账号服务暂时不可用。" },
    }, 503));

    renderRoute("/matchmaking");

    expect(await screen.findByRole("heading", { name: "暂时无法确认账号状态" })).toBeVisible();
    expect(screen.getByRole("button", { name: "重新检查" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "认真了解，从合适的人开始" })).not.toBeInTheDocument();
  });

  it.each([
    ["生活动态", "/moments", "从真实日常，了解真实的人"],
    ["线下活动", "/activities", "在公开、轻松的场合认识新朋友"],
    ["幸福案例", "/stories", "认真了解之后，关系才真正开始"],
    ["婚恋课堂", "/classroom", "把重要的话，提前想清楚"],
    ["安全中心", "/safety", "认真交往，安全始终放在前面"],
  ])("%s页面保持公开且不经过匹配账号守卫", async (_label, publicPath, heading) => {
    renderRoute(publicPath);

    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
    expect(screen.getByTestId("route-location")).toHaveTextContent(publicPath);
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/me"))).toBe(false);
  });

  it("普通用户访问后台时看到清晰的无权限页面且不会请求后台数据", async () => {
    localStorage.setItem("ai-marriage-auth-user", JSON.stringify({ id: "user-1", phoneMasked: "138****8000" }));
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/me")) return currentUserResponse("user");
      return jsonResponse({ error: { code: "ADMIN_REQUIRED", message: "需要管理员权限。" } }, 403);
    });

    renderRoute("/admin/review");

    expect(await screen.findByRole("heading", { name: "没有后台访问权限" })).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/api/admin/"))).toBe(false);
    expect(screen.getByRole("link", { name: "返回首页" })).toHaveAttribute("href", "/");
  });

  it("管理员可以进入后台路由", async () => {
    localStorage.setItem("ai-marriage-auth-user", JSON.stringify({ id: "admin-1", phoneMasked: "138****8000" }));
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/me")) return currentUserResponse("admin");
      if (url.endsWith("/api/admin/moderation")) return jsonResponse({ data: { profiles: [], photos: [] } });
      if (url.endsWith("/api/admin/reports")) return jsonResponse({ data: { items: [], total: 0 } });
      return jsonResponse({ data: {} });
    });

    renderRoute("/admin/review");

    expect(await screen.findByRole("heading", { name: "平台审核与运营管理" })).toBeVisible();
  });

  it("审核员可以进入后台路由并只看到审核入口", async () => {
    localStorage.setItem("ai-marriage-auth-user", JSON.stringify({ id: "moderator-1", phoneMasked: "138****8000" }));
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/me")) return currentUserResponse("moderator");
      if (url.endsWith("/api/admin/access")) return jsonResponse({ data: { required: false, verified: true, expiresAt: null } });
      if (url.endsWith("/api/admin/moderation")) return jsonResponse({ data: { profiles: [], photos: [] } });
      if (url.endsWith("/api/admin/reports")) return jsonResponse({ data: { items: [], total: 0 } });
      return jsonResponse({ error: { code: "ADMIN_REQUIRED", message: "需要管理员权限。" } }, 403);
    });

    renderRoute("/admin/review");

    expect(await screen.findByRole("tab", { name: /资料与照片/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /举报处理/ })).toBeVisible();
    expect(screen.queryByRole("tab", { name: /账号管理/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /申诉审核/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /内容发布/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /AI 任务/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /操作审计/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /系统运维/ })).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([input]) => /\/api\/admin\/(accounts|appeals|content|avatar-reply-failures|audit-logs|operations)/.test(String(input)))).toBe(false);
  });

  it("身份服务暂时不可用时提供重试，不把已保存账号误判为退出登录", async () => {
    localStorage.setItem("ai-marriage-auth-user", JSON.stringify({ id: "user-1", phoneMasked: "138****8000" }));
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    renderRoute("/messages");

    expect(await screen.findByRole("heading", { name: "暂时无法确认登录状态" })).toBeVisible();
    expect(screen.getByRole("button", { name: "重新检查" })).toBeVisible();
    expect(screen.getByTestId("route-location")).toHaveTextContent("/messages");
  });

  it.each([
    ["suspended", "/find"],
    ["suspended", "/member/member-zhou"],
    ["suspended", "/matchmaking"],
  ] as const)("%s 用户访问 %s 时转到账号安全页", async (accountStatus, businessPath) => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/me")) return currentUserResponse("user", accountStatus);
      if (url.endsWith("/api/me/sessions") || url.endsWith("/api/me/appeals") || url.endsWith("/api/me/data-exports")) {
        return jsonResponse({ data: { items: [] } });
      }
      if (url.includes("/api/members/member-zhou")) {
        return jsonResponse({ error: { code: "MEMBER_NOT_FOUND", message: "暂时找不到这位用户。" } }, 404);
      }
      if (url.includes("/api/members")) return jsonResponse({ data: { items: [], total: 0 } });
      if (url.includes("/api/recommendations")) return jsonResponse({ data: { items: [] } });
      if (url.includes("/api/me/interests")) return jsonResponse({ data: { sent: [], received: [], mutual: [] } });
      if (url.includes("/api/me/match-filters")) return jsonResponse({ data: { items: [] } });
      return jsonResponse({ data: {} });
    });

    renderRoute(businessPath);

    expect(await screen.findByRole("heading", { name: "账号与安全" })).toBeVisible();
    expect(screen.getByTestId("route-location")).toHaveTextContent("/me/security");
  });

  it("未知地址显示 404 页面并提供安全入口", async () => {
    renderRoute("/this-page-does-not-exist");

    expect(await screen.findByRole("heading", { name: "页面没有找到" })).toBeVisible();
    expect(screen.getByRole("link", { name: "返回首页" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "浏览匹配大厅" })).toHaveAttribute("href", "/find");
  });
});
