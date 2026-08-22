import type { AccountAppeal, AdminModeration, AvatarReplyFailureTask, ContentItem, UserRole } from "@ai-marriage/shared";
import {
  Activity,
  BookOpenText,
  Bot,
  Check,
  ClipboardCheck,
  FileClock,
  FileQuestion,
  Flag,
  HeartPulse,
  Image,
  ListChecks,
  LockKeyhole,
  Pencil,
  Power,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useOutletContext } from "react-router-dom";
import {
  approvePhoto,
  approveProfile,
  createAdminContent,
  deleteAdminContent,
  getAdminAccounts,
  getAdminAccess,
  getAdminAppeals,
  getAdminAuditEntries,
  getAdminAvatarReplyFailures,
  getAdminContent,
  getAdminModeration,
  getAdminOperations,
  getAdminReports,
  publishAdminContent,
  rejectPhoto,
  rejectProfile,
  retryAdminAvatarReplyFailure,
  resolveReport,
  restoreAdminAccount,
  reviewAdminAppeal,
  runAdminCleanup,
  suspendAdminAccount,
  takeAdminContentOffline,
  updateAdminContent,
  verifyAdminAccess,
  type AdminAccount,
  type AdminAuditEntry,
  type AdminReport,
  type AdminOperationsSummary,
  type CreateAdminContentInput,
} from "../api/client";
import "./AdminReviewPage.css";

type Tab = "moderation" | "reports" | "accounts" | "appeals" | "content" | "ai" | "audit" | "operations";
type LoadableTab = Exclude<Tab, "moderation" | "reports">;
type AdminAccessView = "checking" | "required" | "verified" | "error";

const tabs: Array<{ id: Tab; label: string; icon: typeof ClipboardCheck }> = [
  { id: "moderation", label: "资料与照片", icon: ClipboardCheck },
  { id: "reports", label: "举报处理", icon: Flag },
  { id: "accounts", label: "账号管理", icon: UserCog },
  { id: "appeals", label: "申诉审核", icon: FileQuestion },
  { id: "content", label: "内容发布", icon: BookOpenText },
  { id: "ai", label: "AI 任务", icon: Bot },
  { id: "audit", label: "操作审计", icon: ScrollText },
  { id: "operations", label: "系统运维", icon: Activity },
];

const reviewerTabs = new Set<Tab>(["moderation", "reports"]);

const accountStatusText: Record<AdminAccount["status"], string> = {
  active: "使用中",
  suspended: "已停用",
  deleted: "已注销",
};

const appealStatusText: Record<AccountAppeal["status"], string> = {
  pending: "等待处理",
  reviewing: "正在复核",
  approved: "申诉已通过",
  rejected: "申诉未通过",
};

const contentStatusText: Record<ContentItem["status"], string> = {
  draft: "草稿",
  published: "已发布",
  offline: "已下线",
};

const maintenanceStatusText = {
  running: "执行中",
  succeeded: "执行成功",
  failed: "执行失败",
} as const;

const cleanupTargetText: Record<string, string> = {
  accountDeletions: "到期注销账号",
  otp: "过期验证码",
  sessions: "过期会话",
  dataExports: "过期导出文件",
  typing: "输入状态",
  eventHistory: "事件历史",
};

const maintenanceTaskText: Record<string, string> = {
  "expired-resource-cleanup": "过期资源清理",
};

const serviceUnavailableText: Record<LoadableTab, string> = {
  accounts: "账号管理服务暂未接入",
  appeals: "申诉审核服务暂未接入",
  content: "内容列表暂时无法读取",
  ai: "AI 失败任务暂时无法读取",
  audit: "操作审计服务暂未接入",
  operations: "运维数据服务暂未接入",
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? `${fallback}：${error.message}` : fallback;
}

