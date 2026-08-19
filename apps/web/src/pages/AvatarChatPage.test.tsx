import "@testing-library/jest-dom/vitest";
import type { ChatRequest } from "@ai-marriage/shared";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarChatPage } from "./AvatarChatPage";

describe("AI 分身聊天", () => {
  let existingRequests: ChatRequest[];
  let avatarMessageResponse: Promise<Response> | null;
  let avatarSessions: Array<{
    id: string;
    memberId: string;
    status: "active" | "paused";
    completedTopicCount: number;
    canRequestChat: boolean;
  }>;

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    let topicCount = 0;
    existingRequests = [];
    avatarMessageResponse = null;
    avatarSessions = [{ id: "avatar_session_test", memberId: "lin-wanqing", status: "active", completedTopicCount: 0, canRequestChat: false }];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/members/lin-wanqing") && method === "GET") {
        return new Response(JSON.stringify({ data: { member: { id: "lin-wanqing", userId: "user-lin", nickname: "林婉清", gender: "女性", age: 45, city: "上海", district: "徐汇", job: "教育工作者", maritalStatus: "离异", goal: "认真交往", tags: ["生活规律"], introduction: "喜欢阅读和散步。", photoUrl: "/images/member-lin-v2.jpg", activeLabel: "今天活跃", verified: true } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/avatar-sessions") && method === "POST") {
        return new Response(JSON.stringify({ data: { session: { id: "avatar_session_test", completedTopicCount: 0, canRequestChat: false } } }), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/avatar-sessions") && method === "GET") {
        return new Response(JSON.stringify({ data: { items: avatarSessions } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/avatar-sessions/avatar_session_test/messages") && method === "GET") {
        return new Response(JSON.stringify({ data: { items: [] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/avatar-sessions/avatar_session_old/messages") && method === "GET") {
        return new Response(JSON.stringify({ data: { items: [
          { id: "old-user", sender: "user", text: "你平时喜欢什么活动？" },
          { id: "old-avatar", sender: "avatar", text: "授权资料中提到，TA 喜欢散步和阅读。" },
        ] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/avatar-sessions/avatar_session_test/analysis") && method === "GET") {
        return new Response(JSON.stringify({ data: { analysis: { readiness: topicCount >= 3 ? "ready" : "learning", canRequestChat: topicCount >= 3, completedTopics: Array.from({ length: topicCount }, (_, index) => `topic-${index}`), commonPoints: ["同城生活"], discussionTopics: ["未来生活安排"], summary: topicCount >= 3 ? "已经完成基础了解。" : `还需了解 ${3 - topicCount} 个主题。` } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/avatar-sessions/avatar_session_test/end") && method === "POST") {
        return new Response(JSON.stringify({ data: { session: { id: "avatar_session_test", status: "paused" } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/avatar-sessions/avatar_session_test/messages") && method === "POST") {
        if (avatarMessageResponse) return avatarMessageResponse;
        const body = JSON.parse(String(init?.body)) as { text: string };
        if (/周末|关系|沟通/.test(body.text)) topicCount = Math.min(topicCount + 1, 3);
        return new Response(JSON.stringify({ data: { messages: [{ id: `u-${topicCount}`, sender: "user", text: body.text }, { id: `a-${topicCount}`, sender: "avatar", text: "已收到，我可以继续介绍档案中授权公开的信息。" }], session: { completedTopicCount: topicCount, canRequestChat: topicCount >= 3 } } }), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/chat-requests") && method === "POST") {
        return new Response(JSON.stringify({ data: { request: { id: "request_test", status: "pending" } } }), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/chat-requests") && method === "GET") {
        return new Response(JSON.stringify({ data: { items: existingRequests } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/reports") && method === "POST") {
        return new Response(JSON.stringify({ data: { report: { id: "report-1", status: "pending" } } }), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "not found" } }), { status: 404, headers: { "Content-Type": "application/json" } });
    }));
  });

  function renderChat() {
    return render(
      <MemoryRouter initialEntries={["/matchmaking/lin-wanqing/chat"]}>
        <Routes>
          <Route path="/matchmaking/:memberId/chat" element={<AvatarChatPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("允许用户手动选择定位并把主题写入发送请求", async () => {
    const user = userEvent.setup();
    renderChat();

    await screen.findByText("林婉清的 AI 分身");
    await user.selectOptions(screen.getByLabelText("选择定位"), "relationship");
    await user.type(screen.getByLabelText("输入想了解的问题"), "你希望怎样的关系？");
    await user.click(screen.getByRole("button", { name: /发送/ }));

    const postCalls = vi.mocked(fetch).mock.calls.filter(([input, init]) => String(input).endsWith("/api/avatar-sessions/avatar_session_test/messages") && init?.method === "POST");
    expect(postCalls.length).toBeGreaterThan(0);
    expect(JSON.parse(String(postCalls.at(-1)?.[1]?.body))).toMatchObject({ topic: "relationship" });
  });

  it("为新发送的问题和回答提供可定位的消息标记", async () => {
    const user = userEvent.setup();
    const { container } = renderChat();

    await screen.findByText("林婉清的 AI 分身");
    await user.type(screen.getByLabelText("输入想了解的问题"), "周末怎么安排？");
    await user.click(screen.getByRole("button", { name: /发送/ }));

    const newMessages = container.querySelectorAll(".chat-bubble--new[data-chat-message='new']");
    expect(newMessages).toHaveLength(2);
    expect(newMessages[0]).toHaveAttribute("data-message-role", "user");
    expect(newMessages[1]).toHaveAttribute("data-message-role", "avatar");
  });

  it("发送后立即展示用户问题和 AI 回复状态", async () => {
    const user = userEvent.setup();
    let resolveReply!: (response: Response) => void;
    avatarMessageResponse = new Promise<Response>((resolve) => { resolveReply = resolve; });
    renderChat();

    await screen.findByText("林婉清的 AI 分身");
    await user.type(screen.getByLabelText("输入想了解的问题"), "周末怎么安排？");
    await user.click(screen.getByRole("button", { name: /发送/ }));

    expect(screen.getByText("周末怎么安排？")).toBeVisible();
    expect(screen.getByRole("status", { name: "AI 回复状态" })).toHaveTextContent("AI 分身正在回复");

    resolveReply(new Response(JSON.stringify({ data: { messages: [
      { id: "u-delayed", sender: "user", text: "周末怎么安排？" },
      { id: "a-delayed", sender: "avatar", text: "TA 周末通常会散步和阅读。" },
    ], session: { completedTopicCount: 1, canRequestChat: false } } }), { status: 201, headers: { "Content-Type": "application/json" } }));

    expect(await screen.findByText("TA 周末通常会散步和阅读。")).toBeVisible();
    expect(screen.queryByRole("status", { name: "AI 回复状态" })).not.toBeInTheDocument();
    expect(screen.getAllByText("周末怎么安排？")).toHaveLength(1);
  });

  it("AI 回复失败时保留问题并允许原地重试", async () => {
    const user = userEvent.setup();
    avatarMessageResponse = Promise.resolve(new Response(JSON.stringify({ error: { code: "AI_UNAVAILABLE", message: "AI 服务暂时不可用。" } }), { status: 503, headers: { "Content-Type": "application/json" } }));
    renderChat();

    await screen.findByText("林婉清的 AI 分身");
    await user.type(screen.getByLabelText("输入想了解的问题"), "你怎么看待家庭分工？");
    await user.click(screen.getByRole("button", { name: /发送/ }));

    expect(await screen.findByText("你怎么看待家庭分工？")).toBeVisible();
    const retryButton = await screen.findByRole("button", { name: "重新发送：你怎么看待家庭分工？" });
    expect(retryButton).toBeVisible();
    expect(screen.getByRole("status", { name: "AI 消息错误" })).toHaveTextContent("AI 服务暂时不可用");

    await user.click(retryButton);
    const messageCalls = vi.mocked(fetch).mock.calls.filter(([input, init]) => String(input).endsWith("/api/avatar-sessions/avatar_session_test/messages") && init?.method === "POST");
    expect(messageCalls).toHaveLength(2);
    const firstBody = JSON.parse(String(messageCalls[0]?.[1]?.body)) as { clientMessageId: string };
    const retryBody = JSON.parse(String(messageCalls[1]?.[1]?.body)) as { clientMessageId: string; retry?: boolean };
    expect(firstBody.clientMessageId).toMatch(/^optimistic-/);
    expect(retryBody.clientMessageId).toBe(firstBody.clientMessageId);
    expect(retryBody.retry).toBe(true);
  });

  it("会在聊天前给出个性化 AI 约会顾问建议，帮助用户更稳妥地推进关系", async () => {
    renderChat();

    await screen.findByText("林婉清的 AI 分身");

    const advisor = screen.getByRole("region", { name: /AI 约会顾问/i });
    expect(advisor).toBeVisible();
    expect(screen.getByText(/先从生活习惯和相处节奏开始/)).toBeVisible();
    expect(screen.getByRole("button", { name: /先问她周末怎么安排/ })).toBeVisible();
  });

  it("缺少心仪关系时可原地设为心仪并重新连接 AI 分身", async () => {
    const user = userEvent.setup();
    const baseFetch = vi.mocked(fetch).getMockImplementation();
    let interestCreated = false;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/avatar-sessions") && method === "POST" && !interestCreated) {
        return new Response(JSON.stringify({ error: { code: "INTEREST_REQUIRED", message: "请先将对方设为心仪对象。" } }), { status: 409, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/members/lin-wanqing/interest") && method === "POST") {
        interestCreated = true;
        return new Response(JSON.stringify({ data: { interest: { id: "interest-1", memberId: "lin-wanqing" } } }), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      return baseFetch!(input, init);
    });

    renderChat();

    expect(await screen.findByRole("heading", { name: "先设为心仪，再开始了解" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "设为心仪并继续" }));

    expect(await screen.findByText("林婉清的 AI 分身")).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.some(([input, init]) => String(input).endsWith("/api/members/lin-wanqing/interest") && init?.method === "POST")).toBe(true);
  });

  it("可以确认结束本次 AI 了解并停止继续提问", async () => {
    const user = userEvent.setup();
    renderChat();
    await screen.findByText("林婉清的 AI 分身");

    await user.click(screen.getByRole("button", { name: "结束本次了解" }));
    const dialog = screen.getByRole("dialog", { name: "确认结束本次了解" });
    expect(dialog).toHaveTextContent("聊天记录仍会保留");
    await user.click(screen.getByRole("button", { name: "确认结束了解" }));

    expect(await screen.findByRole("heading", { name: "本次了解已结束" })).toBeVisible();
    expect(screen.queryByLabelText("输入想了解的问题")).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([input, init]) => String(input).endsWith("/api/avatar-sessions/avatar_session_test/end") && init?.method === "POST")).toBe(true);
  });

  it("只在历史入口列出当前对象已经结束的了解轮次", async () => {
    const user = userEvent.setup();
    avatarSessions = [
      { id: "avatar_session_test", memberId: "lin-wanqing", status: "active", completedTopicCount: 0, canRequestChat: false },
      { id: "avatar_session_old", memberId: "lin-wanqing", status: "paused", completedTopicCount: 3, canRequestChat: true },
      { id: "avatar_session_other", memberId: "zhou-mingyuan", status: "paused", completedTopicCount: 2, canRequestChat: false },
    ];

    renderChat();
    await screen.findByText("林婉清的 AI 分身");
    await user.click(screen.getByRole("button", { name: "历史了解记录，共 1 轮" }));

    expect(screen.getByRole("region", { name: "历史了解记录" })).toBeVisible();
    expect(screen.getByRole("button", { name: /第 1 轮.*已结束/ })).toBeVisible();
    expect(screen.queryByText("avatar_session_other")).not.toBeInTheDocument();
  });

  it("历史轮次为只读状态并可返回当前轮次", async () => {
    const user = userEvent.setup();
    avatarSessions = [
      { id: "avatar_session_test", memberId: "lin-wanqing", status: "active", completedTopicCount: 0, canRequestChat: false },
      { id: "avatar_session_old", memberId: "lin-wanqing", status: "paused", completedTopicCount: 3, canRequestChat: true },
    ];

    renderChat();
    await screen.findByText("林婉清的 AI 分身");
    await user.click(screen.getByRole("button", { name: "历史了解记录，共 1 轮" }));
    await user.click(screen.getByRole("button", { name: /第 1 轮.*已结束/ }));

    expect(await screen.findByText("授权资料中提到，TA 喜欢散步和阅读。")).toBeVisible();
    expect(screen.getByRole("status", { name: "历史记录只读提示" })).toHaveTextContent("历史记录仅供查看，不能继续提问");
    expect(screen.queryByLabelText("输入想了解的问题")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "结束本次了解" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回当前了解" }));
    expect(await screen.findByLabelText("输入想了解的问题")).toBeVisible();
    expect(screen.queryByRole("status", { name: "历史记录只读提示" })).not.toBeInTheDocument();
  });

  it("举报历史回答时关联正在查看的历史轮次", async () => {
    const user = userEvent.setup();
    avatarSessions = [
      { id: "avatar_session_test", memberId: "lin-wanqing", status: "active", completedTopicCount: 0, canRequestChat: false },
      { id: "avatar_session_old", memberId: "lin-wanqing", status: "paused", completedTopicCount: 3, canRequestChat: true },
    ];

    renderChat();
    await screen.findByText("林婉清的 AI 分身");
    await user.click(screen.getByRole("button", { name: "历史了解记录，共 1 轮" }));
    await user.click(screen.getByRole("button", { name: /第 1 轮.*已结束/ }));
    await screen.findByText("授权资料中提到，TA 喜欢散步和阅读。");
    await user.click(screen.getByRole("button", { name: "举报 AI 回答" }));
    await user.click(screen.getByRole("button", { name: "提交举报" }));

    const reportCall = vi.mocked(fetch).mock.calls.find(([input, init]) => String(input).endsWith("/api/reports") && init?.method === "POST");
    expect(JSON.parse(String(reportCall?.[1]?.body))).toMatchObject({
      avatarSessionId: "avatar_session_old",
      messageId: "old-avatar",
    });
  });

  it("完成三个了解主题后可以申请与本人聊天", async () => {
    const user = userEvent.setup();
    renderChat();

    expect(await screen.findByRole("button", { name: "申请与本人聊天" })).toBeDisabled();
    const readiness = screen.getByRole("status", { name: "进一步了解进度" });
    expect(readiness).toHaveAttribute("data-readiness-state", "learning");
    expect(readiness).toHaveTextContent("已完成 0/3 个了解主题");

    for (const question of ["周末怎么安排？", "希望建立怎样的关系？", "沟通中最看重什么？"]) {
      await user.clear(screen.getByLabelText("输入想了解的问题"));
      await user.type(screen.getByLabelText("输入想了解的问题"), question);
      await user.click(screen.getByRole("button", { name: /发送/ }));
    }

    const requestButton = screen.getByRole("button", { name: "申请与本人聊天" });
    expect(requestButton).toBeEnabled();
    expect(readiness).toHaveAttribute("data-readiness-state", "ready");
    expect(readiness).toHaveTextContent("已完成 3/3 个了解主题");
    expect(screen.getByText(/可以申请与本人进一步聊天/)).toBeVisible();

    const fetchMock = vi.mocked(fetch);
    const requestCalls = () => fetchMock.mock.calls.filter(([input, init]) => String(input).endsWith("/api/chat-requests") && init?.method === "POST");
    await user.click(requestButton);
    expect(screen.getByRole("dialog", { name: "确认申请与本人聊天" })).toBeVisible();
    expect(screen.getByText("确认后会向林婉清本人发送聊天申请，对方可以选择同意或拒绝。")).toBeVisible();
    expect(requestCalls()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "确认发送申请" }));
    expect(screen.getByText("申请已发送，等待对方回应")).toBeVisible();
    expect(requestCalls()).toHaveLength(1);
  });

  it("刷新页面后恢复已发送的真人聊天申请状态", async () => {
    existingRequests = [{
      id: "request-existing",
      avatarSessionId: "avatar_session_test",
      fromUserId: "user-current",
      toUserId: "user-lin",
      memberId: "lin-wanqing",
      status: "pending",
      expiresAt: "2026-08-21T10:00:00.000Z",
      createdAt: "2026-08-14T10:00:00.000Z",
      updatedAt: "2026-08-14T10:00:00.000Z",
    }];

    renderChat();

    expect(await screen.findByText("申请已发送，等待对方回应")).toBeVisible();
    expect(screen.queryByRole("button", { name: "申请与本人聊天" })).not.toBeInTheDocument();
  });

  it("刷新页面后把已通过申请引导到真人聊天", async () => {
    existingRequests = [{
      id: "request-accepted",
      avatarSessionId: "avatar_session_test",
      fromUserId: "user-current",
      toUserId: "user-lin",
      memberId: "lin-wanqing",
      status: "accepted",
      expiresAt: "2026-08-21T10:00:00.000Z",
      createdAt: "2026-08-14T10:00:00.000Z",
      updatedAt: "2026-08-14T10:05:00.000Z",
    }];

    renderChat();

    expect(await screen.findByText("对方已同意，可以开始真人聊天")).toBeVisible();
    expect(screen.getByRole("link", { name: "进入真人聊天" })).toHaveAttribute("href", "/messages");
  });

  it("真人聊天申请过期后可以重新申请", async () => {
    existingRequests = [{
      id: "request-expired",
      avatarSessionId: "avatar_session_test",
      fromUserId: "user-current",
      toUserId: "user-lin",
      memberId: "lin-wanqing",
      status: "expired",
      expiresAt: "2026-08-13T10:00:00.000Z",
      createdAt: "2026-08-06T10:00:00.000Z",
      updatedAt: "2026-08-13T10:00:00.000Z",
    }];

    renderChat();

    expect(await screen.findByRole("button", { name: "申请与本人聊天" })).toBeVisible();
    expect(screen.queryByText("申请已发送，等待对方回应")).not.toBeInTheDocument();
  });

  it("不会根据提问次数猜测申请资格，只信任服务端分析", async () => {
    const user = userEvent.setup();
    renderChat();
    await screen.findByText("林婉清的 AI 分身");

    for (let index = 0; index < 3; index += 1) {
      await user.type(screen.getByLabelText("输入想了解的问题"), `你好 ${index}`);
      await user.click(screen.getByRole("button", { name: /发送/ }));
    }

    expect(screen.getByRole("button", { name: "申请与本人聊天" })).toBeDisabled();
  });

  it("举报弹窗打开后接管焦点并支持 Escape 关闭", async () => {
    const user = userEvent.setup();
    renderChat();
    await screen.findByText("林婉清的 AI 分身");

    const opener = screen.getByRole("button", { name: "举报回答" });
    await user.click(opener);

    expect(screen.getByRole("button", { name: "关闭举报窗口" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "举报 AI 回答" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("举报 AI 回答时携带当前会话和最近一条 AI 消息证据", async () => {
    const user = userEvent.setup();
    renderChat();
    await screen.findByText("林婉清的 AI 分身");
    await user.type(screen.getByLabelText("输入想了解的问题"), "周末怎么安排？");
    await user.click(screen.getByRole("button", { name: /发送/ }));
    await user.click(screen.getByRole("button", { name: "举报回答" }));
    await user.click(screen.getByRole("button", { name: "提交举报" }));
    expect(await screen.findByText(/举报已提交/)).toBeVisible();

    const reportCall = vi.mocked(fetch).mock.calls.find(([input, init]) => String(input).endsWith("/api/reports") && init?.method === "POST");
    expect(JSON.parse(String(reportCall?.[1]?.body))).toMatchObject({
      targetUserId: "user-lin",
      avatarSessionId: "avatar_session_test",
      messageId: "a-1",
    });
  });
});
