import type { ChatRequestStatus, CompatibilityAnalysis, Member } from "@ai-marriage/shared";
import { Bot, Check, ChevronLeft, CircleStop, Flag, History, MessageCircleMore, Send, ShieldCheck, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  createAvatarSession,
  createInterest,
  createReport,
  endAvatarSession,
  getAvatarAnalysis,
  getAvatarMessages,
  getAvatarSessions,
  getChatRequests,
  getMember,
  requestHumanChat,
  sendAvatarMessage,
  type AvatarSessionSummary,
} from "../api/client";

const suggestions = ["TA 平时喜欢怎样安排周末？", "TA 希望建立怎样的关系？", "TA 在沟通中最看重什么？", "TA 对未来生活有什么期待？"];
const avatarTopicOptions = [
  { value: "", label: "自动定位" },
  { value: "life", label: "生活习惯" },
  { value: "relationship", label: "关系期待" },
  { value: "communication", label: "沟通方式" },
  { value: "privacy", label: "隐私边界" },
  { value: "general", label: "自由提问" },
] as const;

type ChatMessage = { id: string; side: "user" | "avatar"; text: string; isNew?: boolean; deliveryStatus?: "sending" | "failed" };

const emptyAnalysis: CompatibilityAnalysis = {
  readiness: "learning",
  canRequestChat: false,
  score: 0,
  completedTopics: [],
  commonPoints: [],
  discussionTopics: [],
  summary: "建议先从生活习惯、关系期待和沟通方式开始了解。",
};

