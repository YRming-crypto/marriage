import { Archive, ArrowLeft, Ban, Bell, Check, Flag, MessageCircleMore, RotateCcw, Send, ShieldAlert, ShieldCheck, Undo2, UserCheck, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ChatRequest, Conversation, Member, Message, Notification } from "@ai-marriage/shared";
import { Link } from "react-router-dom";
import {
  ApiError,
  acceptChatRequest,
  archiveConversation,
  blockUser,
  createReport,
  getChatRequests,
  getConversationMessages,
  getConversations,
  getMe,
  getMembers,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  recallConversationMessage,
  rejectChatRequest,
  restoreConversation,
  sendConversationMessage,
} from "../api/client";
import { normalizeLobbyMembers } from "../api/useMembers";
import "./MessagesPage.css";

type MessageTab = "requests" | "chats" | "notices";
type RealtimeStatus = "connecting" | "connected" | "disconnected";
type MessageWithReceipt = Message & {
  receipt?: {
    deliveredAt: string | null;
    readAt: string | null;
  } | null;
};

const messageTabs: MessageTab[] = ["requests", "chats", "notices"];
const fallbackRefreshIntervalMs = 3_000;
const typingThrottleMs = 1_000;
const politeGreetings = [
  "你好，很高兴认识你。",
  "你好，看了你的资料，感觉我们有不少共同点。",
  "晚上好，今天过得怎么样？",
];
const icebreakerSuggestions = [
  "平时周末你喜欢怎么安排？",
  "最近有没有让你觉得开心的小事？",
  "你更喜欢安静散步，还是一起看场电影？",
];
const contactTerms = [
  { label: "微信", pattern: /微信|wechat|\bvx\b/i },
  { label: "电话", pattern: /电话|手机号|手机号码|\b1[3-9]\d{9}\b/i },
];
const financialRiskTerms = [
  { label: "银行卡", pattern: /银行卡|银行卡号|银行账户|卡号/i },
  { label: "转账", pattern: /转账|汇款|打款|保证金|借钱|垫付|充值|提现/i },
];

