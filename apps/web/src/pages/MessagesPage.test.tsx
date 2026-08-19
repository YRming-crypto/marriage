import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessagesPage } from "./MessagesPage";

const jsonHeaders = { "Content-Type": "application/json" };

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  readonly withCredentials: boolean;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn();
  private readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(url: string | URL, init?: EventSourceInit) {
    this.url = String(url);
    this.withCredentials = init?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = listener as (event: MessageEvent<string>) => void;
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  emit(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open() {
    this.onopen?.(new Event("open"));
  }

  fail() {
    this.onerror?.(new Event("error"));
  }
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status, headers: jsonHeaders });
}

function renderMessages() {
  return render(
    <MemoryRouter>
      <MessagesPage />
    </MemoryRouter>,
  );
}

function useActiveConversationApi({ failFirstSend = false } = {}) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  let sendAttempts = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.endsWith("/api/me")) return response({ user: { id: "user-me", phoneMasked: "138****0000" }, profile: null });
    if (url.endsWith("/api/members")) return response({ items: [{ id: "member-lin", userId: "user-other", nickname: "林婉清", age: 45, photoUrl: "/images/member-lin-v2.jpg" }], total: 1 });
    if (url.endsWith("/api/chat-requests")) return response({ items: [{ id: "request-1", avatarSessionId: "avatar-1", fromUserId: "user-me", toUserId: "user-other", memberId: "member-lin", status: "accepted", createdAt: "2026-08-13T08:00:00.000Z", updatedAt: "2026-08-13T08:00:00.000Z" }] });
    if (url.endsWith("/api/conversations")) return response({ items: [{ id: "conversation-1", chatRequestId: "request-1", participantIds: ["user-me", "user-other"], status: "active", createdAt: "2026-08-13T08:00:00.000Z" }] });
    if (url.endsWith("/api/conversations/conversation-1/messages") && method === "GET") return response({ items: [] });
    if (url.endsWith("/api/conversations/conversation-1/messages") && method === "POST") {
      sendAttempts += 1;
      if (failFirstSend && sendAttempts === 1) return new Response(JSON.stringify({ error: { code: "TEMPORARY_FAILURE", message: "网络暂时不可用" } }), { status: 503, headers: jsonHeaders });
      const body = JSON.parse(String(init?.body)) as { text: string; clientMessageId: string };
      return response({ message: { id: "message-new", conversationId: "conversation-1", senderId: "user-me", text: body.text, clientMessageId: body.clientMessageId, createdAt: "2026-08-13T08:02:00.000Z" } }, 201);
    }
    if (url.endsWith("/read")) return response({ readCount: 0, readAt: "2026-08-13T08:01:00.000Z" });
    if (url.endsWith("/typing")) return new Response(null, { status: 204 });
    return response({});
  }));
  return calls;
}