export function AvatarChatPage() {
  const { memberId } = useParams();
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [interestRequired, setInterestRequired] = useState(false);
  const [interestBusy, setInterestBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [draft, setDraft] = useState("");
  const [selectedTopic, setSelectedTopic] = useState<(typeof avatarTopicOptions)[number]["value"]>("");
  const [chatRequestStatus, setChatRequestStatus] = useState<"none" | ChatRequestStatus>("none");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [historicalSessions, setHistoricalSessions] = useState<AvatarSessionSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewedHistorySession, setViewedHistorySession] = useState<AvatarSessionSummary | null>(null);
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [analysis, setAnalysis] = useState<CompatibilityAnalysis>(emptyAnalysis);
  const [liveError, setLiveError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [requestConfirmOpen, setRequestConfirmOpen] = useState(false);
  const [requestingChat, setRequestingChat] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportStatus, setReportStatus] = useState("");
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const reportDialogRef = useRef<HTMLElement>(null);
  const requestDialogRef = useRef<HTMLElement>(null);
  const endDialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!memberId) {
        setPageError("暂时找不到这位用户。");
        setLoading(false);
        return;
      }
      try {
        setPageError("");
        setInterestRequired(false);
        const [memberResult, sessionResult] = await Promise.all([getMember(memberId), createAvatarSession(memberId)]);
        const activeSessionId = sessionResult.session.id;
        const [history, analysisResult, chatRequestsResult, sessionsResult] = await Promise.all([
          getAvatarMessages(activeSessionId),
          getAvatarAnalysis(activeSessionId),
          getChatRequests().catch(() => ({ items: [] })),
          getAvatarSessions(),
        ]);
        if (!active) return;
        const existingRequest = chatRequestsResult.items
          .filter((item) => item.memberId === memberId && item.status !== "rejected")
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
        setMember(memberResult.member);
        setSessionId(activeSessionId);
        setAnalysis(analysisResult.analysis);
        setChatRequestStatus(existingRequest?.status === "expired" ? "none" : existingRequest?.status ?? "none");
        setMessages(history.items.map((message) => ({ id: message.id, side: message.sender, text: message.text })));
        setHistoricalSessions(sessionsResult.items
          .filter((session) => session.memberId === memberId && session.status === "paused" && session.id !== activeSessionId)
          .reverse());
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.code === "INTEREST_REQUIRED") setInterestRequired(true);
        setPageError(error instanceof Error ? error.message : "AI 分身暂时无法连接。");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [loadAttempt, memberId]);

  async function createInterestAndRetry() {
    if (!memberId || interestBusy) return;
    setInterestBusy(true);
    setPageError("");
    try {
      await createInterest(memberId);
      setLoadAttempt((attempt) => attempt + 1);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "暂时无法设为心仪，请稍后重试。");
    } finally {
      setInterestBusy(false);
    }
  }

  useEffect(() => {
    if (!reportOpen) return;
    const dialogElement = reportDialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableElements = () => Array.from(dialogElement?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]") ?? []);
    focusableElements()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setReportOpen(false);
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
  }, [reportOpen]);

  useEffect(() => {
    if (!requestConfirmOpen) return;
    const dialogElement = requestDialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableElements = () => Array.from(dialogElement?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    focusableElements()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !requestingChat) {
        event.preventDefault();
        setRequestConfirmOpen(false);
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
  }, [requestConfirmOpen, requestingChat]);

  useEffect(() => {
    if (!endConfirmOpen) return;
    const dialogElement = endDialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableElements = () => Array.from(dialogElement?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    focusableElements()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !endingSession) {
        event.preventDefault();
        setEndConfirmOpen(false);
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
  }, [endConfirmOpen, endingSession]);

  async function send(text = draft, retryMessageId?: string) {
    const question = text.trim();
    if (!question || !sessionId || sending) return;
    const optimisticMessageId = retryMessageId ?? `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setSending(true);
    setLiveError("");
    setDraft("");
    setMessages((current) => retryMessageId
      ? current.map((message) => message.id === retryMessageId ? { ...message, deliveryStatus: "sending" } : message)
      : [...current, { id: optimisticMessageId, side: "user", text: question, isNew: true, deliveryStatus: "sending" }]);
    try {
      const result = await sendAvatarMessage(sessionId, question, optimisticMessageId, Boolean(retryMessageId), selectedTopic || undefined);
      setMessages((current) => [...current.filter((message) => message.id !== optimisticMessageId), ...result.messages.map((message) => ({ id: message.id, side: message.sender, text: message.text, isNew: true }))]);
      const analysisResult = await getAvatarAnalysis(sessionId);
      setAnalysis(analysisResult.analysis);
      setLiveError("");
    } catch (error) {
      setMessages((current) => current.map((message) => message.id === optimisticMessageId ? { ...message, deliveryStatus: "failed" } : message));
      setLiveError(error instanceof Error ? error.message : "AI 分身暂时无法回复。");
    } finally {
      setSending(false);
    }
  }

  async function submitReport() {
    const targetUserId = (member as (Member & { userId?: string }) | null)?.userId;
    const evidenceSessionId = viewedHistorySession?.id ?? sessionId;
    if (!targetUserId || !evidenceSessionId || reporting) return;
    const displayedEvidenceMessage = [...(viewedHistorySession ? historyMessages : messages)].reverse().find((message) => message.side === "avatar");
    setReporting(true);
    try {
      await createReport({
        targetUserId,
        reason: "AI 回答异常",
        description: "AI 分身回答可能不准确或包含不适当内容，请管理员复核。",
        avatarSessionId: evidenceSessionId,
        ...(displayedEvidenceMessage ? { messageId: displayedEvidenceMessage.id } : {}),
      });
      setReportStatus("举报已提交，管理员会尽快核查。");
      setReportOpen(false);
    } catch (error) {
      setReportStatus(error instanceof Error ? error.message : "举报提交失败，请稍后重试。");
    } finally {
      setReporting(false);
    }
  }

  async function requestChat() {
    if (!sessionId || !analysis.canRequestChat || requestingChat) return;
    setRequestingChat(true);
    try {
      const result = await requestHumanChat(sessionId);
      setChatRequestStatus(result.request.status === "rejected" || result.request.status === "expired" ? "none" : result.request.status);
      setLiveError("");
      setRequestConfirmOpen(false);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "申请发送失败，请稍后重试。");
    } finally {
      setRequestingChat(false);
    }
  }

  async function endSession() {
    if (!sessionId || endingSession) return;
    setEndingSession(true);
    setLiveError("");
    try {
      await endAvatarSession(sessionId);
      setSessionEnded(true);
      setEndConfirmOpen(false);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "结束本次了解失败，请稍后重试。");
    } finally {
      setEndingSession(false);
    }
  }

  async function viewHistorySession(historySession: AvatarSessionSummary) {
    if (historyLoading) return;
    setViewedHistorySession(historySession);
    setHistoryMessages([]);
    setHistoryError("");
    setHistoryLoading(true);
    setHistoryOpen(false);
    try {
      const result = await getAvatarMessages(historySession.id);
      setHistoryMessages(result.items.map((message) => ({ id: message.id, side: message.sender, text: message.text })));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "历史记录读取失败，请稍后重试。");
    } finally {
      setHistoryLoading(false);
    }
  }

  function returnToCurrentSession() {
    setViewedHistorySession(null);
    setHistoryMessages([]);
    setHistoryError("");
    setHistoryOpen(false);
  }

  if (loading) return <div className="page-shell shell"><div className="empty-state"><Bot /><h1>正在连接 AI 分身</h1><p>正在读取本人授权的资料与聊天记录。</p></div></div>;
  if (interestRequired) return <div className="page-shell shell"><div className="empty-state" role="alert"><ShieldCheck /><h1>先设为心仪，再开始了解</h1><p>{pageError || "AI 分身聊天仅向心仪对象开放。"}</p><button className="button button--primary" type="button" disabled={interestBusy} onClick={() => void createInterestAndRetry()}><Check />{interestBusy ? "正在设置..." : "设为心仪并继续"}</button><Link className="button button--text" to={memberId ? `/member/${memberId}` : "/matchmaking"}>返回会员资料</Link></div></div>;
  if (pageError || !member) return <div className="page-shell shell"><div className="empty-state"><ShieldCheck /><h1>暂时无法开始了解</h1><p>{pageError || "暂时找不到这位用户。"}</p><Link className="button button--primary" to="/matchmaking">返回智能牵线</Link></div></div>;

  const completedTopics = analysis.completedTopics.length;
  const remainingTopics = Math.max(3 - completedTopics, 0);
  const viewingHistory = viewedHistorySession !== null;
  const displayedMessages = viewingHistory ? historyMessages : messages;
  const visibleMessages = displayedMessages.length
    ? displayedMessages
    : viewingHistory
      ? []
      : [{ id: "greeting", side: "avatar" as const, text: `你好，我是${member.nickname}的 AI 分身。我只会根据 TA 本人授权的婚恋档案，回答生活习惯、沟通方式和关系期待方面的问题。` }];
  const advisorSuggestions = [
    { label: "先问她周末怎么安排", prompt: "TA 平时喜欢怎样安排周末？" },
    { label: "先了解她的关系期待", prompt: "TA 希望建立怎样的关系？" },
  ];

  return (
    <div className="chat-page shell">
      <header className="chat-header">
        <Link className="icon-button" to="/matchmaking" aria-label="返回智能牵线"><ChevronLeft /></Link>
        <img src={member.photoUrl} alt={`${member.nickname}的头像`} />
        <div><strong>{member.nickname}的 AI 分身</strong><span><Bot size={15} />{member.demo ? "演示对话 · " : ""}不是本人实时回复</span></div>
        <div className="chat-header__actions">
          <button className="button button--soft" type="button" aria-label={`历史了解记录，共 ${historicalSessions.length} 轮`} aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}><History />历史记录{historicalSessions.length ? ` (${historicalSessions.length})` : ""}</button>
          {!viewingHistory ? <button className="button button--text" type="button" disabled={sessionEnded} onClick={() => setEndConfirmOpen(true)}><CircleStop />{sessionEnded ? "了解已结束" : "结束本次了解"}</button> : null}
          <button className="icon-button" type="button" aria-label="举报 AI 回答" title="举报 AI 回答" onClick={() => setReportOpen(true)}><Flag /></button>
        </div>
      </header>
      <div className="chat-disclosure"><ShieldCheck />这是根据 TA 授权的婚恋档案生成的 AI 分身，不会提供联系方式，也不能替本人承诺。</div>
      {historyOpen ? <section className="chat-history-panel" aria-label="历史了解记录">
        <div className="chat-history-panel__heading"><div><History /><span><strong>历史了解记录</strong><small>可以查看以前与{member.nickname} AI 分身的对话</small></span></div><button className="icon-button" type="button" aria-label="关闭历史了解记录" onClick={() => setHistoryOpen(false)}><X /></button></div>
        {historicalSessions.length ? <div className="chat-history-panel__list">
          {historicalSessions.map((historySession, index) => <button type="button" key={historySession.id} aria-label={`第 ${index + 1} 轮，已结束，完成 ${historySession.completedTopicCount} 个主题`} aria-current={viewedHistorySession?.id === historySession.id ? "true" : undefined} onClick={() => void viewHistorySession(historySession)}><span><strong>第 {index + 1} 轮了解</strong><small>已结束 · 完成 {historySession.completedTopicCount} 个主题</small></span><ChevronLeft /></button>)}
        </div> : <p className="chat-history-panel__empty">还没有已结束的历史记录。</p>}
      </section> : null}
      <div className="chat-layout">
        <aside className="chat-profile">
          <img src={member.photoUrl} alt="" />
          <h2>{member.nickname}，{member.age} 岁</h2>
          <p>{member.city} · {member.job}</p>
          <div className="tag-list">{member.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          <Link className="inline-link" to={`/member/${member.id}`}>查看本人资料</Link>
        </aside>
        <section className={`chat-window${viewingHistory ? " is-history" : ""}`} aria-label={`与${member.nickname}的AI分身聊天`}>
          {viewingHistory ? <div className="chat-history-readonly" role="status" aria-label="历史记录只读提示"><span><History /><strong>正在查看历史记录</strong></span><p>历史记录仅供查看，不能继续提问。</p><button className="button button--primary" type="button" onClick={returnToCurrentSession}><ChevronLeft />返回当前了解</button></div> : null}
          <div className="chat-messages" role="log" aria-live="polite" aria-label="聊天记录">
            {historyLoading ? <div className="chat-reply-status" role="status"><History /><span>正在读取历史记录...</span></div> : null}
            {historyError ? <p className="form-tip" role="alert">{historyError}</p> : null}
            {viewingHistory && !historyLoading && !historyError && !visibleMessages.length ? <div className="empty-state chat-history-empty"><History /><h2>本轮没有聊天消息</h2><p>这次了解已经结束，没有留下可查看的问答。</p></div> : null}
            {visibleMessages.map((message, index) => <div className={`chat-bubble chat-bubble--${message.side}${message.isNew ? " chat-bubble--new" : ""}`} data-chat-message={message.isNew ? "new" : "history"} data-message-role={message.side} key={`${message.id}-${index}`}><span>{message.side === "avatar" ? <Bot /> : <UserRound />}</span><div className="chat-bubble__content"><p>{message.text}</p>{message.deliveryStatus === "failed" ? <button className="button button--text chat-message-retry" type="button" aria-label={`重新发送：${message.text}`} onClick={() => void send(message.text, message.id)}>重新发送</button> : null}</div></div>)}
            {sending && !viewingHistory ? <div className="chat-reply-status" role="status" aria-label="AI 回复状态"><Bot /><span>AI 分身正在回复...</span></div> : null}
          </div>
          {!viewingHistory ? <section className={`chat-readiness${analysis.canRequestChat ? " is-ready" : ""}`} data-readiness-state={analysis.readiness} aria-label="进一步了解建议">
            <div className="chat-readiness__heading" data-readiness-state={analysis.readiness} role="status" aria-label="进一步了解进度"><span>{analysis.canRequestChat ? <Check /> : <MessageCircleMore />}</span><div><strong>{analysis.canRequestChat ? "基础了解已完成" : `再了解 ${remainingTopics} 个主题`}</strong><span>已完成 {completedTopics}/3 个了解主题</span><p>{analysis.canRequestChat ? "可以申请与本人进一步聊天。" : analysis.summary}</p></div></div>
            {analysis.canRequestChat ? <div className="chat-advice"><div><span>值得继续了解</span><p>{analysis.commonPoints.join("、") || "你们已经完成了基础了解。"}</p></div><div><span>建议当面确认</span><p>{analysis.discussionTopics.join("、") || "未来生活安排可以在真人聊天中继续交流。"}</p></div></div> : null}
            {chatRequestStatus === "pending" ? <p className="chat-request-sent" role="status"><Check />申请已发送，等待对方回应</p> : null}
            {chatRequestStatus === "accepted" ? <p className="chat-request-sent" role="status"><Check /><span>对方已同意，可以开始真人聊天 <Link className="inline-link" to="/messages">进入真人聊天</Link></span></p> : null}
            {chatRequestStatus === "none" || chatRequestStatus === "rejected" ? <button className="button button--primary" type="button" disabled={!analysis.canRequestChat} onClick={() => { setLiveError(""); setRequestConfirmOpen(true); }}>申请与本人聊天<MessageCircleMore /></button> : null}
          </section> : null}
          {liveError ? <p className="form-tip" role="status" aria-label="AI 消息错误">{liveError}</p> : null}
          {!viewingHistory && (sessionEnded ? <section className="empty-state chat-ended-state" aria-live="polite"><Check /><h2>本次了解已结束</h2><p>聊天记录仍会保留。再次进入这位用户的 AI 分身时，可以开始新一轮了解。</p><Link className="button button--soft" to={`/member/${member.id}`}>返回本人资料</Link></section> : <>
            <section className="chat-advisor" aria-label="AI 约会顾问">
              <div className="chat-advisor__title-row"><MessageCircleMore /><strong>AI 约会顾问</strong></div>
              <p>先从生活习惯和相处节奏开始，不急于谈深层承诺，能更稳妥地推进关系。</p>
              <div className="chat-advisor__actions">
                {advisorSuggestions.map((suggestion) => (
                  <button key={suggestion.label} type="button" onClick={() => setDraft(suggestion.prompt)}>{suggestion.label}</button>
                ))}
              </div>
            </section>
            <div className="chat-suggestions" aria-label="快捷问题">{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => setDraft(suggestion)}>{suggestion}</button>)}</div>
            <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
              <div className="chat-composer__meta">
                <label htmlFor="avatar-topic">选择定位</label>
                <select id="avatar-topic" value={selectedTopic} onChange={(event) => setSelectedTopic(event.target.value as (typeof avatarTopicOptions)[number]["value"])}>
                  {avatarTopicOptions.map((option) => <option key={option.value || "auto"} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <label htmlFor="chat-input">输入想了解的问题</label>
              <textarea id="chat-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="例如：TA 平时喜欢怎样安排周末？" />
              <div><button className="button button--text" type="button" onClick={() => setReportOpen(true)}><Flag />举报回答</button><button className="button button--primary" type="submit" disabled={sending || !draft.trim()}>{sending ? "回复中..." : "发送"}<Send /></button></div>
            </form></>) }
          {reportStatus ? <p className="form-tip" role="status">{reportStatus}</p> : null}
        </section>
      </div>
      {requestConfirmOpen ? <div className="modal-backdrop" role="presentation"><section ref={requestDialogRef} className="safety-dialog" role="dialog" aria-modal="true" aria-labelledby="request-chat-dialog-title"><button className="icon-button" type="button" aria-label="关闭申请确认窗口" disabled={requestingChat} onClick={() => setRequestConfirmOpen(false)}><X /></button><MessageCircleMore /><h2 id="request-chat-dialog-title">确认申请与本人聊天</h2><p>确认后会向{member.nickname}本人发送聊天申请，对方可以选择同意或拒绝。</p>{liveError ? <p className="form-tip" role="status">{liveError}</p> : null}<div className="member-profile__actions"><button className="button button--soft" type="button" disabled={requestingChat} onClick={() => setRequestConfirmOpen(false)}>取消</button><button className="button button--primary" type="button" disabled={requestingChat} onClick={() => void requestChat()}>{requestingChat ? "发送中..." : "确认发送申请"}</button></div></section></div> : null}
      {endConfirmOpen ? <div className="modal-backdrop" role="presentation"><section ref={endDialogRef} className="safety-dialog" role="dialog" aria-modal="true" aria-labelledby="end-avatar-dialog-title"><button className="icon-button" type="button" aria-label="关闭结束了解确认窗口" disabled={endingSession} onClick={() => setEndConfirmOpen(false)}><X /></button><CircleStop /><h2 id="end-avatar-dialog-title">确认结束本次了解</h2><p>结束后不能在本次会话中继续提问，聊天记录仍会保留。</p>{liveError ? <p className="form-tip" role="status">{liveError}</p> : null}<div className="member-profile__actions"><button className="button button--soft" type="button" disabled={endingSession} onClick={() => setEndConfirmOpen(false)}>取消</button><button className="button button--primary" type="button" disabled={endingSession} onClick={() => void endSession()}>{endingSession ? "处理中..." : "确认结束了解"}</button></div></section></div> : null}
      {reportOpen ? <div className="modal-backdrop" role="presentation"><section ref={reportDialogRef} className="safety-dialog" role="dialog" aria-modal="true" aria-labelledby="report-dialog-title"><button className="icon-button" type="button" aria-label="关闭举报窗口" onClick={() => setReportOpen(false)}><X /></button><Flag /><h2 id="report-dialog-title">举报 AI 回答</h2><p>提交后管理员会检查相关会话。举报不会自动向对方公开。</p><div className="member-profile__actions"><button className="button button--soft" type="button" onClick={() => setReportOpen(false)}>取消</button><button className="button button--primary" type="button" disabled={reporting} onClick={() => void submitReport()}>{reporting ? "提交中..." : "提交举报"}</button></div></section></div> : null}
    </div>
  );
}