function apiBase() {
  return (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4184").replace(/\/$/, "");
}

async function postConversationAction(conversationId: string, action: "read" | "typing", body?: { typing: boolean }) {
  await fetch(`${apiBase()}/api/conversations/${encodeURIComponent(conversationId)}/${action}`, {
    method: "POST",
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function parseRealtimeData(event: Event): Record<string, unknown> | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") return null;
  try {
    const value: unknown = JSON.parse(event.data);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.code === "AUTH_REQUIRED") return "请先登录后查看申请和真人聊天。";
  if (error instanceof Error && error.message && !/failed to fetch|networkerror|load failed/i.test(error.message)) return error.message;
  return "暂时无法连接消息服务，请稍后重试。";
}

function createClientMessageId(conversationId: string) {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${conversationId}-${randomId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function mergeConversations(current: Conversation[], incoming: Conversation[], extra?: Conversation) {
  const all = [...current, ...incoming, ...(extra ? [extra] : [])];
  return Array.from(new Map(all.map((conversation) => [conversation.id, conversation])).values());
}

function memberName(member: Member | undefined) {
  return member?.nickname ?? "对方资料";
}

function memberPhoto(member: Member | undefined) {
  return member?.photoUrl;
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function messageDateLabel(value: string) {
  return new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}

function groupMessagesByDate(messages: MessageWithReceipt[]) {
  const groups: Array<{ label: string; messages: MessageWithReceipt[] }> = [];
  for (const message of messages) {
    const label = messageDateLabel(message.createdAt);
    const currentGroup = groups.at(-1);
    if (currentGroup?.label === label) currentGroup.messages.push(message);
    else groups.push({ label, messages: [message] });
  }
  return groups;
}

function notificationDestination(notification: Notification) {
  if (!notification.relatedResourceId) return null;
  if (notification.relatedResourceType === "member") return { to: `/member/${encodeURIComponent(notification.relatedResourceId)}`, label: "查看会员资料" };
  if (notification.relatedResourceType === "photo") return { to: "/onboarding", label: "管理我的照片" };
  if (notification.relatedResourceType === "profile") return { to: "/onboarding", label: "查看婚恋资料" };
  if (notification.relatedResourceType === "report") return { to: "/me/security", label: "查看账号安全" };
  return null;
}

function RequestAvatar({ member }: { member: Member | undefined }) {
  const name = memberName(member);
  if (memberPhoto(member)) return <img src={memberPhoto(member)} alt={`${name}的头像`} />;
  return <div className="request-card__avatar-placeholder" aria-hidden="true">{name.slice(0, 1)}</div>;
}

export function MessagesPage() {
  const [activeTab, setActiveTab] = useState<MessageTab>("requests");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [requests, setRequests] = useState<ChatRequest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [notificationError, setNotificationError] = useState("");
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [acceptConfirmation, setAcceptConfirmation] = useState<ChatRequest | null>(null);
  const [rejectConfirmation, setRejectConfirmation] = useState<ChatRequest | null>(null);
  const [busyNotificationId, setBusyNotificationId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<MessageWithReceipt[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [safetyAction, setSafetyAction] = useState<"report" | "block" | "archive" | null>(null);
  const [reportReason, setReportReason] = useState("骚扰或不尊重");
  const [reportDescription, setReportDescription] = useState("");
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [safetyStatus, setSafetyStatus] = useState("");
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [recallingMessageId, setRecallingMessageId] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [typingByConversation, setTypingByConversation] = useState<Record<string, boolean>>({});
  const [presenceByUser, setPresenceByUser] = useState<Record<string, boolean>>({});
  const tabRefs = useRef<Record<MessageTab, HTMLButtonElement | null>>({ requests: null, chats: null, notices: null });
  const activeConversationIdRef = useRef<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingConversationRef = useRef<string | null>(null);
  const typingActiveRef = useRef(false);
  const lastTypingSentAtRef = useRef(0);
  const pendingHumanMessageRef = useRef<{ conversationId: string; text: string; clientMessageId: string } | null>(null);
  const acceptDialogRef = useRef<HTMLElement>(null);
  const rejectDialogRef = useRef<HTMLElement>(null);

  const membersById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const pendingIncomingCount = requests.filter((request) => request.status === "pending" && request.toUserId === currentUserId).length;
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const activeRequest = activeConversation ? requests.find((request) => request.id === activeConversation.chatRequestId) : undefined;
  const activeMember = activeRequest?.member ?? (activeRequest && activeRequest.fromUserId === currentUserId ? membersById.get(activeRequest.memberId) : undefined);
  const activeTargetUserId = activeConversation?.participantIds.find((userId) => userId !== currentUserId) ?? activeMember?.userId;
  const activeTargetOnline = activeTargetUserId ? presenceByUser[activeTargetUserId] : undefined;
  const activeTargetTyping = activeConversationId ? typingByConversation[activeConversationId] === true : false;
  const draftContactTerms = contactTerms.filter(({ pattern }) => pattern.test(draft)).map(({ label }) => label);
  const draftFinancialRiskTerms = financialRiskTerms.filter(({ pattern }) => pattern.test(draft)).map(({ label }) => label);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    if (!acceptConfirmation) return;
    const dialogElement = acceptDialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableElements = () => Array.from(dialogElement?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    focusableElements()[0]?.focus();

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !busyRequestId) {
        event.preventDefault();
        setAcceptConfirmation(null);
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [acceptConfirmation, busyRequestId]);

  useEffect(() => {
    if (!rejectConfirmation) return;
    const dialogElement = rejectDialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableElements = () => Array.from(dialogElement?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    focusableElements()[0]?.focus();

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && busyRequestId !== rejectConfirmation?.id) {
        event.preventDefault();
        setRejectConfirmation(null);
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [rejectConfirmation, busyRequestId]);

  const refreshMessageCenter = useCallback(async () => {
    const [requestResult, conversationResult, notificationResult] = await Promise.allSettled([
      getChatRequests(),
      getConversations(),
      getNotifications(),
    ]);
    if (requestResult.status === "fulfilled") setRequests(requestResult.value.items);
    if (conversationResult.status === "fulfilled") setConversations(conversationResult.value.items);
    if (notificationResult.status === "fulfilled") {
      setNotifications(notificationResult.value.items);
      setUnreadNotificationCount(notificationResult.value.unreadCount);
      setNotificationError("");
    } else {
      setNotificationError(errorMessage(notificationResult.reason));
    }
  }, []);

  const retryNotifications = useCallback(async () => {
    setNotificationLoading(true);
    setNotificationError("");
    try {
      const result = await getNotifications();
      setNotifications(result.items);
      setUnreadNotificationCount(result.unreadCount);
    } catch (error) {
      setNotificationError(errorMessage(error));
    } finally {
      setNotificationLoading(false);
    }
  }, []);

  const refreshConversationMessages = useCallback(async (conversationId: string, initial = false) => {
    if (initial) {
      setMessagesLoading(true);
      setMessageError("");
    }
    try {
      const result = await getConversationMessages(conversationId);
      if (activeConversationIdRef.current !== conversationId) return;
      setConversationMessages(result.items as MessageWithReceipt[]);
      setMessageError("");
    } catch (error) {
      if (initial && activeConversationIdRef.current === conversationId) setMessageError(errorMessage(error));
    } finally {
      if (initial && activeConversationIdRef.current === conversationId) setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadMessageCenter() {
      setLoading(true);
      setPageError("");
      try {
        const me = await getMe();
        if (!active) return;
        setCurrentUserId(me.user.id);
        const [requestResult, conversationResult, memberResult, notificationResult] = await Promise.allSettled([
          getChatRequests(),
          getConversations(),
          getMembers(),
          getNotifications(),
        ]);
        if (!active) return;
        if (requestResult.status === "rejected") throw requestResult.reason;
        if (conversationResult.status === "rejected") throw conversationResult.reason;
        setRequests(requestResult.value.items);
        setConversations(conversationResult.value.items);
        setMembers(memberResult.status === "fulfilled" ? normalizeLobbyMembers(memberResult.value.items) : []);
        if (notificationResult.status === "fulfilled") {
          setNotifications(notificationResult.value.items);
          setUnreadNotificationCount(notificationResult.value.unreadCount);
          setNotificationError("");
        } else {
          setNotifications([]);
          setUnreadNotificationCount(0);
          setNotificationError(errorMessage(notificationResult.reason));
        }
      } catch (error) {
        if (!active) return;
        setCurrentUserId(null);
        setRequests([]);
        setConversations([]);
        setMembers([]);
        setNotifications([]);
        setUnreadNotificationCount(0);
        setPageError(errorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadMessageCenter();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    function refreshFromHttp() {
      void refreshMessageCenter();
      const conversationId = activeConversationIdRef.current;
      if (conversationId) void refreshConversationMessages(conversationId);
    }

    function startFallbackPolling() {
      if (fallbackTimer) return;
      refreshFromHttp();
      fallbackTimer = setInterval(refreshFromHttp, fallbackRefreshIntervalMs);
    }

    function stopFallbackPolling() {
      if (!fallbackTimer) return;
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }

    if (typeof EventSource === "undefined") {
      setRealtimeStatus("disconnected");
      startFallbackPolling();
      return () => stopFallbackPolling();
    }

    setRealtimeStatus("connecting");
    const source = new EventSource(`${apiBase()}/api/realtime/events`, { withCredentials: true });
    source.onopen = () => {
      if (closed) return;
      setRealtimeStatus("connected");
      stopFallbackPolling();
    };
    source.onerror = () => {
      if (closed) return;
      setRealtimeStatus("disconnected");
      startFallbackPolling();
    };

    const refreshCenter = () => void refreshMessageCenter();
    const refreshConversation = (event: Event) => {
      const data = parseRealtimeData(event);
      const conversationId = typeof data?.conversationId === "string" ? data.conversationId : null;
      if (!conversationId || conversationId !== activeConversationIdRef.current) return;
      void refreshConversationMessages(conversationId);
      if (event.type === "message.created") void postConversationAction(conversationId, "read").catch(() => undefined);
    };

    source.addEventListener("message.created", refreshCenter);
    source.addEventListener("message.created", refreshConversation);
    source.addEventListener("message.recalled", refreshCenter);
    source.addEventListener("message.recalled", refreshConversation);
    source.addEventListener("message.read", refreshConversation);
    source.addEventListener("notification.created", refreshCenter);
    source.addEventListener("conversation.updated", refreshCenter);
    source.addEventListener("conversation.updated", refreshConversation);
    source.addEventListener("resync", () => refreshFromHttp());
    source.addEventListener("typing.changed", (event) => {
      const data = parseRealtimeData(event);
      if (typeof data?.conversationId !== "string" || typeof data.typing !== "boolean") return;
      setTypingByConversation((current) => ({ ...current, [data.conversationId as string]: data.typing as boolean }));
    });
    source.addEventListener("presence.changed", (event) => {
      const data = parseRealtimeData(event);
      if (typeof data?.userId !== "string" || typeof data.online !== "boolean") return;
      setPresenceByUser((current) => ({ ...current, [data.userId as string]: data.online as boolean }));
    });

    return () => {
      closed = true;
      stopFallbackPolling();
      source.close();
    };
  }, [currentUserId, refreshConversationMessages, refreshMessageCenter]);

  useEffect(() => {
    if (!activeConversationId) return;
    setConversationMessages([]);
    void refreshConversationMessages(activeConversationId, true);
    void postConversationAction(activeConversationId, "read").catch(() => undefined);
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
      if (typingActiveRef.current) void postConversationAction(activeConversationId, "typing", { typing: false }).catch(() => undefined);
      typingActiveRef.current = false;
      typingConversationRef.current = null;
      lastTypingSentAtRef.current = 0;
    };
  }, [activeConversationId, refreshConversationMessages]);

  function selectTab(tab: MessageTab, moveFocus = true) {
    setActiveTab(tab);
    if (moveFocus) tabRefs.current[tab]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: MessageTab) {
    const currentIndex = messageTabs.indexOf(tab);
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % messageTabs.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + messageTabs.length) % messageTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = messageTabs.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    selectTab(messageTabs[nextIndex]);
  }

  function stopTyping(conversationId = typingConversationRef.current) {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = null;
    if (conversationId && typingActiveRef.current) {
      void postConversationAction(conversationId, "typing", { typing: false }).catch(() => undefined);
    }
    typingActiveRef.current = false;
    typingConversationRef.current = null;
    lastTypingSentAtRef.current = 0;
  }

  function handleDraftChange(value: string) {
    setDraft(value);
    if (!activeConversationId) return;
    if (!value.trim()) {
      stopTyping(activeConversationId);
      return;
    }

    const now = Date.now();
    if (!typingActiveRef.current || typingConversationRef.current !== activeConversationId || now - lastTypingSentAtRef.current >= typingThrottleMs) {
      void postConversationAction(activeConversationId, "typing", { typing: true }).catch(() => undefined);
      typingActiveRef.current = true;
      typingConversationRef.current = activeConversationId;
      lastTypingSentAtRef.current = now;
    }

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => stopTyping(activeConversationId), 1_500);
  }

  async function handleAccept(request: ChatRequest) {
    setBusyRequestId(request.id);
    setActionError("");
    try {
      const result = await acceptChatRequest(request.id);
      setRequests((current) => current.map((item) => item.id === request.id ? result.request : item));
      setConversations((current) => mergeConversations(current, [], result.conversation));
      const refreshed = await getConversations();
      setConversations((current) => mergeConversations(current, refreshed.items));
      setAcceptConfirmation(null);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyRequestId(null);
    }
  }

  async function handleReject(request: ChatRequest) {
    setBusyRequestId(request.id);
    setActionError("");
    try {
      const result = await rejectChatRequest(request.id);
      setRequests((current) => current.map((item) => item.id === request.id ? { ...item, ...result.request } : item));
      setRejectConfirmation(null);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyRequestId(null);
    }
  }

  async function handleMarkAllNotificationsRead() {
    setActionError("");
    try {
      await markAllNotificationsRead();
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((notification) => notification.readAt ? notification : { ...notification, readAt }));
      setUnreadNotificationCount(0);
      window.dispatchEvent(
        new CustomEvent("ai-marriage-notifications-updated", {
          detail: { unreadCount: 0 },
        }),
      );
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  async function markSingleNotificationRead(notification: Notification) {
    if (notification.readAt) return true;
    setBusyNotificationId(notification.id);
    setActionError("");
    try {
      const result = await markNotificationRead(notification.id);
      const readAt = result.notification.readAt ?? new Date().toISOString();
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt } : item));
      const unreadCount = Math.max(0, unreadNotificationCount - 1);
      setUnreadNotificationCount(unreadCount);
      window.dispatchEvent(new CustomEvent("ai-marriage-notifications-updated", { detail: { unreadCount } }));
      return true;
    } catch (error) {
      setActionError(errorMessage(error));
      return false;
    } finally {
      setBusyNotificationId(null);
    }
  }

  async function openNotificationResource(notification: Notification) {
    if (!await markSingleNotificationRead(notification)) return;
    if (notification.relatedResourceType === "chat_request") {
      selectTab("requests", false);
      return;
    }
    if (notification.relatedResourceType === "conversation") {
      selectTab("chats", false);
      if (notification.relatedResourceId && conversations.some((item) => item.id === notification.relatedResourceId)) {
        setActiveConversationId(notification.relatedResourceId);
      }
    }
  }

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !activeConversationId || sending) return;
    setSending(true);
    setMessageError("");
    const pending = pendingHumanMessageRef.current;
    const outgoing = pending?.conversationId === activeConversationId && pending.text === text
      ? pending
      : { conversationId: activeConversationId, text, clientMessageId: createClientMessageId(activeConversationId) };
    pendingHumanMessageRef.current = outgoing;
    try {
      const result = await sendConversationMessage(activeConversationId, text, outgoing.clientMessageId);
      setConversationMessages((current) => current.some((message) => message.id === result.message.id) ? current : [...current, result.message]);
      if (pendingHumanMessageRef.current?.clientMessageId === outgoing.clientMessageId) pendingHumanMessageRef.current = null;
      setDraft("");
      stopTyping(activeConversationId);
    } catch (error) {
      setMessageError(errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  async function handleReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeTargetUserId || !activeConversation || !reportDescription.trim() || safetyBusy) return;
    const evidenceMessage = [...conversationMessages].reverse().find((message) => message.senderId === activeTargetUserId);
    setSafetyBusy(true);
    setSafetyStatus("");
    try {
      await createReport({
        targetUserId: activeTargetUserId,
        reason: reportReason,
        description: reportDescription.trim(),
        conversationId: activeConversation.id,
        ...(evidenceMessage ? { messageId: evidenceMessage.id } : {}),
      });
      setSafetyStatus("举报已提交，管理员会尽快核查。");
      setReportDescription("");
      setSafetyAction(null);
    } catch (error) {
      setSafetyStatus(errorMessage(error));
    } finally {
      setSafetyBusy(false);
    }
  }

  async function handleBlock() {
    if (!activeTargetUserId || !activeConversation || safetyBusy) return;
    setSafetyBusy(true);
    setSafetyStatus("");
    try {
      await blockUser(activeTargetUserId);
      setConversations((current) => current.map((conversation) => conversation.id === activeConversation.id ? { ...conversation, status: "blocked" } : conversation));
      setSafetyStatus("已屏蔽对方，这段聊天已停止。你可以在个人中心解除屏蔽。");
      setSafetyAction(null);
      setDraft("");
    } catch (error) {
      setSafetyStatus(errorMessage(error));
    } finally {
      setSafetyBusy(false);
    }
  }

  async function handleConversationLifecycle(action: "archive" | "restore") {
    if (!activeConversation || lifecycleBusy) return;
    setLifecycleBusy(true);
    setMessageError("");
    try {
      const result = action === "archive"
        ? await archiveConversation(activeConversation.id)
        : await restoreConversation(activeConversation.id);
      setConversations((current) => current.map((conversation) => conversation.id === result.conversation.id ? result.conversation : conversation));
      setSafetyAction(null);
      setDraft("");
      stopTyping(activeConversation.id);
    } catch (error) {
      setMessageError(errorMessage(error));
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function handleRecallMessage(message: MessageWithReceipt) {
    if (!activeConversation || recallingMessageId) return;
    setRecallingMessageId(message.id);
    setMessageError("");
    try {
      const result = await recallConversationMessage(activeConversation.id, message.id);
      setConversationMessages((current) => current.map((item) => item.id === result.message.id ? { ...item, ...result.message } : item));
    } catch (error) {
      setMessageError(errorMessage(error));
    } finally {
      setRecallingMessageId(null);
    }
  }

  function renderStatus(message: string, tone: "error" | "info" = "info") {
    return <div className={`message-live-status message-live-status--${tone}`} role="status" aria-label="消息中心状态"><ShieldAlert size={20} /><span>{message}</span></div>;
  }

  function renderRequest(request: ChatRequest) {
    const incoming = request.toUserId === currentUserId;
    // The current API exposes memberId from the sender's perspective. For an incoming request it can point to the recipient's own public record, so do not show the wrong person.
    const member = request.member ?? (incoming ? undefined : membersById.get(request.memberId));
    const pending = request.status === "pending";
    const statusText = request.status === "accepted"
      ? "双方已同意，可以真人聊天"
      : request.status === "rejected"
        ? "本次申请已结束"
        : request.status === "expired"
          ? "聊天申请已过期"
        : incoming
          ? "收到新的聊天申请"
          : "聊天申请已发出";

    const description = request.status === "accepted"
      ? "你们已经可以直接聊天，请从轻松的话题开始了解。"
      : request.status === "rejected"
        ? "本次申请已经结束，双方仍可继续浏览其他合适对象。"
        : request.status === "expired"
          ? "超过 7 天未处理，本次申请已自动结束。"
          : incoming
            ? "对方愿意和你本人进一步聊聊。"
            : "等待对方回应，申请通过后会出现在真人聊天中。";

    return (
      <section className="request-card" key={request.id}>
        <RequestAvatar member={member} />
        <div>
          <span>{statusText}</span>
          <h2>{memberName(member)}{member ? `，${member.age} 岁` : ""}</h2>
          <p>{description}</p>
          <small>{new Date(request.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
        </div>
        {pending && incoming ? (
          <div className="request-card__actions">
            <button className="button button--soft" type="button" disabled={busyRequestId === request.id} onClick={() => { setActionError(""); setRejectConfirmation(request); }}>暂不聊天</button>
            <button className="button button--primary" type="button" disabled={busyRequestId === request.id} onClick={() => { setActionError(""); setAcceptConfirmation(request); }}>同意聊天</button>
          </div>
        ) : request.status === "accepted" ? (
          <span className="approved-state" role="status" aria-label="聊天申请状态"><Check />已同意，可以聊天</span>
        ) : request.status === "rejected" ? (
          <span className="request-card__waiting">已婉拒申请</span>
        ) : request.status === "expired" ? (
          <span className="request-card__waiting">已过期</span>
        ) : (
          <span className="request-card__waiting">等待对方回应</span>
        )}
      </section>
    );
  }

  function renderNotifications() {
    if (loading) return <section className="message-empty"><Bell /><h2>正在加载系统通知</h2><p>请稍候，正在读取通知。</p></section>;
    if (notificationError) return <section className="message-empty" role="alert" aria-label="系统通知加载失败"><Bell /><h2>系统通知暂时无法加载</h2><p>{notificationError}</p><button className="button button--primary" type="button" disabled={notificationLoading} onClick={() => void retryNotifications()}>{notificationLoading ? "正在重新加载..." : "重新加载通知"}</button></section>;
    if (notificationLoading) return <section className="message-empty" role="status"><Bell /><h2>正在重新加载系统通知</h2><p>请稍候。</p></section>;
    if (!notifications.length) return <section className="message-empty"><Bell /><h2>暂时没有系统通知</h2><p>资料审核、聊天申请和新消息会在这里提醒你。</p></section>;
    return (
      <div className="system-notice-list">
        <div className="system-notice-list__toolbar">
          <span>{unreadNotificationCount ? `${unreadNotificationCount} 条未读` : "通知已全部读完"}</span>
          {unreadNotificationCount ? <button className="button button--text" type="button" onClick={() => void handleMarkAllNotificationsRead()}>全部标为已读</button> : null}
        </div>
        {notifications.map((notification) => {
          const destination = notificationDestination(notification);
          const internalAction = notification.relatedResourceType === "chat_request"
            ? "查看聊天申请"
            : notification.relatedResourceType === "conversation"
              ? "进入真人聊天"
              : null;
          return <section className={`system-notice ${notification.readAt ? "is-read" : "is-unread"}`} key={notification.id}>
            <span><Bell /></span>
            <div>
              <h2>{notification.title}</h2>
              <p>{notification.body}</p>
              <small>{new Date(notification.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
              <div className="system-notice__actions">
                {internalAction ? <button className="button button--text" type="button" disabled={busyNotificationId === notification.id} onClick={() => void openNotificationResource(notification)}>{busyNotificationId === notification.id ? "正在打开..." : internalAction}</button> : null}
                {destination ? <Link className="button button--text" to={destination.to} onClick={() => { void markSingleNotificationRead(notification); }}>{destination.label}</Link> : null}
                {!internalAction && !destination && !notification.readAt ? <button className="button button--text" type="button" disabled={busyNotificationId === notification.id} onClick={() => void markSingleNotificationRead(notification)}>{busyNotificationId === notification.id ? "正在处理..." : "标为已读"}</button> : null}
              </div>
            </div>
          </section>;
        })}
      </div>
    );
  }

  function renderRequests() {
    if (loading) return <section className="message-empty"><UserCheck /><h2>正在加载聊天申请</h2><p>请稍候，正在读取你的联系记录。</p></section>;
    if (pageError) return <section className="message-empty"><ShieldAlert /><h2>暂时无法读取聊天申请</h2><p>登录后可以查看申请和真人聊天。</p></section>;
    if (!requests.length) return <section className="message-empty"><UserCheck /><h2>暂时没有聊天申请</h2><p>你感兴趣的对象有回应后，申请会显示在这里。</p></section>;
    return <div className="message-request-list">{requests.map(renderRequest)}</div>;
  }

  function renderConversationList() {
    if (loading) return <section className="message-empty"><MessageCircleMore /><h2>正在加载真人聊天</h2><p>请稍候，正在读取你的会话。</p></section>;
    if (pageError) return <section className="message-empty"><MessageCircleMore /><h2>登录后查看真人聊天</h2><p>登录后可以查看已同意的会话。</p><button className="button button--soft" type="button" onClick={() => selectTab("requests", false)}>查看聊天申请</button></section>;
    if (!conversations.length) return <section className="message-empty"><MessageCircleMore /><h2>还没有开启的真人聊天</h2><p>双方同意聊天申请后，对话会出现在这里。</p><button className="button button--soft" type="button" onClick={() => selectTab("requests", false)}>查看聊天申请</button></section>;
    return (
      <div className="message-request-list">
        {conversations.map((conversation) => {
          const request = requests.find((item) => item.id === conversation.chatRequestId);
          const member = request?.member ?? (request && request.fromUserId === currentUserId ? membersById.get(request.memberId) : undefined);
          const summary = conversation.lastMessage?.text ?? (conversation.status === "archived" ? "历史消息仍然保留，需要时可以进入后恢复聊天。" : "你们已经可以直接聊天，先从轻松的话题开始吧。");
          return (
            <section className="request-card request-card--conversation" key={conversation.id}>
              <RequestAvatar member={member} />
              <div><span>{conversation.status === "archived" ? "联系已结束" : conversation.status === "blocked" ? "聊天已停止" : "真人聊天已开启"}</span><h2>{memberName(member)}</h2><p>{summary}</p><small>{conversation.lastMessage ? formatMessageTime(conversation.lastMessage.createdAt) : "会话已建立"}</small></div>
              <div className="request-card__conversation-actions">{conversation.unreadCount ? <span className="message-unread-count" aria-label={`${conversation.unreadCount} 条未读消息`}>{conversation.unreadCount}</span> : null}<button className="button button--primary" type="button" onClick={() => setActiveConversationId(conversation.id)}>进入聊天</button></div>
            </section>
          );
        })}
      </div>
    );
  }

  function renderConversation() {
    if (!activeConversation) return null;
    const conversationStatus = activeConversation.status === "blocked"
      ? "这段聊天已停止"
      : activeConversation.status === "archived"
        ? "这段聊天已结束"
      : activeTargetTyping
        ? "对方正在输入"
        : activeTargetOnline === true
          ? "在线"
          : activeTargetOnline === false
            ? "离线"
            : "真人聊天已开启";
    return (
      <section className="human-conversation" aria-label={`与${memberName(activeMember)}的真人聊天`}>
        <div className="human-conversation__header">
          <button className="button button--text" type="button" onClick={() => setActiveConversationId(null)}><ArrowLeft size={18} />返回会话列表</button>
          <div className="human-conversation__identity"><strong>{memberName(activeMember)}</strong><span aria-live="polite">{conversationStatus}</span></div>
          <div className="human-conversation__safety-actions">
            <button className="button button--text" type="button" disabled={!activeTargetUserId || safetyBusy} onClick={() => setSafetyAction((current) => current === "report" ? null : "report")}><Flag size={17} />举报对方</button>
            <button className="button button--text" type="button" disabled={!activeTargetUserId || safetyBusy || activeConversation.status === "blocked"} onClick={() => setSafetyAction((current) => current === "block" ? null : "block")}><Ban size={17} />屏蔽对方</button>
            {activeConversation.status === "archived" ? <button className="button button--text" type="button" disabled={lifecycleBusy} onClick={() => void handleConversationLifecycle("restore")}><RotateCcw size={17} />恢复聊天</button> : activeConversation.status === "active" ? <button className="button button--text" type="button" disabled={lifecycleBusy} onClick={() => setSafetyAction((current) => current === "archive" ? null : "archive")}><Archive size={17} />结束联系</button> : null}
          </div>
        </div>
        {safetyAction === "report" ? <form className="human-conversation__safety-panel" aria-label="举报对方" onSubmit={(event) => void handleReport(event)}><h2>举报聊天问题</h2><label><span>问题类型</span><select value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option>骚扰或不尊重</option><option>疑似诈骗</option><option>索要钱财</option><option>其他问题</option></select></label><label><span>情况说明</span><textarea aria-label="举报情况说明" value={reportDescription} maxLength={1000} onChange={(event) => setReportDescription(event.target.value)} placeholder="请简要说明聊天中发生的情况" /></label><div><button className="button button--soft" type="button" onClick={() => setSafetyAction(null)}>取消</button><button className="button button--primary" type="submit" disabled={!reportDescription.trim() || safetyBusy}>{safetyBusy ? "提交中..." : "提交举报"}</button></div></form> : null}
        {safetyAction === "block" ? <section className="human-conversation__safety-panel" aria-label="确认屏蔽对方"><h2>确认屏蔽对方？</h2><p>屏蔽后双方不能继续 AI 了解、发送聊天申请或真人消息。聊天记录仍会保留。</p><div><button className="button button--soft" type="button" onClick={() => setSafetyAction(null)}>取消</button><button className="button button--primary" type="button" disabled={safetyBusy} onClick={() => void handleBlock()}>{safetyBusy ? "处理中..." : "确认屏蔽"}</button></div></section> : null}
        {safetyAction === "archive" ? <section className="human-conversation__safety-panel" aria-label="确认结束联系"><h2>结束这段联系？</h2><p>结束后不能继续发送消息，但双方仍可查看历史记录，也可以稍后恢复。</p><div><button className="button button--soft" type="button" onClick={() => setSafetyAction(null)}>取消</button><button className="button button--primary" type="button" disabled={lifecycleBusy} onClick={() => void handleConversationLifecycle("archive")}>{lifecycleBusy ? "处理中..." : "确认结束联系"}</button></div></section> : null}
        {safetyStatus ? renderStatus(safetyStatus) : null}
        <div className="human-conversation__messages" role="log" aria-live="polite" aria-label="真人聊天记录">
          {messagesLoading ? <p className="human-conversation__empty">正在加载聊天记录...</p> : null}
          {!messagesLoading && !conversationMessages.length ? <p className="human-conversation__empty">还没有消息，从一句问候开始吧。</p> : null}
          {groupMessagesByDate(conversationMessages).map((group) => <section className="human-message-group" aria-label={group.label} key={group.label}><div className="human-message-date" role="separator">{group.label}</div>{group.messages.map((message) => {
            const isMine = message.senderId === currentUserId;
            const receiptStatus = message.receipt?.readAt ? "已读" : message.receipt?.deliveredAt ? "已送达" : null;
            const canRecall = isMine && !message.deletedAt && Date.now() - new Date(message.createdAt).getTime() <= 2 * 60_000;
            return <div className={`human-message ${isMine ? "human-message--mine" : "human-message--other"}`} key={message.id}><span>{isMine ? <UserRound /> : <MessageCircleMore />}</span><div className="human-message__content"><p>{message.text}{isMine && receiptStatus ? <small aria-label="消息状态" style={{ display: "block", marginTop: "0.25rem", opacity: 0.72 }}>{receiptStatus}</small> : null}</p><time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>{canRecall ? <button className="button button--text human-message__recall" type="button" aria-label={`撤回消息：${message.text}`} disabled={recallingMessageId === message.id} onClick={() => void handleRecallMessage(message)}><Undo2 size={14} />{recallingMessageId === message.id ? "撤回中" : "撤回"}</button> : null}</div></div>;
          })}</section>)}
        </div>
        {messageError ? renderStatus(messageError, "error") : null}
        {activeConversation.status === "blocked" ? <div className="human-conversation__blocked"><Ban /><div><strong>这段聊天已停止</strong><p>双方目前不能继续发送消息。你可以在个人中心管理黑名单。</p></div></div> : activeConversation.status === "archived" ? <div className="human-conversation__blocked"><Archive /><div><strong>这段聊天已结束</strong><p>历史消息仍然保留。点击“恢复聊天”后可以继续联系。</p></div></div> : <form className="human-conversation__composer" onSubmit={(event) => void handleSendMessage(event)}>
          <div className="human-conversation__writing-aids">
            <section aria-labelledby="polite-greetings-title">
              <div className="human-conversation__writing-aid-heading"><strong id="polite-greetings-title">礼貌问候</strong><span>点一句作为开场</span></div>
              <div className="human-conversation__suggestion-list">
                {politeGreetings.map((greeting) => <button type="button" key={greeting} aria-label={`使用问候语：${greeting}`} onClick={() => handleDraftChange(greeting)}>{greeting}</button>)}
              </div>
            </section>
            <section aria-labelledby="icebreaker-suggestions-title">
              <div className="human-conversation__writing-aid-heading"><strong id="icebreaker-suggestions-title">破冰建议</strong><span>从轻松的话题开始</span></div>
              <div className="human-conversation__suggestion-list">
                {icebreakerSuggestions.map((suggestion) => <button type="button" key={suggestion} aria-label={`使用破冰建议：${suggestion}`} onClick={() => handleDraftChange(suggestion)}>{suggestion}</button>)}
              </div>
            </section>
          </div>
          <label htmlFor="human-chat-draft">给对方留言</label>
          <textarea id="human-chat-draft" value={draft} maxLength={1000} onChange={(event) => handleDraftChange(event.target.value)} placeholder="请输入想说的话" />
          {draftFinancialRiskTerms.length ? <div className="human-conversation__risk-warning" role="alert" aria-label="聊天安全提醒">
            <ShieldAlert size={21} aria-hidden="true" />
            <div><strong>涉及资金的内容无法发送</strong><p>检测到{draftFinancialRiskTerms.join("、")}相关内容。请勿向婚恋对象转账、汇款或提供银行卡信息。</p><small>删除资金相关内容后可以继续发送。</small></div>
          </div> : draftContactTerms.length ? <div className="human-conversation__risk-warning" role="alert" aria-label="聊天安全提醒">
            <ShieldAlert size={21} aria-hidden="true" />
            <div><strong>发送前请确认安全</strong><p>检测到可能涉及{draftContactTerms.join("、")}的内容。交换联系方式前请先确认对方身份并保护个人隐私。</p><small>此提醒不会阻止你正常发送消息。</small></div>
          </div> : null}
          <div><small>请保持真诚和尊重，不要急于交换联系方式。</small><button className="button button--primary" type="submit" disabled={!draft.trim() || sending || draftFinancialRiskTerms.length > 0}>{sending ? "发送中..." : <><Send size={17} />发送消息</>}</button></div>
        </form>}
      </section>
    );
  }

  return (
    <div className="page-shell shell">
      <header className="page-header"><span>消息</span><h1>联系申请与真人消息</h1><p>只有双方都同意后，真人聊天才会开放。</p></header>
      {pageError ? renderStatus(pageError, "error") : null}
      {actionError ? renderStatus(actionError, "error") : null}
      {currentUserId && realtimeStatus === "disconnected" ? <div className="message-live-status" role="status" aria-label="实时连接状态"><Bell size={20} /><span>实时连接已断开，正在使用普通刷新，消息仍会继续更新。</span></div> : null}
      <div className="message-tabs" role="tablist" aria-label="消息分类">
        <button ref={(element) => { tabRefs.current.requests = element; }} id="message-tab-requests" className={activeTab === "requests" ? "is-active" : ""} type="button" role="tab" aria-selected={activeTab === "requests"} aria-controls="message-panel-requests" tabIndex={activeTab === "requests" ? 0 : -1} onClick={() => selectTab("requests", false)} onKeyDown={(event) => handleTabKeyDown(event, "requests")}><UserCheck />聊天申请 {pendingIncomingCount ? <b>{pendingIncomingCount}</b> : null}</button>
        <button ref={(element) => { tabRefs.current.chats = element; }} id="message-tab-chats" className={activeTab === "chats" ? "is-active" : ""} type="button" role="tab" aria-selected={activeTab === "chats"} aria-controls="message-panel-chats" tabIndex={activeTab === "chats" ? 0 : -1} onClick={() => selectTab("chats", false)} onKeyDown={(event) => handleTabKeyDown(event, "chats")}><MessageCircleMore />真人聊天</button>
        <button ref={(element) => { tabRefs.current.notices = element; }} id="message-tab-notices" className={activeTab === "notices" ? "is-active" : ""} type="button" role="tab" aria-selected={activeTab === "notices"} aria-controls="message-panel-notices" tabIndex={activeTab === "notices" ? 0 : -1} onClick={() => selectTab("notices", false)} onKeyDown={(event) => handleTabKeyDown(event, "notices")}><Bell />系统通知 {unreadNotificationCount ? <b>{unreadNotificationCount}</b> : null}</button>
      </div>
      <div id={`message-panel-${activeTab}`} className="message-panel" role="tabpanel" aria-labelledby={`message-tab-${activeTab}`} tabIndex={0}>
        {activeTab === "requests" ? renderRequests() : null}
        {activeTab === "chats" ? (activeConversationId ? renderConversation() : renderConversationList()) : null}
        {activeTab === "notices" ? renderNotifications() : null}
      </div>
      {acceptConfirmation ? <div className="modal-backdrop" role="presentation"><section ref={acceptDialogRef} className="safety-dialog" role="dialog" aria-modal="true" aria-labelledby="accept-chat-dialog-title"><button className="icon-button" type="button" aria-label="关闭同意聊天确认窗口" disabled={busyRequestId === acceptConfirmation.id} onClick={() => setAcceptConfirmation(null)}><X /></button><UserCheck /><h2 id="accept-chat-dialog-title">确认同意聊天</h2><p>确认后，你和对方都可以进入真人聊天并互相发送消息。</p>{actionError ? <p className="form-tip" role="status">{actionError}</p> : null}<div className="member-profile__actions"><button className="button button--soft" type="button" disabled={busyRequestId === acceptConfirmation.id} onClick={() => setAcceptConfirmation(null)}>取消</button><button className="button button--primary" type="button" disabled={busyRequestId === acceptConfirmation.id} onClick={() => void handleAccept(acceptConfirmation)}>{busyRequestId === acceptConfirmation.id ? "处理中..." : "确认同意聊天"}</button></div></section></div> : null}
      {rejectConfirmation ? <div className="modal-backdrop" role="presentation"><section ref={rejectDialogRef} className="safety-dialog" role="dialog" aria-modal="true" aria-labelledby="reject-chat-dialog-title"><button className="icon-button" type="button" aria-label="关闭暂不聊天确认窗口" disabled={busyRequestId === rejectConfirmation.id} onClick={() => setRejectConfirmation(null)}><X /></button><Ban /><h2 id="reject-chat-dialog-title">确认暂不聊天</h2><p>确认后，本次聊天申请会结束。你们仍可以继续浏览其他合适对象。</p>{actionError ? <p className="form-tip" role="status">{actionError}</p> : null}<div className="member-profile__actions"><button className="button button--soft" type="button" disabled={busyRequestId === rejectConfirmation.id} onClick={() => setRejectConfirmation(null)}>取消</button><button className="button button--primary" type="button" disabled={busyRequestId === rejectConfirmation.id} onClick={() => void handleReject(rejectConfirmation)}>{busyRequestId === rejectConfirmation.id ? "处理中..." : "确认暂不聊天"}</button></div></section></div> : null}
      <div className="ai-explainer"><ShieldCheck /><div><strong>安全提示</strong><p>不要急于交换联系方式或转账。首次线下见面请选择公共场所，并告诉家人或朋友。</p></div></div>
    </div>
  );
}