function formatDate(value: string | number | null) {
  if (value === null) return "暂无记录";
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function reportPartyText(party: AdminReport["reporter"], fallbackUserId: string) {
  if (!party) return fallbackUserId;
  return [party.nickname?.trim() || party.userId || fallbackUserId, party.city?.trim()].filter(Boolean).join(" · ");
}

function contextSummary(context: Record<string, unknown>) {
  const summary = Object.entries(context)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
  return summary || "无附加信息";
}

function ReportEvidence({ evidence }: { evidence: AdminReport["evidence"] }) {
  if (!evidence) return null;
  const conversationId = evidence.conversationId ?? evidence.targetConversationId;
  const avatarSessionId = evidence.avatarSessionId ?? evidence.targetAvatarSessionId;
  const messageId = evidence.messageId ?? evidence.targetMessageId;
  const messages = Array.isArray(evidence.messages) ? evidence.messages : [];
  const sourceText = evidence.source === "human_message" ? "真人消息证据" : evidence.source === "avatar_session" ? "AI 会话证据" : "关联证据";

  return <div className="admin-report-evidence">
    <strong>{sourceText}</strong>
    <dl>
      {conversationId ? <div><dt>会话编号</dt><dd>{conversationId}</dd></div> : null}
      {avatarSessionId ? <div><dt>AI 会话编号</dt><dd>{avatarSessionId}</dd></div> : null}
      {messageId ? <div><dt>消息编号</dt><dd>{messageId}</dd></div> : null}
    </dl>
    {messages.length ? <ul>{messages.map((item, index) => <li key={item.id ?? `${item.sender ?? "message"}-${index}`}><span>{item.sender || "相关消息"}</span><p>{item.text || "未提供消息正文"}</p></li>)}</ul> : null}
  </div>;
}

function ServiceState({ icon: Icon, title, detail, loading = false }: { icon: typeof ClipboardCheck; title: string; detail?: string; loading?: boolean }) {
  return <div className="admin-service-state" role={loading ? "status" : undefined}>
    <Icon aria-hidden="true" />
    <h2>{title}</h2>
    {detail ? <p>{detail}</p> : null}
  </div>;
}

export function AdminReviewPage() {
  const outletContext = useOutletContext<{ userRole?: UserRole } | undefined>();
  const userRole = outletContext?.userRole ?? "admin";
  const visibleTabs = userRole === "admin" ? tabs : tabs.filter(({ id }) => reviewerTabs.has(id));
  const [tab, setTab] = useState<Tab>("moderation");
  const [moderation, setModeration] = useState<AdminModeration>({ profiles: [], photos: [] });
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [appeals, setAppeals] = useState<AccountAppeal[] | null>(null);
  const [contents, setContents] = useState<ContentItem[] | null>(null);
  const [avatarFailures, setAvatarFailures] = useState<AvatarReplyFailureTask[] | null>(null);
  const [auditEntries, setAuditEntries] = useState<AdminAuditEntry[] | null>(null);
  const [operations, setOperations] = useState<AdminOperationsSummary | null>(null);
  const [loadedTabs, setLoadedTabs] = useState<Set<LoadableTab>>(new Set());
  const [loadingTabs, setLoadingTabs] = useState<Set<LoadableTab>>(new Set());
  const [serviceErrors, setServiceErrors] = useState<Partial<Record<LoadableTab, string>>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [queueError, setQueueError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [busyPhotoIds, setBusyPhotoIds] = useState<Set<string>>(new Set());
  const [accessView, setAccessView] = useState<AdminAccessView>("checking");
  const [accessCode, setAccessCode] = useState("");
  const [accessError, setAccessError] = useState("");
  const [accessBusy, setAccessBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [photoReasons, setPhotoReasons] = useState<Record<string, string>>({});
  const [resolution, setResolution] = useState("");
  const [accountReason, setAccountReason] = useState("");
  const [appealResolution, setAppealResolution] = useState("");
  const [contentForm, setContentForm] = useState({ type: "activity" as "activity" | "story" | "classroom" | "topic" | "moment", title: "", summary: "", body: "", tags: "", startsAt: "", endsAt: "", location: "", capacity: "" });
  const [editingContentId, setEditingContentId] = useState<string | null>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  const loadInitialQueues = useCallback(async () => {
    setLoading(true);
    setQueueError("");
    const [moderationResult, reportsResult] = await Promise.allSettled([getAdminModeration(), getAdminReports()]);
      const errors: string[] = [];
      if (moderationResult.status === "fulfilled") setModeration(moderationResult.value);
      else errors.push(errorMessage(moderationResult.reason, "资料与照片队列暂时无法读取"));
      if (reportsResult.status === "fulfilled") setReports(reportsResult.value.items);
      else errors.push(errorMessage(reportsResult.reason, "举报队列暂时无法读取"));
      if (errors.length) setQueueError(errors.join("；"));
    setLoading(false);
  }, []);

  const checkAdminAccess = useCallback(async () => {
    setAccessView("checking");
    setAccessError("");
    try {
      const state = await getAdminAccess();
      if (state.verified) {
        setAccessView("verified");
        await loadInitialQueues();
      } else {
        setAccessView("required");
        setLoading(false);
      }
    } catch (error) {
      setAccessView("error");
      setAccessError(errorMessage(error, "暂时无法验证后台访问权限"));
      setLoading(false);
    }
  }, [loadInitialQueues]);

  useEffect(() => { void checkAdminAccess(); }, [checkAdminAccess]);

  const loadTab = useCallback(async (target: LoadableTab, force = false) => {
    if (!force && (loadedTabs.has(target) || loadingTabs.has(target) || serviceErrors[target])) return;
    setLoadingTabs((current) => new Set(current).add(target));
    setServiceErrors((current) => ({ ...current, [target]: undefined }));
    try {
      if (target === "accounts") {
        const result = await getAdminAccounts();
        if (!Array.isArray(result?.items)) throw new Error("接口未返回账号列表");
        setAccounts(result.items);
      } else if (target === "appeals") {
        const result = await getAdminAppeals();
        if (!Array.isArray(result?.items)) throw new Error("接口未返回申诉列表");
        setAppeals(result.items);
      } else if (target === "content") {
        const result = await getAdminContent();
        if (!Array.isArray(result?.items)) throw new Error("接口未返回内容列表");
        setContents(result.items);
      } else if (target === "ai") {
        const result = await getAdminAvatarReplyFailures();
        if (!Array.isArray(result?.items)) throw new Error("接口未返回 AI 失败任务列表");
        setAvatarFailures(result.items);
      } else if (target === "audit") {
        const result = await getAdminAuditEntries();
        if (!Array.isArray(result?.items)) throw new Error("接口未返回审计记录");
        setAuditEntries(result.items);
      } else {
        const result = await getAdminOperations();
        if (!result?.health || !result.requests || !result.maintenance) throw new Error("接口未返回运维摘要");
        setOperations(result);
      }
      setLoadedTabs((current) => new Set(current).add(target));
    } catch (error) {
      setServiceErrors((current) => ({ ...current, [target]: errorMessage(error, serviceUnavailableText[target]) }));
    } finally {
      setLoadingTabs((current) => {
        const next = new Set(current);
        next.delete(target);
        return next;
      });
    }
  }, [loadedTabs, loadingTabs, serviceErrors]);

  function selectTab(target: Tab) {
    setTab(target);
    setMessage("");
    setActionError("");
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentTab: Tab) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const currentIndex = visibleTabs.findIndex((item) => item.id === currentTab);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextTab = visibleTabs[(currentIndex + direction + visibleTabs.length) % visibleTabs.length]!.id;
    selectTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  useEffect(() => {
    if (accessView === "verified" && userRole === "admin" && tab !== "moderation" && tab !== "reports") void loadTab(tab);
  }, [accessView, loadTab, tab, userRole]);

  function beginAction(key: string) {
    setBusyAction(key);
    setMessage("");
    setActionError("");
  }

  function failAction(error: unknown, fallback: string) {
    setActionError(errorMessage(error, fallback));
    setBusyAction("");
  }

  async function approveProfileItem(userId: string) {
    beginAction(`profile-${userId}`);
    try {
      await approveProfile(userId);
      setModeration((current) => ({ ...current, profiles: current.profiles.filter((item) => item.userId !== userId) }));
      setMessage("资料已通过");
      setBusyAction("");
    } catch (error) { failAction(error, "暂时无法通过资料"); }
  }

  async function rejectProfileItem(userId: string) {
    if (!reason.trim()) return setActionError("请先填写拒绝原因。");
    beginAction(`profile-${userId}`);
    try {
      await rejectProfile(userId, reason.trim());
      setModeration((current) => ({ ...current, profiles: current.profiles.filter((item) => item.userId !== userId) }));
      setMessage("资料已退回修改");
      setReason("");
      setBusyAction("");
    } catch (error) { failAction(error, "暂时无法退回资料"); }
  }

  async function approvePhotoItem(photoId: string) {
    setBusyPhotoIds((current) => new Set(current).add(photoId));
    setMessage("");
    setActionError("");
    try {
      await approvePhoto(photoId);
      setModeration((current) => ({ ...current, photos: current.photos.filter((item) => item.id !== photoId) }));
      setMessage("照片已通过");
    } catch (error) {
      setActionError(errorMessage(error, "暂时无法通过照片"));
    } finally {
      setBusyPhotoIds((current) => { const next = new Set(current); next.delete(photoId); return next; });
    }
  }

  async function rejectPhotoItem(photoId: string) {
    const photoReason = photoReasons[photoId]?.trim() ?? "";
    if (!photoReason) return setActionError("请先填写照片退回原因。");
    setBusyPhotoIds((current) => new Set(current).add(photoId));
    setMessage("");
    setActionError("");
    try {
      await rejectPhoto(photoId, photoReason);
      setModeration((current) => ({ ...current, photos: current.photos.filter((item) => item.id !== photoId) }));
      setMessage("照片已退回修改");
      setPhotoReasons((current) => {
        const next = { ...current };
        delete next[photoId];
        return next;
      });
    } catch (error) {
      setActionError(errorMessage(error, "暂时无法退回照片"));
    } finally {
      setBusyPhotoIds((current) => { const next = new Set(current); next.delete(photoId); return next; });
    }
  }

  async function submitAdminAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessCode.trim()) return setAccessError("请填写后台访问码。");
    setAccessBusy(true);
    setAccessError("");
    try {
      const state = await verifyAdminAccess(accessCode.trim());
      if (!state.verified) throw new Error("后台访问验证未通过。");
      setAccessCode("");
      setAccessView("verified");
      await loadInitialQueues();
    } catch (error) {
      setAccessError(errorMessage(error, "后台访问验证失败"));
    } finally {
      setAccessBusy(false);
    }
  }

  async function resolveReportItem(reportId: string) {
    if (!resolution.trim()) return setActionError("请填写处理结果。");
    beginAction(`report-${reportId}`);
    try {
      await resolveReport(reportId, resolution.trim());
      setReports((current) => current.map((item) => item.id === reportId ? { ...item, status: "resolved", resolution: resolution.trim() } : item));
      setMessage("举报已处理");
      setResolution("");
      setBusyAction("");
    } catch (error) { failAction(error, "暂时无法处理举报"); }
  }

  async function changeAccountStatus(account: AdminAccount) {
    const reasonText = accountReason.trim();
    if (reasonText.length < 5) return setActionError("账号处理原因至少填写 5 个字。");
    const nextStatus = account.status === "active" ? "suspended" : "active";
    beginAction(`account-${account.id}`);
    try {
      const result = account.status === "active" ? await suspendAdminAccount(account.id, reasonText) : await restoreAdminAccount(account.id, reasonText);
      if (!result?.user || (result.user.status !== "active" && result.user.status !== "suspended")) throw new Error("接口未返回新的账号状态");
      setAccounts((current) => current?.map((item) => item.id === account.id ? { ...item, status: result.user.status } : item) ?? null);
      setMessage(nextStatus === "suspended" ? "账号已停用" : "账号已恢复");
      setAccountReason("");
      setBusyAction("");
    } catch (error) { failAction(error, "暂时无法完成账号操作"); }
  }

  async function reviewAppealItem(appeal: AccountAppeal, decision: "approved" | "rejected") {
    const resolutionText = appealResolution.trim();
    if (resolutionText.length < 2) return setActionError("请填写申诉处理说明。");
    beginAction(`appeal-${appeal.id}`);
    try {
      const result = await reviewAdminAppeal(appeal.id, decision, resolutionText);
      if (!result?.appeal || (result.appeal.status !== "approved" && result.appeal.status !== "rejected")) throw new Error("接口未返回申诉审核结果");
      setAppeals((current) => current?.map((item) => item.id === appeal.id ? { ...item, ...result.appeal, resolution: result.appeal.resolution ?? resolutionText } : item) ?? null);
      setMessage(decision === "approved" ? "申诉已通过" : "申诉已驳回");
      setAppealResolution("");
      setBusyAction("");
    } catch (error) { failAction(error, "暂时无法完成申诉审核"); }
  }

  function createContentInput(): CreateAdminContentInput | null {
    const base = {
      type: contentForm.type,
      title: contentForm.title.trim(),
      summary: contentForm.summary.trim(),
      body: contentForm.body.trim(),
      tags: contentForm.tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
    };
    if (!base.title || !base.summary || !base.body) {
      setActionError("请完整填写标题、摘要和正文。");
      return null;
    }
    if (base.type === "activity") return { ...base, type: "event" as const };
    const startsAt = Date.parse(contentForm.startsAt);
    const endsAt = Date.parse(contentForm.endsAt);
    const capacity = Number(contentForm.capacity);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt || !contentForm.location.trim() || !Number.isInteger(capacity) || capacity < 1) {
      setActionError("请完整填写有效的活动时间、地点和人数。");
      return null;
    }
    return { ...base, type: "event" as const, event: { startsAt, endsAt, location: contentForm.location.trim(), capacity } };
  }

  async function saveContentDraft() {
    const input = createContentInput();
    if (!input) return;
    beginAction(editingContentId ? `edit-content-${editingContentId}` : "create-content");
    try {
      const result = editingContentId ? await updateAdminContent(editingContentId, input) : await createAdminContent(input);
      if (!result?.content?.id) throw new Error("接口未返回已保存的内容");
      setContents((current) => editingContentId
        ? current?.map((item) => item.id === editingContentId ? result.content : item) ?? null
        : [result.content, ...(current ?? [])]);
      setContentForm({ type: "activity", title: "", summary: "", body: "", tags: "", startsAt: "", endsAt: "", location: "", capacity: "" });
      setMessage(editingContentId ? "内容已保存" : "草稿已保存");
      setEditingContentId(null);
      setBusyAction("");
    } catch (error) { failAction(error, editingContentId ? "内容保存失败" : "草稿保存失败"); }
  }

  function editContent(content: ContentItem) {
    setEditingContentId(content.id);
    // Map backend type to frontend type
    const frontendType = content.type === "event" ? "activity" : content.type as "story" | "classroom" | "topic" | "moment";
    setContentForm({
      type: frontendType,
      title: content.title,
      summary: content.summary,
      body: content.body,
      tags: content.tags.join("，"),
      startsAt: content.event ? new Date(content.event.startsAt).toISOString().slice(0, 16) : "",
      endsAt: content.event ? new Date(content.event.endsAt).toISOString().slice(0, 16) : "",
      location: content.event?.location ?? "",
      capacity: content.event ? String(content.event.capacity) : "",
    });
    setMessage(""); setActionError("");
  }

  async function removeAdminContent(content: ContentItem) {
    if (!window.confirm(`确定删除“${content.title}”吗？删除后无法恢复。`)) return;
    beginAction(`delete-content-${content.id}`);
    try {
      await deleteAdminContent(content.id);
      setContents((current) => current?.filter((item) => item.id !== content.id) ?? null);
      if (editingContentId === content.id) setEditingContentId(null);
      setMessage("内容已删除"); setBusyAction("");
    } catch (error) { failAction(error, "内容删除失败"); }
  }

  async function changeContentStatus(content: ContentItem, action: "publish" | "offline") {
    beginAction(`content-${content.id}`);
    try {
      const result = action === "publish" ? await publishAdminContent(content.id) : await takeAdminContentOffline(content.id);
      const expectedStatus = action === "publish" ? "published" : "offline";
      if (!result?.content || result.content.status !== expectedStatus) throw new Error("接口未返回新的内容状态");
      setContents((current) => current?.map((item) => item.id === content.id ? { ...item, ...result.content } : item) ?? null);
      setMessage(action === "publish" ? "内容已发布" : "内容已下线");
      setBusyAction("");
    } catch (error) { failAction(error, action === "publish" ? "内容发布失败" : "内容下线失败"); }
  }

  async function retryAvatarFailure(taskId: string) {
    beginAction(`avatar-failure-${taskId}`);
    try {
      const result = await retryAdminAvatarReplyFailure(taskId);
      if (!result?.task || result.task.status !== "resolved") throw new Error("接口未返回已恢复任务");
      setAvatarFailures((current) => current?.map((item) => item.id === taskId ? result.task : item) ?? null);
      setMessage("AI 回复任务已恢复");
      setBusyAction("");
    } catch (error) { failAction(error, "AI 回复任务重试失败"); }
  }

  async function runCleanup() {
    beginAction("cleanup");
    try {
      const result = await runAdminCleanup();
      if (!result?.run?.id) throw new Error("接口未返回维护任务结果");
      if (result.run.status === "failed") {
        setActionError("清理任务执行失败，请查看最近执行结果与错误摘要。");
      } else if (result.run.status === "succeeded") {
        setMessage("清理任务执行成功，运维数据已刷新。");
      } else {
        setMessage("清理任务已开始，运维数据已刷新。");
      }
      setBusyAction("");
      await loadTab("operations", true);
    } catch (error) { failAction(error, "维护任务执行失败"); }
  }

  const tabLoading = tab !== "moderation" && tab !== "reports" && loadingTabs.has(tab);
  const tabError = tab !== "moderation" && tab !== "reports" ? serviceErrors[tab] : undefined;

  if (accessView !== "verified") return <div className="page-shell shell admin-review">
    <header className="page-header admin-review__header">
      <span>管理员工作台</span>
      <h1>平台审核与运营管理</h1>
      <p>管理入口使用独立访问码保护，验证通过后才能读取会员与平台数据。</p>
    </header>
    {accessView === "checking" ? <ServiceState icon={LockKeyhole} title="正在验证后台访问权限" loading /> : null}
    {accessView === "required" ? <section className="admin-access-panel" aria-labelledby="admin-access-title">
      <LockKeyhole aria-hidden="true" />
      <div><small>二次安全验证</small><h2 id="admin-access-title">验证后台访问码</h2><p>请输入单独配置的后台访问码。它与登录验证码不同。</p></div>
      <form onSubmit={submitAdminAccess}>
        <label><span>后台访问码</span><input type="password" autoComplete="current-password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} disabled={accessBusy} /></label>
        <button className="button button--primary" type="submit" disabled={accessBusy}><LockKeyhole aria-hidden="true" />{accessBusy ? "正在验证..." : "进入管理后台"}</button>
      </form>
      {accessError ? <p className="admin-feedback admin-feedback--error" role="alert"><ShieldAlert aria-hidden="true" />{accessError}</p> : null}
    </section> : null}
    {accessView === "error" ? <section className="admin-access-panel"><ShieldAlert aria-hidden="true" /><div><h2>后台权限暂时无法验证</h2><p>{accessError}</p></div><button className="button button--primary" type="button" onClick={() => void checkAdminAccess()}><RefreshCw aria-hidden="true" />重新验证</button></section> : null}
  </div>;

  return <div className="page-shell shell admin-review">
    <header className="page-header admin-review__header">
      <span>管理员工作台</span>
      <h1>平台审核与运营管理</h1>
      <p>资料审核、账号处理、内容发布和系统状态集中在这里。高风险操作均以服务端结果为准。</p>
    </header>

    <div className="admin-review__tabs" role="tablist" aria-label="管理分类">
      {visibleTabs.map(({ id, label, icon: Icon }) => <button id={`admin-tab-${id}`} aria-controls={`admin-panel-${id}`} type="button" role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className={tab === id ? "is-active" : ""} key={id} ref={(element) => { tabRefs.current[id] = element; }} onClick={() => selectTab(id)} onKeyDown={(event) => handleTabKeyDown(event, id)}><Icon aria-hidden="true" />{label}</button>)}
    </div>

    {message ? <p className="admin-feedback admin-feedback--success" role="status"><Check aria-hidden="true" />{message}</p> : null}
    {actionError || queueError ? <p className="admin-feedback admin-feedback--error" role="alert"><ShieldAlert aria-hidden="true" />{actionError || queueError}</p> : null}
    {visibleTabs.filter(({ id }) => id !== tab).map(({ id }) => <div className="admin-review__tabpanel" id={`admin-panel-${id}`} role="tabpanel" aria-labelledby={`admin-tab-${id}`} hidden key={id} />)}
    <div className="admin-review__tabpanel" id={`admin-panel-${tab}`} role="tabpanel" aria-labelledby={`admin-tab-${tab}`} tabIndex={0}>
      {loading && (tab === "moderation" || tab === "reports") ? <ServiceState icon={ClipboardCheck} title="正在加载审核队列" loading /> : null}
      {tabLoading ? <ServiceState icon={RefreshCw} title="正在读取数据" loading /> : null}
      {tabError && !tabLoading ? <ServiceState icon={ShieldAlert} title={serviceUnavailableText[tab as LoadableTab]} detail={tabError.replace(`${serviceUnavailableText[tab as LoadableTab]}：`, "")} /> : null}

      {tab === "content" && !tabLoading && !tabError && contents ? <section className="admin-panel admin-content-maintenance">
        <div className="admin-panel__heading"><div><small>完整维护</small><h2>编辑与删除</h2><p>选择一条内容进行修改，或删除不再需要的草稿和历史内容。</p></div></div>
        {editingContentId ? <form className="admin-content-form" onSubmit={(event) => { event.preventDefault(); void saveContentDraft(); }}>
          <label><span>标题</span><input aria-label="编辑内容标题" maxLength={100} value={contentForm.title} onChange={(event) => setContentForm((current) => ({ ...current, title: event.target.value }))} /></label>
          <label><span>摘要</span><textarea aria-label="编辑内容摘要" rows={3} maxLength={300} value={contentForm.summary} onChange={(event) => setContentForm((current) => ({ ...current, summary: event.target.value }))} /></label>
          <label><span>正文</span><textarea aria-label="编辑内容正文" rows={6} value={contentForm.body} onChange={(event) => setContentForm((current) => ({ ...current, body: event.target.value }))} /></label>
          <div className="admin-actions"><button className="button button--soft" type="button" onClick={() => setEditingContentId(null)}>取消编辑</button><button className="button button--primary" type="submit" disabled={busyAction === `edit-content-${editingContentId}`}><FileClock aria-hidden="true" />保存修改</button></div>
        </form> : null}
        <div className="admin-content-list">{contents.map((content) => <article key={`maintain-${content.id}`}><div><span className={`admin-status admin-status--${content.status}`}>{contentStatusText[content.status]}</span><h3>内容编号 {content.id}</h3></div><div className="admin-actions"><button className="button button--soft" type="button" aria-label={`编辑内容：${content.title}`} onClick={() => editContent(content)}><Pencil aria-hidden="true" />编辑</button><button className="button button--text" type="button" aria-label={`删除内容：${content.title}`} disabled={busyAction === `delete-content-${content.id}`} onClick={() => void removeAdminContent(content)}><Trash2 aria-hidden="true" />删除</button></div></article>)}</div>
      </section> : null}

    {!loading && tab === "moderation" ? <div className="admin-review-grid">
      <section className="admin-panel"><div className="admin-panel__heading"><div><small>资料队列</small><h2>待审核资料（{moderation.profiles.length}）</h2></div></div>{moderation.profiles.map((profile) => <article className="admin-review-item" key={profile.userId}><div><small>{profile.city} · {profile.job}</small><h3>{profile.nickname}</h3><p>{profile.introduction}</p><span>{profile.gender} · {profile.maritalStatus} · {profile.goal}</span></div><label><span>拒绝原因</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="仅拒绝时填写" /></label><div className="admin-actions"><button className="button button--soft" type="button" disabled={busyAction === `profile-${profile.userId}`} onClick={() => void rejectProfileItem(profile.userId)}><X aria-hidden="true" />退回修改</button><button className="button button--primary" type="button" disabled={busyAction === `profile-${profile.userId}`} onClick={() => void approveProfileItem(profile.userId)}><Check aria-hidden="true" />通过资料</button></div></article>)}{!moderation.profiles.length ? <p className="admin-inline-empty">没有待审核资料。</p> : null}</section>
      <section className="admin-panel"><div className="admin-panel__heading"><div><small>照片队列</small><h2>待审核照片（{moderation.photos.length}）</h2></div></div>{moderation.photos.map((photo) => { const owner = moderation.profiles.find((profile) => profile.userId === photo.userId); const ownerName = owner?.nickname?.trim() || "昵称暂不可用"; const photoBusy = busyPhotoIds.has(photo.id); return <article className="admin-review-photo" key={photo.id}><img src={photo.url} alt={`${ownerName}待审核照片`} /><div><h3>{photo.filename}</h3><p>{ownerName}</p><p>用户 ID：{photo.userId}</p><p>上传时间：<time dateTime={photo.createdAt}>{formatDate(photo.createdAt)}</time></p><p>{Math.ceil(photo.sizeBytes / 1024)} KB · {photo.mimeType}</p><label className="admin-photo-reason"><span>照片退回原因</span><input aria-label={`照片退回原因：${photo.filename}`} maxLength={500} value={photoReasons[photo.id] ?? ""} disabled={photoBusy} onChange={(event) => setPhotoReasons((current) => ({ ...current, [photo.id]: event.target.value }))} placeholder="退回时必填，将告知会员如何修改" /></label><div className="admin-actions"><button className="button button--soft" type="button" disabled={photoBusy} onClick={() => void rejectPhotoItem(photo.id)}><X aria-hidden="true" />{photoBusy ? "正在退回..." : "退回"}</button><button className="button button--primary" type="button" disabled={photoBusy} onClick={() => void approvePhotoItem(photo.id)}><Check aria-hidden="true" />通过照片</button></div></div></article>})}{!moderation.photos.length ? <p className="admin-inline-empty"><Image aria-hidden="true" />没有待审核照片。</p> : null}</section>
    </div> : null}

    {!loading && tab === "reports" ? <section className="admin-panel admin-report-list"><div className="admin-panel__heading"><div><small>安全中心</small><h2>举报处理</h2></div></div>{reports.map((report) => <article key={report.id}><ShieldAlert aria-hidden="true" /><div className="admin-report-card__body"><span>{report.reason}</span><h3>{report.description || "用户提交了安全举报"}</h3><small>{formatDate(report.createdAt)}</small><dl className="admin-report-parties"><div><dt>举报人</dt><dd>{reportPartyText(report.reporter, report.reporterUserId)}</dd></div><div><dt>被举报人</dt><dd>{reportPartyText(report.target, report.targetUserId)}</dd></div></dl><ReportEvidence evidence={report.evidence} />{report.status === "resolved" ? <p>处理结果：{report.resolution}</p> : <label><span>处理结果</span><textarea aria-label="处理结果" value={resolution} onChange={(event) => setResolution(event.target.value)} /></label>}</div>{report.status === "pending" ? <button className="button button--primary" type="button" disabled={busyAction === `report-${report.id}`} onClick={() => void resolveReportItem(report.id)}>完成处理</button> : <span className="approved-state"><Check aria-hidden="true" />已处理</span>}</article>)}{!reports.length ? <ServiceState icon={Flag} title="没有待处理举报" /> : null}</section> : null}

    {tab === "accounts" && !tabLoading && !tabError && accounts ? <section className="admin-panel"><div className="admin-panel__heading"><div><small>会员账号</small><h2>账号列表</h2><p>停用和恢复操作需要填写原因，并以服务端处理结果为准。</p></div><button className="button button--soft" type="button" onClick={() => void loadTab("accounts", true)}><RefreshCw aria-hidden="true" />刷新</button></div><label className="admin-shared-field"><span>账号处理原因</span><input aria-label="账号处理原因" value={accountReason} onChange={(event) => setAccountReason(event.target.value)} placeholder="至少 5 个字，将写入操作记录" /></label><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>会员</th><th>账号状态</th><th>资料</th><th>最近登录</th><th>操作</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}><td><strong>{account.nickname || "未完善昵称"}</strong><small>{account.phoneMasked} · {account.city || "城市未填写"}</small></td><td><span className={`admin-status admin-status--${account.status}`}>{accountStatusText[account.status]}</span></td><td>{account.profileCompleted ? "已完善" : "未完善"}</td><td>{formatDate(account.lastLoginAt)}</td><td>{account.role === "admin" ? <span className="admin-account-lock"><strong>管理员账号</strong><small>不可操作</small></span> : account.status === "deleted" ? "不可操作" : <button className={`button ${account.status === "active" ? "button--soft" : "button--primary"}`} type="button" disabled={busyAction === `account-${account.id}`} onClick={() => void changeAccountStatus(account)}>{account.status === "active" ? <><Power aria-hidden="true" />停用账号</> : <><RefreshCw aria-hidden="true" />恢复账号</>}</button>}</td></tr>)}</tbody></table></div>{!accounts.length ? <ServiceState icon={UserCog} title="没有可管理的账号" /> : null}</section> : null}

    {tab === "appeals" && !tabLoading && !tabError && appeals ? <section className="admin-panel"><div className="admin-panel__heading"><div><small>账号复核</small><h2>申诉审核</h2><p>先阅读申诉原因和补充材料，再填写明确的处理说明。</p></div><button className="button button--soft" type="button" onClick={() => void loadTab("appeals", true)}><RefreshCw aria-hidden="true" />刷新</button></div><label className="admin-shared-field"><span>申诉处理说明</span><textarea aria-label="申诉处理说明" rows={3} value={appealResolution} onChange={(event) => setAppealResolution(event.target.value)} placeholder="说明复核结论和后续安排" /></label><div className="admin-item-list">{appeals.map((appeal) => <article key={appeal.id}><div className="admin-item-list__icon"><FileQuestion aria-hidden="true" /></div><div className="admin-item-list__body"><div className="admin-item-list__meta"><span className={`admin-status admin-status--${appeal.status}`}>{appealStatusText[appeal.status]}</span><time dateTime={appeal.createdAt}>{formatDate(appeal.createdAt)}</time></div><h3>{appeal.reason}</h3><p>账号编号：{appeal.userId}</p>{appeal.evidence.length ? <ul>{appeal.evidence.map((item, index) => <li key={`${appeal.id}-${index}`}>{item}</li>)}</ul> : <p>未提供补充材料。</p>}{appeal.resolution ? <p><strong>处理说明：</strong>{appeal.resolution}</p> : null}</div>{appeal.status === "pending" || appeal.status === "reviewing" ? <div className="admin-actions"><button className="button button--soft" type="button" disabled={busyAction === `appeal-${appeal.id}`} onClick={() => void reviewAppealItem(appeal, "rejected")}><X aria-hidden="true" />驳回申诉</button><button className="button button--primary" type="button" disabled={busyAction === `appeal-${appeal.id}`} onClick={() => void reviewAppealItem(appeal, "approved")}><Check aria-hidden="true" />通过申诉</button></div> : null}</article>)}</div>{!appeals.length ? <ServiceState icon={FileQuestion} title="没有待处理申诉" /> : null}</section> : null}

    {tab === "content" && !tabLoading && !tabError && contents ? <div className="admin-content-layout"><section className="admin-panel"><div className="admin-panel__heading"><div><small>编辑区</small><h2>{editingContentId ? "编辑内容" : "新建内容"}</h2></div></div><form className="admin-content-form" onSubmit={(event) => { event.preventDefault(); void saveContentDraft(); }}><label><span>内容类型</span><select aria-label="内容类型" value={contentForm.type} onChange={(event) => setContentForm((current) => ({ ...current, type: event.target.value as "activity" | "story" | "classroom" | "topic" | "moment" }))}><option value="activity">线下活动</option><option value="story">幸福案例</option><option value="classroom">婚恋课堂</option><option value="topic">话题广场</option><option value="moment">动态</option></select></label><label><span>内容标题</span><input aria-label="内容标题" maxLength={100} value={contentForm.title} onChange={(event) => setContentForm((current) => ({ ...current, title: event.target.value }))} /></label><label><span>内容摘要</span><textarea aria-label="内容摘要" rows={3} maxLength={300} value={contentForm.summary} onChange={(event) => setContentForm((current) => ({ ...current, summary: event.target.value }))} /></label><label><span>内容正文</span><textarea aria-label="内容正文" rows={8} value={contentForm.body} onChange={(event) => setContentForm((current) => ({ ...current, body: event.target.value }))} /></label><label><span>内容标签</span><input aria-label="内容标签" value={contentForm.tags} onChange={(event) => setContentForm((current) => ({ ...current, tags: event.target.value }))} placeholder="多个标签用逗号分开" /></label>{contentForm.type === "activity" ? <div className="admin-event-fields"><label><span>开始时间</span><input aria-label="活动开始时间" type="datetime-local" value={contentForm.startsAt} onChange={(event) => setContentForm((current) => ({ ...current, startsAt: event.target.value }))} /></label><label><span>结束时间</span><input aria-label="活动结束时间" type="datetime-local" value={contentForm.endsAt} onChange={(event) => setContentForm((current) => ({ ...current, endsAt: event.target.value }))} /></label><label><span>活动地点</span><input aria-label="活动地点" value={contentForm.location} onChange={(event) => setContentForm((current) => ({ ...current, location: event.target.value }))} /></label><label><span>人数上限</span><input aria-label="活动人数上限" type="number" min="1" value={contentForm.capacity} onChange={(event) => setContentForm((current) => ({ ...current, capacity: event.target.value }))} /></label></div> : null}<button className="button button--primary" type="submit" disabled={busyAction === (editingContentId ? `edit-content-${editingContentId}` : "create-content")}>{editingContentId ? <><Check aria-hidden="true" />保存修改</> : <><FileClock aria-hidden="true" />保存草稿</>}</button>{editingContentId ? <button className="button button--text" type="button" onClick={() => setEditingContentId(null)}>取消编辑</button> : null}</form></section><section className="admin-panel"><div className="admin-panel__heading"><div><small>内容库</small><h2>内容管理</h2><p>草稿、已发布和已下线内容都会保留在这里。</p></div><button className="button button--soft" type="button" onClick={() => void loadTab("content", true)}><RefreshCw aria-hidden="true" />刷新</button></div><div className="admin-content-list">{contents.map((content) => <article key={content.id}><div><div className="admin-item-list__meta"><span className={`admin-status admin-status--${content.status}`}>{contentStatusText[content.status]}</span><span>{content.type === "event" ? "线下活动" : content.type === "article" ? (content.tags.includes("幸福案例") ? "幸福案例" : content.tags.includes("婚恋课堂") ? "婚恋课堂" : content.tags.includes("话题") ? "话题广场" : content.tags.includes("动态") ? "动态" : "文章") : content.type}</span></div><h3>{content.title}</h3><p>{content.summary}</p>{content.tags.length ? <small>{content.tags.join(" · ")}</small> : null}</div><div className="admin-actions"><button className="button button--soft" type="button" disabled={busyAction === `edit-content-${content.id}`} onClick={() => editContent(content)}><Pencil aria-hidden="true" />编辑</button>{content.status !== "published" ? <button className="button button--primary" type="button" disabled={busyAction === `content-${content.id}`} onClick={() => void changeContentStatus(content, "publish")}><Check aria-hidden="true" />发布</button> : <button className="button button--soft" type="button" disabled={busyAction === `content-${content.id}`} onClick={() => void changeContentStatus(content, "offline")}><Power aria-hidden="true" />下线</button>}</div></article>)}</div>{!contents.length ? <ServiceState icon={BookOpenText} title="还没有内容" detail="可在左侧创建第一篇内容草稿。" /> : null}</section></div> : null}

    {tab === "ai" && !tabLoading && !tabError && avatarFailures ? <section className="admin-panel"><div className="admin-panel__heading"><div><small>异常恢复</small><h2>AI 回复失败任务</h2><p>这里只展示任务编号与脱敏错误，不展示用户原始问题。恢复成功后，回复会自动写回原会话。</p></div><button className="button button--soft" type="button" onClick={() => void loadTab("ai", true)}><RefreshCw aria-hidden="true" />刷新</button></div><div className="admin-item-list admin-ai-task-list">{avatarFailures.map((task) => <article key={task.id}><div className="admin-item-list__icon"><Bot aria-hidden="true" /></div><div className="admin-item-list__body"><div className="admin-item-list__meta"><span className={`admin-status admin-status--${task.status}`}>{task.status === "resolved" ? "已恢复" : "待恢复"}</span><time dateTime={task.updatedAt}>{formatDate(task.updatedAt)}</time></div><h3>任务 {task.id}</h3><dl className="admin-ai-task-details"><div><dt>会员编号</dt><dd>{task.memberId}</dd></div><div><dt>会话编号</dt><dd>{task.sessionId}</dd></div><div><dt>尝试次数</dt><dd>{task.attempts} 次</dd></div></dl>{task.lastError ? <span className="admin-ai-task-error">{task.lastError}</span> : <p>回复已经恢复并写入会话。</p>}</div>{task.status === "pending" ? <div className="admin-actions"><button className="button button--primary" type="button" disabled={busyAction === `avatar-failure-${task.id}`} onClick={() => void retryAvatarFailure(task.id)}><RefreshCw aria-hidden="true" />{busyAction === `avatar-failure-${task.id}` ? "正在恢复..." : "重新生成回复"}</button></div> : null}</article>)}</div>{!avatarFailures.length ? <ServiceState icon={Bot} title="没有待处理的 AI 任务" detail="模型回复正常，暂时不需要人工恢复。" /> : null}</section> : null}

    {tab === "audit" && !tabLoading && !tabError && auditEntries ? <section className="admin-panel"><div className="admin-panel__heading"><div><small>留痕记录</small><h2>操作审计</h2><p>用于追溯管理员的重要操作，不展示敏感原始数据。</p></div><button className="button button--soft" type="button" onClick={() => void loadTab("audit", true)}><RefreshCw aria-hidden="true" />刷新</button></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th></tr></thead><tbody>{auditEntries.map((entry) => <tr key={entry.id}><td>{formatDate(entry.createdAt)}</td><td>{entry.actorUserId}</td><td><strong>{entry.action}</strong></td><td>{entry.targetType}{entry.targetId ? ` · ${entry.targetId}` : ""}</td></tr>)}</tbody></table></div>{!auditEntries.length ? <ServiceState icon={ScrollText} title="目前没有审计记录" /> : null}</section> : null}

    {tab === "operations" && !tabLoading && !tabError && operations ? <section className="admin-operations"><div className="admin-operations__summary"><article><HeartPulse aria-hidden="true" /><span>系统健康</span><strong>{operations.health.status === "healthy" ? "正常" : operations.health.status === "degraded" ? "需要关注" : "异常"}</strong></article><article><ListChecks aria-hidden="true" /><span>请求总数</span><strong>{operations.requests.requestCount}</strong></article><article><ShieldAlert aria-hidden="true" /><span>错误率</span><strong>{(operations.requests.errorRate * 100).toFixed(1)}%</strong></article><article><Activity aria-hidden="true" /><span>平均响应</span><strong>{Math.round(operations.requests.latencyMs.average)} ms</strong></article></div><div className="admin-operations__columns"><section className="admin-panel"><div className="admin-panel__heading"><div><small>组件状态</small><h2>服务健康检查</h2></div><button className="button button--soft" type="button" onClick={() => void loadTab("operations", true)}><RefreshCw aria-hidden="true" />刷新</button></div><ul className="admin-health-list">{operations.health.components.map((component) => <li key={component.name}><span className={`admin-health-dot admin-health-dot--${component.status}`} /><div><strong>{component.name}</strong>{component.detail ? <small>{component.detail}</small> : null}</div><span>{component.status === "healthy" ? "正常" : component.status === "degraded" ? "关注" : "异常"}</span></li>)}</ul></section><section className="admin-panel"><div className="admin-panel__heading"><div><small>日常维护</small><h2>数据清理</h2><p>清理过期验证码、会话和导出文件等临时数据。</p></div></div><dl className="admin-maintenance-stats"><div><dt>成功任务</dt><dd>{operations.maintenance.succeededCount}</dd></div><div><dt>失败任务</dt><dd>{operations.maintenance.failedCount}</dd></div><div><dt>累计清理</dt><dd>{operations.maintenance.totalRemoved}</dd></div></dl><button className="button button--primary" type="button" disabled={busyAction === "cleanup"} onClick={() => void runCleanup()}><RefreshCw aria-hidden="true" />执行安全清理</button></section></div><div className="admin-operations__activity"><section className="admin-panel"><div className="admin-panel__heading"><div><small>维护记录</small><h2>最近执行结果</h2></div></div>{operations.maintenance.recentRuns.length ? <div className="admin-run-list">{operations.maintenance.recentRuns.map((run) => <article key={run.id}><div className="admin-item-list__meta"><span className={`admin-status admin-status--${run.status}`}>{maintenanceStatusText[run.status]}</span><time dateTime={new Date(run.startedAt).toISOString()}>{formatDate(run.startedAt)}</time></div><h3>{maintenanceTaskText[run.taskName] ?? run.taskName}</h3><p>本次清理 {run.totalRemoved} 项</p>{run.results?.length ? <ul>{run.results.map((result, index) => <li key={`${run.id}-${result.target}-${index}`}><div><strong>{cleanupTargetText[result.target] ?? result.target}</strong><span>{result.status === "succeeded" ? `成功 · ${result.removedCount} 项` : "失败"}</span></div>{result.error ? <small>{result.error}</small> : null}</li>)}</ul> : <p className="admin-inline-empty">暂无分步结果。</p>}</article>)}</div> : <p className="admin-inline-empty">暂无维护记录。</p>}</section><section className="admin-panel"><div className="admin-panel__heading"><div><small>异常跟踪</small><h2>最近错误摘要</h2></div></div>{operations.recentErrors.length ? <div className="admin-error-list">{operations.recentErrors.map((item) => <article key={item.id}><div className="admin-item-list__meta"><span className="admin-status admin-status--failed">错误</span><time dateTime={new Date(item.occurredAt).toISOString()}>{formatDate(item.occurredAt)}</time></div><h3>{item.event}</h3><p>{contextSummary(item.context)}</p></article>)}</div> : <p className="admin-inline-empty">近期没有错误记录。</p>}</section></div></section> : null}
    </div>
  </div>;
}