describe("消息中心", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/me")) return response({ user: { id: "user-me", phoneMasked: "138****0000" }, profile: null });
      if (url.endsWith("/api/members")) return response({ items: [{ id: "member-lin", userId: "user-other", nickname: "林婉清", age: 45, photoUrl: "/images/member-lin-v2.jpg" }], total: 1 });
      if (url.endsWith("/api/chat-requests")) return response({ items: [{ id: "request-1", avatarSessionId: "avatar-1", fromUserId: "user-other", toUserId: "user-me", memberId: "member-lin", status: "pending", createdAt: "2026-08-13T08:00:00.000Z", updatedAt: "2026-08-13T08:00:00.000Z" }] });
      if (url.endsWith("/api/conversations")) return response({ items: [] });
      if (method === "POST" && url.endsWith("/api/chat-requests/request-1/accept")) return response({ request: { id: "request-1", status: "accepted" }, conversation: { id: "conversation-1", chatRequestId: "request-1", participantIds: ["user-me", "user-other"], status: "active", createdAt: "2026-08-13T08:00:00.000Z" } });
      if (method === "POST" && url.endsWith("/api/chat-requests/request-1/reject")) return response({ request: { id: "request-1", status: "rejected" } });
      if (method === "POST" && url.endsWith("/api/notifications/notice-1/read")) return response({ notification: { id: "notice-1", readAt: "2026-08-13T08:05:00.000Z" } });
      if (url.endsWith("/api/notifications")) return response({ items: [
        { id: "notice-1", userId: "user-me", type: "chat_request_received", title: "收到聊天申请", body: "有人希望与你聊天。", relatedResourceType: "chat_request", relatedResourceId: "request-1", readAt: null, createdAt: "2026-08-13T08:00:00.000Z" },
        { id: "notice-2", userId: "user-me", type: "profile_reviewed", title: "资料审核通过", body: "你的资料已通过审核。", relatedResourceType: "profile", relatedResourceId: "user-me", readAt: "2026-08-13T08:04:00.000Z", createdAt: "2026-08-13T08:04:00.000Z" },
      ], unreadCount: 1 });
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "not found" } }), { status: 404, headers: jsonHeaders });
    }));
  });

  it("登录后加载真实申请，接受申请后刷新真人会话", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    const acceptCalls = () => fetchMock.mock.calls.filter(([input, init]) => String(input).endsWith("/api/chat-requests/request-1/accept") && init?.method === "POST");
    renderMessages();

    expect(await screen.findByText("收到新的聊天申请")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "同意聊天" }));
    expect(screen.getByRole("dialog", { name: "确认同意聊天" })).toBeVisible();
    expect(screen.getByText("确认后，你和对方都可以进入真人聊天并互相发送消息。")).toBeVisible();
    expect(acceptCalls()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "确认同意聊天" }));
    expect(await screen.findByRole("status", { name: "聊天申请状态" })).toHaveTextContent("已同意，可以聊天");
    expect(acceptCalls()).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: "真人聊天" }));
    expect(await screen.findByRole("button", { name: "进入聊天" })).toBeVisible();
  });

  it("明确展示已过期申请且不允许继续处理", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/me")) return response({ user: { id: "user-me", phoneMasked: "138****0000" }, profile: null });
      if (url.endsWith("/api/members")) return response({ items: [{ id: "member-lin", userId: "user-other", nickname: "林婉清", age: 45, photoUrl: "/images/member-lin-v2.jpg" }], total: 1 });
      if (url.endsWith("/api/chat-requests")) return response({ items: [{ id: "request-expired", avatarSessionId: "avatar-1", fromUserId: "user-other", toUserId: "user-me", memberId: "member-lin", status: "expired", expiresAt: "2026-08-13T08:00:00.000Z", createdAt: "2026-08-06T08:00:00.000Z", updatedAt: "2026-08-13T08:00:00.000Z" }] });
      if (url.endsWith("/api/conversations")) return response({ items: [] });
      if (url.endsWith("/api/notifications")) return response({ items: [], unreadCount: 0 });
      return response({});
    }));

    renderMessages();

    expect(await screen.findByText("聊天申请已过期")).toBeVisible();
    expect(screen.getByText("超过 7 天未处理，本次申请已自动结束。")).toBeVisible();
    expect(screen.getByText("已过期")).toBeVisible();
    expect(screen.queryByRole("button", { name: "同意聊天" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "暂不聊天" })).not.toBeInTheDocument();
  });

  it("进入真实会话后加载历史并用 clientMessageId 发送消息", async () => {
    const user = userEvent.setup();
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/api/me")) return response({ user: { id: "user-me", phoneMasked: "138****0000" }, profile: null });
      if (url.endsWith("/api/members")) return response({ items: [{ id: "member-lin", nickname: "林婉清", age: 45, photoUrl: "/images/member-lin-v2.jpg" }], total: 1 });
      if (url.endsWith("/api/chat-requests")) return response({ items: [{ id: "request-1", avatarSessionId: "avatar-1", fromUserId: "user-me", toUserId: "user-other", memberId: "member-lin", status: "accepted", createdAt: "2026-08-13T08:00:00.000Z", updatedAt: "2026-08-13T08:00:00.000Z" }] });
      if (url.endsWith("/api/conversations")) return response({ items: [{ id: "conversation-1", chatRequestId: "request-1", participantIds: ["user-me", "user-other"], status: "active", createdAt: "2026-08-13T08:00:00.000Z" }] });
      if (url.endsWith("/api/conversations/conversation-1/messages") && method === "GET") return response({ items: [{ id: "message-history", conversationId: "conversation-1", senderId: "user-other", text: "你好，很高兴认识你。", clientMessageId: null, createdAt: "2026-08-13T08:01:00.000Z" }] });
      if (url.endsWith("/api/conversations/conversation-1/messages") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { text: string; clientMessageId: string };
        return response({ message: { id: "message-new", conversationId: "conversation-1", senderId: "user-me", text: body.text, clientMessageId: body.clientMessageId, createdAt: "2026-08-13T08:02:00.000Z" } }, 201);
      }
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "not found" } }), { status: 404, headers: jsonHeaders });
    }));

    renderMessages();
    await user.click(await screen.findByRole("tab", { name: "真人聊天" }));
    await user.click(await screen.findByRole("button", { name: "进入聊天" }));

    expect(await within(screen.getByRole("log", { name: "真人聊天记录" })).findByText("你好，很高兴认识你。")).toBeVisible();
    await user.type(screen.getByLabelText("给对方留言"), "周末一起喝茶吗？");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    expect(await screen.findByText("周末一起喝茶吗？")).toBeVisible();
    const sendCall = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/conversations/conversation-1/messages"));
    expect(sendCall?.body).toMatchObject(expect.stringContaining('"clientMessageId":"conversation-1-'));
  });

  it("发送失败后重试同一正文会复用 clientMessageId", async () => {
    const user = userEvent.setup();
    const calls = useActiveConversationApi({ failFirstSend: true });
    renderMessages();
    await user.click(await screen.findByRole("tab", { name: "真人聊天" }));
    await user.click(await screen.findByRole("button", { name: "进入聊天" }));
    await user.type(await screen.findByLabelText("给对方留言"), "网络恢复后重试这条消息");

    await user.click(screen.getByRole("button", { name: "发送消息" }));
    expect(await screen.findByText("网络暂时不可用")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "发送消息" }));
    expect(await screen.findByText("网络恢复后重试这条消息")).toBeVisible();

    const sentBodies = calls
      .filter((call) => call.method === "POST" && call.url.endsWith("/api/conversations/conversation-1/messages"))
      .map((call) => JSON.parse(call.body ?? "{}") as { clientMessageId: string });
    expect(sentBodies).toHaveLength(2);
    expect(sentBodies[1].clientMessageId).toBe(sentBodies[0].clientMessageId);
  });

  it("礼貌问候和破冰建议可以快捷填入且仍可编辑", async () => {
    const user = userEvent.setup();
    useActiveConversationApi();
    renderMessages();
    await user.click(await screen.findByRole("tab", { name: "真人聊天" }));
    await user.click(await screen.findByRole("button", { name: "进入聊天" }));

    const draft = await screen.findByLabelText("给对方留言");
    await user.click(screen.getByRole("button", { name: "使用问候语：你好，很高兴认识你。" }));
    expect(draft).toHaveValue("你好，很高兴认识你。");

    await user.click(screen.getByRole("button", { name: "使用破冰建议：平时周末你喜欢怎么安排？" }));
    expect(draft).toHaveValue("平时周末你喜欢怎么安排？");
    await user.type(draft, " 我比较喜欢散步。");
    expect(draft).toHaveValue("平时周末你喜欢怎么安排？ 我比较喜欢散步。");
  });

  it("输入联系方式时即时提示风险但仍允许正常发送", async () => {
    const user = userEvent.setup();
    const calls = useActiveConversationApi();
    renderMessages();
    await user.click(await screen.findByRole("tab", { name: "真人聊天" }));
    await user.click(await screen.findByRole("button", { name: "进入聊天" }));

    const sensitiveMessage = "可以加微信或打电话继续了解。";
    await user.type(await screen.findByLabelText("给对方留言"), sensitiveMessage);
    const warning = screen.getByRole("alert", { name: "聊天安全提醒" });
    expect(warning).toHaveTextContent("微信");
    expect(warning).toHaveTextContent("电话");

    const sendButton = screen.getByRole("button", { name: "发送消息" });
    expect(sendButton).toBeEnabled();
    await user.click(sendButton);

    expect(await screen.findByText(sensitiveMessage)).toBeVisible();
    const sendCall = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/conversations/conversation-1/messages"));
    expect(JSON.parse(sendCall?.body ?? "{}")).toMatchObject({ text: sensitiveMessage });
    expect(screen.queryByRole("alert", { name: "聊天安全提醒" })).not.toBeInTheDocument();
  });

  it("输入资金风险内容时说明原因并禁止发送", async () => {
    const user = userEvent.setup();
    const calls = useActiveConversationApi();
    renderMessages();
    await user.click(await screen.findByRole("tab", { name: "真人聊天" }));
    await user.click(await screen.findByRole("button", { name: "进入聊天" }));

    await user.type(await screen.findByLabelText("给对方留言"), "请先转账到这张银行卡。 ");

    const warning = screen.getByRole("alert", { name: "聊天安全提醒" });
    expect(warning).toHaveTextContent("涉及资金的内容无法发送");
    expect(warning).toHaveTextContent("银行卡");
    expect(warning).toHaveTextContent("转账");
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/conversations/conversation-1/messages"))).toBe(false);
  });

  it("会话列表展示最后消息和未读数，聊天记录按日期分组并显示时间", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/me")) return response({ user: { id: "user-me", phoneMasked: "138****0000" }, profile: null });
      if (url.endsWith("/api/members")) return response({ items: [{ id: "member-lin", userId: "user-other", nickname: "林婉清", age: 45, photoUrl: "/images/member-lin-v2.jpg" }], total: 1 });
      if (url.endsWith("/api/chat-requests")) return response({ items: [{ id: "request-1", avatarSessionId: "avatar-1", fromUserId: "user-me", toUserId: "user-other", memberId: "member-lin", status: "accepted", createdAt: "2026-08-13T08:00:00.000Z", updatedAt: "2026-08-13T08:00:00.000Z" }] });
      if (url.endsWith("/api/conversations")) return response({ items: [{
        id: "conversation-1",
        chatRequestId: "request-1",
        participantIds: ["user-me", "user-other"],
        status: "active",
        createdAt: "2026-08-13T08:00:00.000Z",
        lastMessage: { text: "晚安，明天再聊。", senderId: "user-other", createdAt: "2026-08-14T08:10:00.000Z" },
        unreadCount: 2,
      }] });
      if (url.endsWith("/api/conversations/conversation-1/messages") && method === "GET") return response({ items: [
        { id: "message-day-one", conversationId: "conversation-1", senderId: "user-me", text: "昨天的消息", clientMessageId: "client-1", createdAt: "2026-08-13T08:01:00.000Z" },
        { id: "message-day-two", conversationId: "conversation-1", senderId: "user-other", text: "晚安，明天再聊。", clientMessageId: null, createdAt: "2026-08-14T08:10:00.000Z" },
      ] });
      if (url.endsWith("/api/conversations/conversation-1/read") && method === "POST") return response({ readCount: 2, readAt: "2026-08-14T08:11:00.000Z" });
      return response({});
    }));

    renderMessages();
    await user.click(await screen.findByRole("tab", { name: "真人聊天" }));

    expect(await screen.findByText("晚安，明天再聊。")).toBeVisible();
    expect(screen.getByLabelText("2 条未读消息")).toBeVisible();
    expect(screen.getByText("16:10")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "进入聊天" }));
    expect(await screen.findByText("2026年8月13日")).toBeVisible();
    expect(screen.getByText("2026年8月14日")).toBeVisible();
    expect(screen.getByText("16:01")).toBeVisible();
    expect(screen.getAllByText("16:10").length).toBeGreaterThanOrEqual(1);
  });

  it("真人聊天中可以举报并屏蔽对方，屏蔽后停止发送", async () => {
    const user = userEvent.setup();
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/api/me")) return response({ user: { id: "user-me", phoneMasked: "138****0000" }, profile: null });
      if (url.endsWith("/api/members")) return response({ items: [{ id: "member-lin", userId: "user-other", nickname: "林婉清", age: 45, photoUrl: "/images/member-lin-v2.jpg" }], total: 1 });
      if (url.endsWith("/api/chat-requests")) return response({ items: [{ id: "request-1", avatarSessionId: "avatar-1", fromUserId: "user-me", toUserId: "user-other", memberId: "member-lin", status: "accepted", createdAt: "2026-08-13T08:00:00.000Z", updatedAt: "2026-08-13T08:00:00.000Z" }] });
      if (url.endsWith("/api/conversations")) return response({ items: [{ id: "conversation-1", chatRequestId: "request-1", participantIds: ["user-me", "user-other"], status: "active", createdAt: "2026-08-13T08:00:00.000Z" }] });
      if (url.endsWith("/api/conversations/conversation-1/messages")) return response({ items: [{ id: "message-evidence", conversationId: "conversation-1", senderId: "user-other", text: "请先转一笔保证金。", clientMessageId: null, createdAt: "2026-08-13T08:01:00.000Z" }] });
      if (url.endsWith("/api/reports") && method === "POST") return response({ report: { id: "report-1", status: "pending" } }, 201);
      if (url.endsWith("/api/users/user-other/block") && method === "POST") return response({ block: { id: "block-1" } }, 201);
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "not found" } }), { status: 404, headers: jsonHeaders });
    }));

    renderMessages();
    await user.click(await screen.findByRole("tab", { name: "真人聊天" }));
    await user.click(await screen.findByRole("button", { name: "进入聊天" }));
    await user.click(screen.getByRole("button", { name: "举报对方" }));
    await user.type(screen.getByLabelText("举报情况说明"), "聊天中多次诱导转账");
    await user.click(screen.getByRole("button", { name: "提交举报" }));
    expect(await screen.findByRole("status")).toHaveTextContent("举报已提交");

    await user.click(screen.getByRole("button", { name: "屏蔽对方" }));
    await user.click(screen.getByRole("button", { name: "确认屏蔽" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已屏蔽对方");
    expect(screen.getAllByText("这段聊天已停止").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByLabelText("给对方留言")).not.toBeInTheDocument();
    const reportCall = calls.find((call) => call.url.endsWith("/api/reports") && call.method === "POST");
    expect(JSON.parse(reportCall?.body ?? "{}")).toMatchObject({
      targetUserId: "user-other",
      conversationId: "conversation-1",
      messageId: "message-evidence",
    });
    expect(calls.some((call) => call.url.endsWith("/api/users/user-other/block") && call.method === "POST")).toBe(true);
  });

  it("API 不可用时显示清晰提示，不展示演示申请", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      return new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "当前会话不可用。" } }), { status: 401, headers: jsonHeaders });
    }));
    renderMessages();

    expect(await screen.findByRole("status", { name: "消息中心状态" })).toHaveTextContent("请先登录后查看申请和真人聊天");
    expect(screen.queryByText("收到新的聊天申请")).not.toBeInTheDocument();
  });

  it("支持用方向键切换消息分类", async () => {
    const user = userEvent.setup();
    renderMessages();
    const requestTab = await screen.findByRole("tab", { name: /聊天申请/ });
    requestTab.focus();
    await user.keyboard("{ArrowRight}");

    const chatTab = screen.getByRole("tab", { name: "真人聊天" });
    expect(chatTab).toHaveFocus();
    expect(chatTab).toHaveAttribute("aria-selected", "true");
  });

  it("可以拒绝聊天申请并在系统通知查看真实通知", async () => {
    const user = userEvent.setup();
    renderMessages();
    await user.click(await screen.findByRole("button", { name: "暂不聊天" }));
    const dialog = screen.getByRole("dialog", { name: "确认暂不聊天" });
    expect(within(dialog).getByText(/确认后，本次聊天申请会结束/)).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.some(([input, init]) => String(input).endsWith("/api/chat-requests/request-1/reject") && init?.method === "POST")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "确认暂不聊天" }));
    expect(await screen.findByText("已婉拒申请")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: /系统通知/ }));
    expect(await screen.findByText("收到聊天申请")).toBeVisible();
    expect(screen.getByText("有人希望与你聊天。")).toBeVisible();
  });

  it("通知单独加载失败时显示原因并可只重试通知", async () => {
    const user = userEvent.setup();
    let notificationAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/me")) return response({ user: { id: "user-me", phoneMasked: "138****0000" }, profile: null });
      if (url.endsWith("/api/members")) return response({ items: [], total: 0 });
      if (url.endsWith("/api/chat-requests")) return response({ items: [] });
      if (url.endsWith("/api/conversations")) return response({ items: [] });
      if (url.endsWith("/api/notifications")) {
        notificationAttempts += 1;
        if (notificationAttempts === 1) return new Response(JSON.stringify({ error: { code: "TEMPORARY_FAILURE", message: "通知服务暂时不可用" } }), { status: 503, headers: jsonHeaders });
        return response({ items: [{ id: "notice-recovered", userId: "user-me", type: "profile_reviewed", title: "资料审核通过", body: "你的资料已通过审核。", relatedResourceType: "profile", relatedResourceId: "user-me", readAt: null, createdAt: "2026-08-14T08:00:00.000Z" }], unreadCount: 1 });
      }
      return response({});
    }));

    renderMessages();
    await user.click(await screen.findByRole("tab", { name: "系统通知" }));

    expect(screen.getByRole("alert", { name: "系统通知加载失败" })).toHaveTextContent("通知服务暂时不可用");
    expect(screen.queryByRole("heading", { name: "暂时没有系统通知" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重新加载通知" }));

    expect(await screen.findByText("资料审核通过")).toBeVisible();
    expect(notificationAttempts).toBe(2);
  });

  it("单条通知可标记已读并直达关联资源", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    renderMessages();
    await user.click(await screen.findByRole("tab", { name: /系统通知/ }));

    expect(screen.getByRole("link", { name: "查看婚恋资料" })).toHaveAttribute("href", "/onboarding");
    await user.click(screen.getByRole("button", { name: "查看聊天申请" }));

    expect(screen.getByRole("tab", { name: /聊天申请/ })).toHaveAttribute("aria-selected", "true");
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/api/notifications/notice-1/read") && init?.method === "POST")).toBe(true);
    expect(screen.getByRole("tab", { name: /系统通知/ })).not.toHaveTextContent("1");
  });

  it("使用配置的 API 地址连接 SSE，并在三类实时事件到达时刷新消息中心", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.test/");
    const fetchMock = vi.mocked(fetch);
    renderMessages();

    await screen.findByText("收到新的聊天申请");
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    expect(MockEventSource.instances[0]).toMatchObject({
      url: "https://api.example.test/api/realtime/events",
      withCredentials: true,
    });

    for (const [type, data] of [
      ["message.created", { conversationId: "conversation-1" }],
      ["message.recalled", { conversationId: "conversation-1" }],
      ["notification.created", { notification: { id: "notice-2" } }],
      ["conversation.updated", { conversationId: "conversation-1" }],
    ] as const) {
      const callsBeforeEvent = fetchMock.mock.calls.length;
      MockEventSource.instances[0].emit(type, data);
      await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeEvent));
    }
  });

  it("实时连接断开后显示提示并用 HTTP 轮询刷新历史", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = vi.mocked(fetch);
    renderMessages();
    await user.click(await screen.findByRole("tab", { name: "真人聊天" }));

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/me")) return response({ user: { id: "user-me", phoneMasked: "138****0000" }, profile: null });
      if (url.endsWith("/api/members")) return response({ items: [{ id: "member-lin", userId: "user-other", nickname: "林婉清", age: 45 }], total: 1 });
      if (url.endsWith("/api/chat-requests")) return response({ items: [{ id: "request-1", avatarSessionId: "avatar-1", fromUserId: "user-me", toUserId: "user-other", memberId: "member-lin", status: "accepted", createdAt: "2026-08-13T08:00:00.000Z", updatedAt: "2026-08-13T08:00:00.000Z" }] });
      if (url.endsWith("/api/conversations")) return response({ items: [{ id: "conversation-1", chatRequestId: "request-1", participantIds: ["user-me", "user-other"], status: "active", createdAt: "2026-08-13T08:00:00.000Z" }] });
      if (url.endsWith("/api/conversations/conversation-1/messages") && method === "GET") return response({ items: [] });
      if (url.endsWith("/api/conversations/conversation-1/read") && method === "POST") return response({ readCount: 0, readAt: "2026-08-13T08:01:00.000Z" });
      return response({});
    }));

    cleanup();
    MockEventSource.instances = [];
    renderMessages();
    await user.click(await screen.findByRole("tab", { name: "真人聊天" }));
    await user.click(await screen.findByRole("button", { name: "进入聊天" }));
    const activeFetch = vi.mocked(fetch);
    const historyCallsBeforeDisconnect = activeFetch.mock.calls.filter(([input, init]) => String(input).endsWith("/messages") && (init?.method ?? "GET") === "GET").length;

    MockEventSource.instances[0].fail();
    expect(await screen.findByRole("status", { name: "实时连接状态" })).toHaveTextContent("实时连接已断开");
    await vi.advanceTimersByTimeAsync(3_100);

    const historyCallsAfterDisconnect = activeFetch.mock.calls.filter(([input, init]) => String(input).endsWith("/messages") && (init?.method ?? "GET") === "GET").length;
    expect(historyCallsAfterDisconnect).toBeGreaterThan(historyCallsBeforeDisconnect);
    expect(fetchMock).toBeDefined();
  });

  it("打开会话标记已读，输入变化节流发送 typing 状态", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/api/me")) return response({ user: { id: "user-me", phoneMasked: "138****0000" }, profile: null });
      if (url.endsWith("/api/members")) return response({ items: [{ id: "member-lin", userId: "user-other", nickname: "林婉清", age: 45 }], total: 1 });
      if (url.endsWith("/api/chat-requests")) return response({ items: [{ id: "request-1", avatarSessionId: "avatar-1", fromUserId: "user-me", toUserId: "user-other", memberId: "member-lin", status: "accepted", createdAt: "2026-08-13T08:00:00.000Z", updatedAt: "2026-08-13T08:00:00.000Z" }] });
      if (url.endsWith("/api/conversations")) return response({ items: [{ id: "conversation-1", chatRequestId: "request-1", participantIds: ["user-me", "user-other"], status: "active", createdAt: "2026-08-13T08:00:00.000Z" }] });
      if (url.endsWith("/api/conversations/conversation-1/messages")) return response({ items: [] });
      if (url.endsWith("/api/conversations/conversation-1/read")) return response({ readCount: 0, readAt: "2026-08-13T08:01:00.000Z" });
      if (url.endsWith("/api/conversations/conversation-1/typing")) return new Response(null, { status: 204 });
      return response({});
    }));

    renderMessages();
    await user.click(await screen.findByRole("tab", { name: "真人聊天" }));
    await user.click(await screen.findByRole("button", { name: "进入聊天" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/read") && call.method === "POST")).toBe(true));

    await user.type(screen.getByLabelText("给对方留言"), "你好");
    const typingCalls = () => calls.filter((call) => call.url.endsWith("/typing") && call.method === "POST");
    expect(typingCalls()).toHaveLength(1);
    expect(typingCalls()[0].body).toBe('{"typing":true}');
    await vi.advanceTimersByTimeAsync(1_100);
    expect(typingCalls().length).toBeLessThanOrEqual(2);
  });

  it("展示在线、正在输入和消息已送达/已读状态", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/me")) return response({ user: { id: "user-me", phoneMasked: "138****0000" }, profile: null });
      if (url.endsWith("/api/members")) return response({ items: [{ id: "member-lin", userId: "user-other", nickname: "林婉清", age: 45 }], total: 1 });
      if (url.endsWith("/api/chat-requests")) return response({ items: [{ id: "request-1", avatarSessionId: "avatar-1", fromUserId: "user-me", toUserId: "user-other", memberId: "member-lin", status: "accepted", createdAt: "2026-08-13T08:00:00.000Z", updatedAt: "2026-08-13T08:00:00.000Z" }] });
      if (url.endsWith("/api/conversations")) return response({ items: [{ id: "conversation-1", chatRequestId: "request-1", participantIds: ["user-me", "user-other"], status: "active", createdAt: "2026-08-13T08:00:00.000Z" }] });
      if (url.endsWith("/api/conversations/conversation-1/messages") && method === "GET") return response({ items: [
        { id: "message-delivered", conversationId: "conversation-1", senderId: "user-me", text: "第一条", clientMessageId: "client-1", createdAt: "2026-08-13T08:01:00.000Z", receipt: { deliveredAt: "2026-08-13T08:02:00.000Z", readAt: null } },
        { id: "message-read", conversationId: "conversation-1", senderId: "user-me", text: "第二条", clientMessageId: "client-2", createdAt: "2026-08-13T08:03:00.000Z", receipt: { deliveredAt: "2026-08-13T08:04:00.000Z", readAt: "2026-08-13T08:05:00.000Z" } },
      ] });
      if (url.endsWith("/api/conversations/conversation-1/read")) return response({ readCount: 0, readAt: "2026-08-13T08:05:00.000Z" });
      return response({});
    }));

    renderMessages();
    await user.click(await screen.findByRole("tab", { name: "真人聊天" }));
    await user.click(await screen.findByRole("button", { name: "进入聊天" }));
    expect(await screen.findByText("已送达")).toBeVisible();
    expect(screen.getByText("已读")).toBeVisible();

    MockEventSource.instances[0].emit("presence.changed", { userId: "user-other", online: true });
    expect(await screen.findByText("在线")).toBeVisible();
    MockEventSource.instances[0].emit("typing.changed", { conversationId: "conversation-1", userId: "user-other", typing: true, expiresAt: Date.now() + 5_000 });
    expect(await screen.findByText("对方正在输入")).toBeVisible();
  });

  it("组件卸载时关闭实时连接", async () => {
    const view = renderMessages();
    await screen.findByText("收到新的聊天申请");
    const source = MockEventSource.instances[0];

    view.unmount();

    expect(source.close).toHaveBeenCalledOnce();
  });

  it("可以结束和恢复会话，并撤回自己发送的近期消息", async () => {
    const user = userEvent.setup();
    const calls: Array<{ url: string; method: string }> = [];
    let conversationStatus: "active" | "archived" = "active";
    let recalled = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (url.endsWith("/api/me")) return response({ user: { id: "user-me", phoneMasked: "138****0000" }, profile: null });
      if (url.endsWith("/api/members")) return response({ items: [{ id: "member-lin", userId: "user-other", nickname: "林婉清", age: 45 }], total: 1 });
      if (url.endsWith("/api/chat-requests")) return response({ items: [{ id: "request-1", avatarSessionId: "avatar-1", fromUserId: "user-me", toUserId: "user-other", memberId: "member-lin", status: "accepted", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] });
      if (url.endsWith("/api/conversations") && method === "GET") return response({ items: [{ id: "conversation-1", chatRequestId: "request-1", participantIds: ["user-me", "user-other"], status: conversationStatus, archivedAt: conversationStatus === "archived" ? new Date().toISOString() : null, createdAt: new Date().toISOString() }] });
      if (url.endsWith("/api/conversations/conversation-1/messages") && method === "GET") return response({ items: [{ id: "message-mine", conversationId: "conversation-1", senderId: "user-me", text: recalled ? "此消息已撤回" : "我刚才发的消息", clientMessageId: "client-1", deletedAt: recalled ? new Date().toISOString() : null, createdAt: new Date().toISOString() }] });
      if (url.endsWith("/api/conversations/conversation-1/messages/message-mine/recall") && method === "POST") {
        recalled = true;
        return response({ message: { id: "message-mine", conversationId: "conversation-1", senderId: "user-me", text: "此消息已撤回", clientMessageId: "client-1", deletedAt: new Date().toISOString(), createdAt: new Date().toISOString() } });
      }
      if (url.endsWith("/api/conversations/conversation-1/archive") && method === "POST") {
        conversationStatus = "archived";
        return response({ conversation: { id: "conversation-1", chatRequestId: "request-1", participantIds: ["user-me", "user-other"], status: "archived", archivedAt: new Date().toISOString(), createdAt: new Date().toISOString() } });
      }
      if (url.endsWith("/api/conversations/conversation-1/restore") && method === "POST") {
        conversationStatus = "active";
        return response({ conversation: { id: "conversation-1", chatRequestId: "request-1", participantIds: ["user-me", "user-other"], status: "active", archivedAt: null, createdAt: new Date().toISOString() } });
      }
      if (url.endsWith("/read") || url.endsWith("/typing")) return response({ readCount: 0, readAt: new Date().toISOString() });
      return response({});
    }));

    renderMessages();
    await user.click(await screen.findByRole("tab", { name: "真人聊天" }));
    await user.click(await screen.findByRole("button", { name: "进入聊天" }));

    await user.click(await screen.findByRole("button", { name: "撤回消息：我刚才发的消息" }));
    expect(await screen.findByText("此消息已撤回")).toBeVisible();
    expect(screen.queryByText("我刚才发的消息")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "结束联系" }));
    await user.click(screen.getByRole("button", { name: "确认结束联系" }));
    expect((await screen.findAllByText("这段聊天已结束")).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("给对方留言")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "恢复聊天" }));
    expect(await screen.findByLabelText("给对方留言")).toBeVisible();
    expect(calls.some((call) => call.url.endsWith("/messages/message-mine/recall") && call.method === "POST")).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/archive") && call.method === "POST")).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/restore") && call.method === "POST")).toBe(true);
  });
});
