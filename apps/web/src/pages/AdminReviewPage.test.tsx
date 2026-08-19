import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, useRoutes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminReviewPage } from "./AdminReviewPage";

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });
}

function verifiedAccess() {
  return response({ required: true, verified: true, expiresAt: "2026-08-14T11:00:00Z" });
}

function operationsSummary(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: Date.parse("2026-08-14T10:00:00Z"),
    health: {
      status: "healthy",
      checkedAt: Date.parse("2026-08-14T10:00:00Z"),
      components: [{ name: "数据库", status: "healthy" }],
    },
    requests: {
      requestCount: 12,
      errorCount: 1,
      errorRate: 1 / 12,
      latencyMs: { min: 8, max: 80, average: 24, p50: 20, p95: 60, p99: 75 },
      routes: [],
    },
    maintenance: {
      runningCount: 0,
      succeededCount: 1,
      failedCount: 0,
      totalRemoved: 3,
      recentRuns: [],
    },
    recentErrors: [],
    ...overrides,
  };
}

function ModeratorReviewHarness() {
  return useRoutes([{
    element: <Outlet context={{ userRole: "moderator" }} />,
    children: [{ path: "*", element: <AdminReviewPage /> }],
  }]);
}

describe("管理员审核中心", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/admin/access") && method === "GET") return verifiedAccess();
      if (url.endsWith("/api/admin/moderation") && method === "GET") return response({ profiles: [{ userId: "user-1", nickname: "测试林女士", gender: "女性", birthYear: 1978, city: "上海", district: "徐汇", job: "教育", maritalStatus: "离异", goal: "认真交往", introduction: "希望认真认识彼此。", preference: {}, answers: {}, profileStatus: "pending_review", updatedAt: "2026-08-13T10:00:00Z" }], photos: [{ id: "photo-1", userId: "user-1", filename: "portrait.png", url: "data:image/png;base64,AAAA", objectKey: "local/photo", mimeType: "image/png", sizeBytes: 68, isPrimary: true, reviewStatus: "pending", reviewReason: null, createdAt: "2026-08-13T10:00:00Z", updatedAt: "2026-08-13T10:00:00Z" }] });
      if (url.endsWith("/api/admin/reports") && method === "GET") return response({ items: [{ id: "report-1", reporterUserId: "user-2", targetUserId: "user-1", reason: "其他", description: "请管理员查看", status: "pending", resolution: null, resolvedByUserId: null, createdAt: "2026-08-13T10:00:00Z", updatedAt: "2026-08-13T10:00:00Z" }] });
      if (url.endsWith("/approve") && method === "POST") return response({ profile: { userId: "user-1", profileStatus: "approved" }, member: { id: "member-user-1" } });
      if (url.endsWith("/resolve") && method === "POST") return response({ report: { id: "report-1", status: "resolved" } });
      return response({}, 200);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("展示资料、照片和举报队列并可处理", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "测试林女士" })).toBeVisible();
    expect(screen.getByAltText("测试林女士待审核照片")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "通过资料" }));
    expect(await screen.findByText("资料已通过")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: /举报处理/ }));
    await user.type(screen.getByLabelText("处理结果"), "已核查并完成处理。");
    await user.click(screen.getByRole("button", { name: "完成处理" }));
    expect(await screen.findByText("举报已处理")).toBeVisible();
  });

  it("需要后台二次验证时先校验访问码，再加载管理数据", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/admin/access") && method === "GET") return response({ required: true, verified: false, expiresAt: null });
      if (url.endsWith("/api/admin/access/verify") && method === "POST") return response({ verified: true, expiresAt: "2026-08-14T11:00:00Z" });
      if (url.endsWith("/api/admin/moderation") && method === "GET") return response({ profiles: [{ userId: "user-1", nickname: "验证后可见", gender: "女性", birthYear: 1978, city: "上海", district: "徐汇", job: "教育", maritalStatus: "离异", goal: "认真交往", introduction: "测试资料", preference: {}, answers: {}, profileStatus: "pending_review", updatedAt: "2026-08-13T10:00:00Z" }], photos: [] });
      if (url.endsWith("/api/admin/reports") && method === "GET") return response({ items: [] });
      return response({}, 404);
    });

    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "验证后台访问码" })).toBeVisible();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/admin/moderation"))).toBe(false);
    await user.type(screen.getByLabelText("后台访问码"), "654321");
    await user.click(screen.getByRole("button", { name: "进入管理后台" }));

    expect(await screen.findByText("验证后可见")).toBeVisible();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/api/admin/access/verify") && init?.method === "POST")).toBe(true);
  });

  it("后台访问码错误时保留输入入口并显示服务端提示", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/admin/access") && method === "GET") return response({ required: true, verified: false, expiresAt: null });
      if (url.endsWith("/api/admin/access/verify") && method === "POST") {
        return new Response(JSON.stringify({ error: { code: "ADMIN_ACCESS_CODE_INVALID", message: "后台访问码不正确。" } }), { status: 403, headers: { "Content-Type": "application/json" } });
      }
      return response({}, 404);
    });

    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    const input = await screen.findByLabelText("后台访问码");
    await user.type(input, "000000");
    await user.click(screen.getByRole("button", { name: "进入管理后台" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("后台访问码不正确");
    expect(input).toHaveValue("000000");
    expect(screen.getByRole("button", { name: "进入管理后台" })).toBeEnabled();
  });

  it("照片使用独立退回原因且空原因不会提交", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    await screen.findByRole("heading", { name: "测试林女士" });

    await user.type(screen.getByLabelText("拒绝原因"), "资料介绍需要补充");
    expect(screen.getByLabelText("照片退回原因：portrait.png")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "退回" }));

    expect(screen.getByRole("alert")).toHaveTextContent("请先填写照片退回原因。");
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/admin/photos/photo-1/reject"))).toBe(false);
  });

  it("照片退回提交中禁用操作，失败后保留原因并显示错误", async () => {
    const fetchMock = vi.mocked(fetch);
    const defaultImplementation = fetchMock.getMockImplementation()!;
    let resolveReject: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/admin/photos/photo-1/reject")) {
        return new Promise<Response>((resolve) => { resolveReject = resolve; });
      }
      return defaultImplementation(input, init);
    });
    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    const reasonInput = await screen.findByLabelText("照片退回原因：portrait.png");

    await user.type(reasonInput, "照片较模糊，请上传清晰正面照");
    await user.click(screen.getByRole("button", { name: "退回" }));

    expect(screen.getByRole("button", { name: "正在退回..." })).toBeDisabled();
    expect(reasonInput).toBeDisabled();
    await waitFor(() => expect(resolveReject).toBeDefined());
    resolveReject!(new Response(JSON.stringify({
      error: { code: "PHOTO_REVIEW_FAILED", message: "照片退回暂时失败。" },
    }), { status: 500, headers: { "Content-Type": "application/json" } }));

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法退回照片：照片退回暂时失败。");
    expect(reasonInput).toHaveValue("照片较模糊，请上传清晰正面照");
    expect(screen.getByRole("button", { name: "退回" })).toBeEnabled();
  });

  it("多张照片并发退回时分别保持忙碌状态", async () => {
    const fetchMock = vi.mocked(fetch);
    const resolvers = new Map<string, (response: Response) => void>();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/admin/access") && method === "GET") return Promise.resolve(response({ required: true, verified: true, expiresAt: "2026-08-14T11:00:00Z" }));
      if (url.endsWith("/api/admin/moderation") && method === "GET") return Promise.resolve(response({ profiles: [], photos: [
        { id: "photo-a", userId: "user-1", filename: "a.png", url: "data:image/png;base64,AAAA", objectKey: "a", mimeType: "image/png", sizeBytes: 68, isPrimary: true, reviewStatus: "pending", reviewReason: null, createdAt: "2026-08-13T10:00:00Z", updatedAt: "2026-08-13T10:00:00Z" },
        { id: "photo-b", userId: "user-1", filename: "b.png", url: "data:image/png;base64,BBBB", objectKey: "b", mimeType: "image/png", sizeBytes: 68, isPrimary: false, reviewStatus: "pending", reviewReason: null, createdAt: "2026-08-13T10:00:00Z", updatedAt: "2026-08-13T10:00:00Z" },
      ] }));
      if (url.endsWith("/api/admin/reports") && method === "GET") return Promise.resolve(response({ items: [] }));
      if (url.includes("/api/admin/photos/") && url.endsWith("/reject") && method === "POST") {
        const photoId = url.includes("photo-a") ? "photo-a" : "photo-b";
        return new Promise<Response>((resolve) => resolvers.set(photoId, resolve));
      }
      return Promise.resolve(response({}, 404));
    });

    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    const inputA = await screen.findByLabelText("照片退回原因：a.png");
    const inputB = screen.getByLabelText("照片退回原因：b.png");
    await user.type(inputA, "照片 A 需要重新上传");
    await user.type(inputB, "照片 B 需要重新上传");
    await user.click(within(inputA.closest("article")!).getByRole("button", { name: "退回" }));
    await user.click(within(inputB.closest("article")!).getByRole("button", { name: "退回" }));

    expect(inputA).toBeDisabled();
    expect(inputB).toBeDisabled();
    resolvers.get("photo-a")!(response({ photo: { id: "photo-a", reviewStatus: "rejected" } }));
    await waitFor(() => expect(screen.queryByLabelText("照片退回原因：a.png")).not.toBeInTheDocument());
    expect(screen.getByLabelText("照片退回原因：b.png")).toBeDisabled();
    resolvers.get("photo-b")!(response({ photo: { id: "photo-b", reviewStatus: "rejected" } }));
    await waitFor(() => expect(screen.queryByLabelText("照片退回原因：b.png")).not.toBeInTheDocument());
  });

  it("资料队列不可用时仍可读取和处理举报", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/admin/access")) return verifiedAccess();
      if (url.endsWith("/api/admin/moderation")) return response({}, 503);
      if (url.endsWith("/api/admin/reports")) return response({ items: [{ id: "report-2", reporterUserId: "user-2", targetUserId: "user-1", reason: "疑似虚假资料", description: "请复核资料", status: "pending", resolution: null, resolvedByUserId: null, createdAt: "2026-08-13T10:00:00Z", updatedAt: "2026-08-13T10:00:00Z" }] });
      return response({}, 404);
    });

    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    await user.click(await screen.findByRole("tab", { name: /举报处理/ }));
    expect(await screen.findByText("请复核资料")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("资料与照片队列暂时无法读取");
  });

  it("提供账号、申诉、内容、AI 任务、审计和运维入口", async () => {
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    await screen.findByRole("heading", { name: "测试林女士" });
    expect(screen.getByRole("tab", { name: /账号管理/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /申诉审核/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /内容发布/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /AI 任务/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /操作审计/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /系统运维/ })).toBeVisible();
  });

  it("审核员只看到资料、照片和举报审核且不请求管理员专属接口", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<MemoryRouter><ModeratorReviewHarness /></MemoryRouter>);

    expect(await screen.findByRole("tab", { name: /资料与照片/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /举报处理/ })).toBeVisible();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.queryByRole("tab", { name: /账号管理/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /申诉审核/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /内容发布/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /AI 任务/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /操作审计/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /系统运维/ })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => /\/api\/admin\/(accounts|appeals|content|avatar-reply-failures|audit-logs|operations)/.test(String(input)))).toBe(false);
  });

  it("照片审核项始终展示用户编号、上传时间和清晰的昵称兜底", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/admin/access")) return verifiedAccess();
      if (url.endsWith("/api/admin/moderation")) return response({ profiles: [], photos: [{
        id: "photo-without-profile",
        userId: "user-without-profile",
        filename: "standalone.png",
        url: "data:image/png;base64,AAAA",
        objectKey: "standalone",
        mimeType: "image/png",
        sizeBytes: 68,
        isPrimary: false,
        reviewStatus: "pending",
        reviewReason: null,
        createdAt: "2026-08-13T10:00:00Z",
        updatedAt: "2026-08-13T10:00:00Z",
      }] });
      if (url.endsWith("/api/admin/reports")) return response({ items: [] });
      return response({}, 404);
    });

    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);

    const card = (await screen.findByText("standalone.png")).closest("article");
    expect(card).not.toBeNull();
    expect(within(card!).getByText("昵称暂不可用")).toBeVisible();
    expect(within(card!).getByText(/用户 ID：user-without-profile/)).toBeVisible();
    expect(within(card!).getByText(/上传时间：/)).toBeVisible();
    expect(within(card!).getByText(/上传时间：/).querySelector("time")).toHaveAttribute("datetime", "2026-08-13T10:00:00Z");
  });

  it("展示脱敏的 AI 失败任务并可重新生成回复", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/admin/access") && method === "GET") return verifiedAccess();
      if (url.endsWith("/api/admin/moderation") && method === "GET") return response({ profiles: [], photos: [] });
      if (url.endsWith("/api/admin/reports") && method === "GET") return response({ items: [] });
      if (url.endsWith("/api/admin/avatar-reply-failures?page=1&pageSize=50") && method === "GET") return response({
        items: [{
          id: "failure-1",
          sessionId: "avatar-session-1",
          userMessageId: "user-message-1",
          memberId: "zhou-mingyuan",
          status: "pending",
          attempts: 1,
          lastError: "模型服务暂时不可用",
          resolvedMessageId: null,
          createdAt: "2026-08-14T10:00:00Z",
          updatedAt: "2026-08-14T10:00:00Z",
          resolvedAt: null,
          originalQuestion: "我的身份证号码是 310000000000000000",
        }],
        page: 1,
        pageSize: 50,
        total: 1,
        totalPages: 1,
      });
      if (url.endsWith("/api/admin/avatar-reply-failures/failure-1/retry") && method === "POST") return response({
        task: {
          id: "failure-1",
          sessionId: "avatar-session-1",
          userMessageId: "user-message-1",
          memberId: "zhou-mingyuan",
          status: "resolved",
          attempts: 2,
          lastError: null,
          resolvedMessageId: "avatar-message-1",
          createdAt: "2026-08-14T10:00:00Z",
          updatedAt: "2026-08-14T10:02:00Z",
          resolvedAt: "2026-08-14T10:02:00Z",
        },
        message: { id: "avatar-message-1", sender: "avatar", text: "已恢复的回复" },
      });
      return response({}, 404);
    });

    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    await user.click(await screen.findByRole("tab", { name: /AI 任务/ }));

    expect(await screen.findByRole("heading", { name: "AI 回复失败任务" })).toBeVisible();
    expect(screen.getByText("模型服务暂时不可用")).toBeVisible();
    expect(screen.queryByText(/身份证号码/)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/api/admin/avatar-reply-failures?page=1&pageSize=50") && (init?.method ?? "GET") === "GET")).toBe(true);

    await user.click(screen.getByRole("button", { name: "重新生成回复" }));

    expect(await screen.findByRole("status")).toHaveTextContent("AI 回复任务已恢复");
    expect(screen.getByText("已恢复", { selector: ".admin-status" })).toBeVisible();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/api/admin/avatar-reply-failures/failure-1/retry") && init?.method === "POST")).toBe(true);
  });

  it("账号停用只有在接口成功后才更新状态", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/admin/access") && method === "GET") return verifiedAccess();
      if (url.endsWith("/api/admin/moderation")) return response({ profiles: [], photos: [] });
      if (url.endsWith("/api/admin/reports")) return response({ items: [] });
      if (url.endsWith("/api/admin/accounts") && method === "GET") return response({ items: [{ id: "account-1", phoneMasked: "138****8000", status: "active", role: "user", profileCompleted: true, nickname: "周先生", city: "杭州", createdAt: "2026-08-13T10:00:00Z", lastLoginAt: "2026-08-14T10:00:00Z" }] });
      if (url.endsWith("/api/admin/accounts/account-1/suspend") && method === "POST") return response({ user: { id: "account-1", status: "suspended" } });
      return response({}, 404);
    });

    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    await user.click(await screen.findByRole("tab", { name: /账号管理/ }));
    expect(await screen.findByText("周先生")).toBeVisible();
    await user.type(screen.getByLabelText("账号处理原因"), "资料存在异常，需要人工复核");
    await user.click(screen.getByRole("button", { name: "停用账号" }));
    expect(await screen.findByText("账号已停用")).toBeVisible();
    expect(screen.getByText("已停用", { selector: ".admin-status" })).toBeVisible();
  });

  it("账号接口失败时明确提示且不伪装停用成功", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/admin/access") && method === "GET") return verifiedAccess();
      if (url.endsWith("/api/admin/moderation")) return response({ profiles: [], photos: [] });
      if (url.endsWith("/api/admin/reports")) return response({ items: [] });
      if (url.endsWith("/api/admin/accounts") && method === "GET") return response({ items: [{ id: "account-1", phoneMasked: "138****8000", status: "active", role: "user", profileCompleted: true, nickname: "周先生", city: "杭州", createdAt: "2026-08-13T10:00:00Z", lastLoginAt: null }] });
      if (url.endsWith("/api/admin/accounts/account-1/suspend") && method === "POST") return response({ message: "not implemented" }, 404);
      return response({}, 404);
    });

    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    await user.click(await screen.findByRole("tab", { name: /账号管理/ }));
    await screen.findByText("周先生");
    await user.type(screen.getByLabelText("账号处理原因"), "资料存在异常，需要人工复核");
    await user.click(screen.getByRole("button", { name: "停用账号" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法完成账号操作");
    expect(screen.getByText("使用中", { selector: ".admin-status" })).toBeVisible();
  });

  it("可审核申诉并在成功后更新处理结果", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/admin/access") && method === "GET") return verifiedAccess();
      if (url.endsWith("/api/admin/moderation")) return response({ profiles: [], photos: [] });
      if (url.endsWith("/api/admin/reports")) return response({ items: [] });
      if (url.endsWith("/api/admin/appeals") && method === "GET") return response({ items: [{ id: "appeal-1", userId: "account-1", reason: "希望重新检查账号状态", evidence: ["已补充资料"], status: "pending", resolution: null, createdAt: "2026-08-13T10:00:00Z", updatedAt: "2026-08-13T10:00:00Z" }] });
      if (url.endsWith("/api/admin/appeals/appeal-1/review") && method === "POST") return response({ appeal: { id: "appeal-1", status: "approved", resolution: "资料已复核" } });
      return response({}, 404);
    });

    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    await user.click(await screen.findByRole("tab", { name: /申诉审核/ }));
    expect(await screen.findByText("希望重新检查账号状态")).toBeVisible();
    await user.type(screen.getByLabelText("申诉处理说明"), "资料已复核");
    await user.click(screen.getByRole("button", { name: "通过申诉" }));
    expect(await screen.findByRole("status")).toHaveTextContent("申诉已通过");
  });

  it("可创建内容草稿并发布，失败时保留原状态", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/admin/access") && method === "GET") return verifiedAccess();
      if (url.endsWith("/api/admin/moderation")) return response({ profiles: [], photos: [] });
      if (url.endsWith("/api/admin/reports")) return response({ items: [] });
      if (url.endsWith("/api/admin/content") && method === "GET") return response({ items: [] });
      if (url.endsWith("/api/admin/content") && method === "POST") return response({ content: { id: "content-1", type: "article", status: "draft", title: "关系课堂", summary: "沟通方法", body: "正文内容", tags: ["沟通"], coverImageUrl: null, authorId: "admin", likeCount: 0, registrationCount: 0, event: null, createdAt: 1, updatedAt: 1, publishedAt: null, offlineAt: null } }, 201);
      if (url.endsWith("/api/admin/content/content-1/publish") && method === "POST") return response({ content: { id: "content-1", status: "published" } });
      return response({}, 404);
    });

    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    await user.click(await screen.findByRole("tab", { name: /内容发布/ }));
    await screen.findByRole("heading", { name: "新建内容" });
    await user.type(screen.getByLabelText("内容标题"), "关系课堂");
    await user.type(screen.getByLabelText("内容摘要"), "沟通方法");
    await user.type(screen.getByLabelText("内容正文"), "正文内容");
    await user.type(screen.getByLabelText("内容标签"), "沟通");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(await screen.findByText("草稿已保存")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "发布" }));
    expect(await screen.findByText("内容已发布")).toBeVisible();
  });

  it("审计或运维接口未接入时显示清晰空态", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    await user.click(await screen.findByRole("tab", { name: /操作审计/ }));
    expect(await screen.findByText("操作审计服务暂未接入")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: /系统运维/ }));
    expect(await screen.findByText("运维数据服务暂未接入")).toBeVisible();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
  });

  it("从管理员内容接口读取草稿和下线内容且刷新后仍然可见", async () => {
    const fetchMock = vi.mocked(fetch);
    let adminContentReads = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/admin/access") && method === "GET") return verifiedAccess();
      if (url.endsWith("/api/admin/moderation")) return response({ profiles: [], photos: [] });
      if (url.endsWith("/api/admin/reports")) return response({ items: [] });
      if (url.endsWith("/api/admin/content") && method === "GET") {
        adminContentReads += 1;
        return response({ items: [
          { id: "draft-1", type: "article", status: "draft", title: "待发布文章", summary: "草稿摘要", body: "草稿正文", tags: [], coverImageUrl: null, authorId: "admin", likeCount: 0, registrationCount: 0, event: null, createdAt: 1, updatedAt: 1, publishedAt: null, offlineAt: null },
          { id: "offline-1", type: "event", status: "offline", title: "已下线活动", summary: "活动摘要", body: "活动正文", tags: [], coverImageUrl: null, authorId: "admin", likeCount: 0, registrationCount: 0, event: null, createdAt: 1, updatedAt: 1, publishedAt: 1, offlineAt: 2 },
        ] });
      }
      if (url.includes("/api/content") && method === "GET") return response({ items: [] });
      return response({}, 404);
    });

    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    await user.click(await screen.findByRole("tab", { name: /内容发布/ }));
    expect(await screen.findByText("待发布文章")).toBeVisible();
    expect(screen.getByText("已下线活动")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(adminContentReads).toBe(2));
    expect(screen.getByText("待发布文章")).toBeVisible();
    expect(screen.getByText("已下线活动")).toBeVisible();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/content?"))).toBe(false);
  });

  it("清理任务失败时警告并展示最近执行结果和错误摘要", async () => {
    const fetchMock = vi.mocked(fetch);
    let operationsReads = 0;
    const failedRun = {
      id: "run-failed-1",
      taskName: "expired-resource-cleanup",
      actorId: "admin-1",
      status: "failed",
      startedAt: Date.parse("2026-08-14T09:00:00Z"),
      finishedAt: Date.parse("2026-08-14T09:00:01Z"),
      totalRemoved: 2,
      results: [{ target: "sessions", status: "failed", removedCount: 0, error: "会话存储暂时不可用" }],
    };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/admin/access") && method === "GET") return verifiedAccess();
      if (url.endsWith("/api/admin/moderation")) return response({ profiles: [], photos: [] });
      if (url.endsWith("/api/admin/reports")) return response({ items: [] });
      if (url.endsWith("/api/admin/operations") && method === "GET") {
        operationsReads += 1;
        return response(operationsReads === 1 ? operationsSummary() : operationsSummary({
          maintenance: { runningCount: 0, succeededCount: 1, failedCount: 1, totalRemoved: 5, recentRuns: [failedRun] },
          recentErrors: [{ id: 9, level: "error", event: "maintenance.cleanup.failed", occurredAt: failedRun.finishedAt, context: { runId: failedRun.id } }],
        }));
      }
      if (url.endsWith("/api/admin/operations/cleanup") && method === "POST") return response({ run: failedRun });
      return response({}, 404);
    });

    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    await user.click(await screen.findByRole("tab", { name: /系统运维/ }));
    await user.click(await screen.findByRole("button", { name: "执行安全清理" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("清理任务执行失败");
    expect(screen.queryByText(/清理任务已完成/)).not.toBeInTheDocument();
    expect(await screen.findByText("最近执行结果")).toBeVisible();
    expect(screen.getByText("过期资源清理")).toBeVisible();
    expect(screen.getByText("会话存储暂时不可用")).toBeVisible();
    expect(screen.getByText("最近错误摘要")).toBeVisible();
    expect(screen.getByText("maintenance.cleanup.failed")).toBeVisible();
    expect(screen.getByText(/runId.*run-failed-1/)).toBeVisible();
  });

  it("管理员账号和已注销账号不可操作", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/admin/access")) return verifiedAccess();
      if (url.endsWith("/api/admin/moderation")) return response({ profiles: [], photos: [] });
      if (url.endsWith("/api/admin/reports")) return response({ items: [] });
      if (url.endsWith("/api/admin/accounts")) return response({ items: [
        { id: "admin-1", phoneMasked: "138****0001", status: "active", role: "admin", profileCompleted: false, nickname: "平台管理员", city: null, createdAt: "2026-08-13T10:00:00Z", lastLoginAt: null },
        { id: "deleted-1", phoneMasked: "138****0002", status: "deleted", role: "user", profileCompleted: true, nickname: "已注销会员", city: "上海", createdAt: "2026-08-13T10:00:00Z", lastLoginAt: null },
        { id: "user-1", phoneMasked: "138****0003", status: "active", role: "user", profileCompleted: true, nickname: "普通会员", city: "杭州", createdAt: "2026-08-13T10:00:00Z", lastLoginAt: null },
      ] });
      return response({}, 404);
    });

    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    await user.click(await screen.findByRole("tab", { name: /账号管理/ }));
    const adminRow = (await screen.findByText("平台管理员")).closest("tr");
    const deletedRow = screen.getByText("已注销会员").closest("tr");
    expect(adminRow).not.toBeNull();
    expect(deletedRow).not.toBeNull();
    expect(within(adminRow!).getByText("管理员账号")).toBeVisible();
    expect(within(adminRow!).getByText("不可操作")).toBeVisible();
    expect(within(adminRow!).queryByRole("button")).not.toBeInTheDocument();
    expect(within(deletedRow!).getByText("不可操作")).toBeVisible();
    expect(within(deletedRow!).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "停用账号" })).toHaveLength(1);
  });

  it("举报卡展示双方摘要与证据投影并兼容字段缺失", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/admin/access")) return verifiedAccess();
      if (url.endsWith("/api/admin/moderation")) return response({ profiles: [], photos: [] });
      if (url.endsWith("/api/admin/reports")) return response({ items: [
        { id: "report-rich", reporterUserId: "user-a", targetUserId: "user-b", targetAvatarSessionId: null, targetConversationId: "conversation-ab", targetMessageId: "message-b", reason: "骚扰或不尊重", description: "请核查聊天内容", status: "pending", resolution: null, resolvedByUserId: null, createdAt: "2026-08-13T10:00:00Z", updatedAt: "2026-08-13T10:00:00Z", reporter: { userId: "user-a", nickname: "举报用户", city: "上海" }, target: { userId: "user-b", nickname: "被举报用户", city: "杭州" }, evidence: { source: "human_message", conversationId: "conversation-ab", messages: [{ id: "message-b", sender: "target", text: "需要核查的消息" }] } },
        { id: "report-basic", reporterUserId: "user-c", targetUserId: "user-d", targetAvatarSessionId: null, targetConversationId: null, targetMessageId: null, reason: "其他", description: "没有投影字段的举报", status: "resolved", resolution: "已记录", resolvedByUserId: "admin-1", createdAt: "2026-08-12T10:00:00Z", updatedAt: "2026-08-12T10:00:00Z" },
      ] });
      return response({}, 404);
    });

    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    await user.click(await screen.findByRole("tab", { name: /举报处理/ }));
    expect(await screen.findByText("举报用户 · 上海")).toBeVisible();
    expect(screen.getByText("被举报用户 · 杭州")).toBeVisible();
    expect(screen.getByText("真人消息证据")).toBeVisible();
    expect(screen.getByText("conversation-ab")).toBeVisible();
    expect(screen.getByText("需要核查的消息")).toBeVisible();
    expect(screen.getByText("没有投影字段的举报")).toBeVisible();
  });

  it("标签页关联面板并支持左右方向键导航", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);
    const moderationTab = await screen.findByRole("tab", { name: /资料与照片/ });
    const reportsTab = screen.getByRole("tab", { name: /举报处理/ });
    expect(moderationTab).toHaveAttribute("aria-controls", "admin-panel-moderation");
    expect(moderationTab).toHaveAttribute("tabindex", "0");
    expect(reportsTab).toHaveAttribute("tabindex", "-1");
    expect(await screen.findByRole("tabpanel", { name: /资料与照片/ })).toHaveAttribute("id", "admin-panel-moderation");

    moderationTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(reportsTab).toHaveFocus();
    expect(reportsTab).toHaveAttribute("aria-selected", "true");
    expect(reportsTab).toHaveAttribute("tabindex", "0");
    expect(moderationTab).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel", { name: /举报处理/ })).toHaveAttribute("id", "admin-panel-reports");

    await user.keyboard("{ArrowLeft}");
    expect(moderationTab).toHaveFocus();
    expect(moderationTab).toHaveAttribute("aria-selected", "true");
  });

  it("所有标签始终关联到页面中存在的面板", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AdminReviewPage /></MemoryRouter>);

    for (const item of await screen.findAllByRole("tab")) {
      const panelId = item.getAttribute("aria-controls");
      expect(panelId).toBeTruthy();
      expect(document.getElementById(panelId!)).not.toBeNull();
    }

    await user.click(screen.getByRole("tab", { name: /举报处理/ }));

    for (const item of screen.getAllByRole("tab")) {
      const panelId = item.getAttribute("aria-controls");
      expect(document.getElementById(panelId!)).not.toBeNull();
    }
  });
});
