import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  Eye,
  EyeOff,
  FileQuestion,
  Laptop,
  LoaderCircle,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UserRoundX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  cancelAccountDeletion,
  downloadPersonalDataExport,
  getAccountAppeals,
  getAccountSessions,
  getMe,
  getPersonalDataExports,
  requestAccountDeletion,
  requestPersonalDataExport,
  revokeAccountSession,
  revokeOtherAccountSessions,
  submitAccountAppeal,
  suspendAccount,
  updateProfileVisibility,
} from "../api/client";
import "./AccountSecurityPage.css";

export type ProfileVisibility = "private" | "approved_only" | "public";
export type AppealStatus = "pending" | "reviewing" | "approved" | "rejected" | "resolved";
export type DataExportStatus = "pending" | "ready" | "failed" | "expired";

export interface AccountSession {
  id: string;
  userAgent: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string | number;
  current: boolean;
}

export interface DeletionRequest {
  requestedAt: string;
  scheduledAt: string;
}

export interface AccountAppeal {
  id: string;
  reason: string;
  evidence: string[];
  status: AppealStatus;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DataExportJob {
  id: string;
  status: DataExportStatus;
  createdAt: string;
  readyAt: string | null;
  expiresAt: string | null;
}

export interface AccountSecurityData {
  accountStatus: "active" | "suspended" | "deleted";
  suspensionSource: "self" | "admin" | null;
  visibility: ProfileVisibility;
  sessions: AccountSession[];
  deletionRequest: DeletionRequest | null;
  appeals: AccountAppeal[];
  dataExports: DataExportJob[];
}

export interface AccountSecurityApi {
  load(): Promise<AccountSecurityData>;
  updateVisibility(visibility: ProfileVisibility): Promise<{ visibility: ProfileVisibility }>;
  revokeSession(sessionId: string): Promise<void>;
  revokeOtherSessions(): Promise<void>;
  suspendAccount(reason: string): Promise<void>;
  requestDeletion(): Promise<DeletionRequest>;
  cancelDeletion(): Promise<void>;
  submitAppeal(input: { reason: string; evidence: string[] }): Promise<AccountAppeal>;
  requestDataExport(): Promise<DataExportJob>;
  downloadDataExport(exportId: string): Promise<void>;
}

interface AccountSecurityPageProps {
  api?: AccountSecurityApi;
}

type DialogName = "suspend" | "deletion" | null;

const visibilityOptions: Array<{
  value: ProfileVisibility;
  title: string;
  description: string;
  icon: typeof Eye;
}> = [
  {
    value: "approved_only",
    title: "仅向合适对象展示",
    description: "资料审核通过后，只在平台匹配和联系流程中展示。",
    icon: ShieldCheck,
  },
  {
    value: "public",
    title: "在匹配大厅公开",
    description: "符合平台展示条件的用户可以在匹配大厅看到你的资料。",
    icon: Eye,
  },
  {
    value: "private",
    title: "仅自己可见",
    description: "暂时隐藏资料，不再出现在匹配大厅和推荐结果中。",
    icon: EyeOff,
  },
];

const appealStatusText: Record<AppealStatus, string> = {
  pending: "等待处理",
  reviewing: "正在复核",
  approved: "申诉通过",
  rejected: "未通过",
  resolved: "已处理",
};

const exportStatusText: Record<DataExportStatus, string> = {
  pending: "正在生成",
  ready: "可以下载",
  failed: "生成失败",
  expired: "已过期",
};

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "操作没有完成，请稍后重试。";
}

function formatDate(value: string | number | null) {
  if (value === null) return "";
  const date = typeof value === "number"
    ? new Date(value < 10_000_000_000 ? value * 1_000 : value)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function deviceIcon(userAgent: string) {
  return /iphone|android|mobile/i.test(userAgent) ? Smartphone : Laptop;
}

const defaultApi: AccountSecurityApi = {
  async load() {
    const [account, sessions, appeals, exports] = await Promise.all([getMe(), getAccountSessions(), getAccountAppeals(), getPersonalDataExports()]);
    return {
      accountStatus: account.user.status,
      suspensionSource: account.user.suspensionSource ?? null,
      visibility: account.profile?.visibility ?? "approved_only",
      sessions: sessions.items,
      deletionRequest: account.user.deletionRequestedAt && account.user.deletionScheduledAt ? { requestedAt: account.user.deletionRequestedAt, scheduledAt: account.user.deletionScheduledAt } : null,
      appeals: appeals.items,
      dataExports: exports.items,
    };
  },
  updateVisibility: updateProfileVisibility,
  revokeSession: revokeAccountSession,
  revokeOtherSessions: revokeOtherAccountSessions,
  suspendAccount,
  requestDeletion: requestAccountDeletion,
  cancelDeletion: cancelAccountDeletion,
  async submitAppeal(input) { return (await submitAccountAppeal(input)).appeal; },
  async requestDataExport() { return (await requestPersonalDataExport()).export; },
  downloadDataExport: downloadPersonalDataExport,
};

export function AccountSecurityPage({ api = defaultApi }: AccountSecurityPageProps) {
  const [data, setData] = useState<AccountSecurityData | null>(null);
  const [visibility, setVisibility] = useState<ProfileVisibility>("approved_only");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [dialog, setDialog] = useState<DialogName>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [deletionConfirmed, setDeletionConfirmed] = useState(false);
  const [appealReason, setAppealReason] = useState("");
  const [appealEvidence, setAppealEvidence] = useState("");
  const [appealError, setAppealError] = useState("");
  const [sessionEnded, setSessionEnded] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await api.load();
      setData(result);
      setVisibility(result.visibility);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (!dialog) return;
    const dialogElement = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]";
    const focusableElements = () => Array.from(dialogElement?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    focusableElements()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDialog(null);
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
  }, [dialog]);

  const latestExport = useMemo(() => data?.dataExports
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null, [data?.dataExports]);

  function beginAction(name: string) {
    setBusyAction(name);
    setMessage("");
    setActionError("");
  }

  function failAction(error: unknown) {
    setActionError(getErrorMessage(error));
    setBusyAction("");
  }

  async function saveVisibility() {
    beginAction("visibility");
    try {
      const result = await api.updateVisibility(visibility);
      setData((current) => current ? { ...current, visibility: result.visibility } : current);
      setVisibility(result.visibility);
      setMessage("资料可见范围已保存。");
      setBusyAction("");
    } catch (error) {
      failAction(error);
    }
  }

  async function revokeSession(sessionId: string) {
    beginAction(`session-${sessionId}`);
    try {
      await api.revokeSession(sessionId);
      setData((current) => current ? {
        ...current,
        sessions: current.sessions.filter((session) => session.id !== sessionId),
      } : current);
      setMessage("该设备已退出登录。");
      setBusyAction("");
    } catch (error) {
      failAction(error);
    }
  }

  async function revokeOtherSessions() {
    beginAction("other-sessions");
    try {
      await api.revokeOtherSessions();
      setData((current) => current ? {
        ...current,
        sessions: current.sessions.filter((session) => session.current),
      } : current);
      setMessage("已退出其他设备，只保留当前设备。");
      setBusyAction("");
    } catch (error) {
      failAction(error);
    }
  }

  async function suspendAccount() {
    beginAction("suspend");
    try {
      await api.suspendAccount(suspendReason.trim());
      setDialog(null);
      localStorage.removeItem("ai-marriage-auth-user");
      sessionStorage.removeItem("ai-marriage-auth-profile");
      setSessionEnded(true);
      setBusyAction("");
    } catch (error) {
      failAction(error);
    }
  }

  async function requestDeletion() {
    beginAction("deletion");
    try {
      const deletionRequest = await api.requestDeletion();
      setData((current) => current ? { ...current, deletionRequest } : current);
      setDialog(null);
      setDeletionConfirmed(false);
      setMessage("注销申请已提交，冷静期内可以随时取消。");
      setBusyAction("");
    } catch (error) {
      failAction(error);
    }
  }

  async function cancelDeletion() {
    beginAction("cancel-deletion");
    try {
      await api.cancelDeletion();
      setData((current) => current ? { ...current, deletionRequest: null } : current);
      setMessage("注销申请已取消，账号可以继续正常使用。");
      setBusyAction("");
    } catch (error) {
      failAction(error);
    }
  }

  async function submitAppeal() {
    const reason = appealReason.trim();
    if (reason.length < 5) {
      setAppealError("申诉原因至少填写 5 个字，请说明需要复核的情况。");
      return;
    }
    if (reason.length > 1_000) {
      setAppealError("申诉原因不能超过 1000 个字。");
      return;
    }
    const evidence = appealEvidence.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (evidence.length > 10) {
      setAppealError("补充说明最多填写 10 条，每行一条。");
      return;
    }
    setAppealError("");
    beginAction("appeal");
    try {
      const appeal = await api.submitAppeal({ reason, evidence });
      setData((current) => current ? { ...current, appeals: [appeal, ...current.appeals] } : current);
      setAppealReason("");
      setAppealEvidence("");
      setMessage("申诉已提交，可以在下方查看处理进度。");
      setBusyAction("");
    } catch (error) {
      failAction(error);
    }
  }

  async function requestDataExport() {
    beginAction("export");
    try {
      const exportJob = await api.requestDataExport();
      setData((current) => current ? {
        ...current,
        dataExports: [exportJob, ...current.dataExports.filter((item) => item.id !== exportJob.id)],
      } : current);
      setMessage(exportJob.status === "ready" ? "数据文件已生成，可以下载。" : "数据文件正在生成，请稍后查看。");
      setBusyAction("");
    } catch (error) {
      failAction(error);
    }
  }

  async function downloadDataExport() {
    if (!latestExport) return;
    beginAction("download");
    try {
      await api.downloadDataExport(latestExport.id);
      setMessage("数据文件下载已开始。");
      setBusyAction("");
    } catch (error) {
      failAction(error);
    }
  }

  if (loading) {
    return (
      <div className="page-shell shell account-security">
        <div className="account-security__state" role="status">
          <LoaderCircle className="account-security__spinner" aria-hidden="true" />
          <h1>正在读取账号安全信息</h1>
          <p>请稍候，正在检查资料范围、登录设备和账号状态。</p>
        </div>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="page-shell shell account-security">
        <div className="account-security__state account-security__state--error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <h1>账号安全信息暂时无法读取</h1>
          <p>{loadError || "没有读取到账号数据，请重新加载。"}</p>
          <button className="button button--primary button--large" type="button" onClick={() => void loadPage()}>
            <RefreshCw aria-hidden="true" />重新加载
          </button>
        </div>
      </div>
    );
  }

  const otherSessionCount = data.sessions.filter((session) => !session.current).length;
  const accountRestricted = data.accountStatus !== "active";

  if (sessionEnded) return <Navigate replace to="/auth" />;

  return (
    <div className="page-shell shell account-security">
      <header className="page-header account-security__header">
        <span>我的账号</span>
        <h1>账号与安全</h1>
        <p>管理谁能看到你的资料、已经登录的设备，以及停用、注销、申诉和个人数据。</p>
        <div className="account-security__summary" aria-label="账号安全概况">
          <span>{accountRestricted ? <AlertTriangle aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{data.accountStatus === "suspended" ? data.suspensionSource === "admin" ? "账号已被管理员停用" : "账号已暂停使用" : data.accountStatus === "deleted" ? "账号已注销" : "账号保护正常"}</span>
          <span><MonitorSmartphone aria-hidden="true" />{data.sessions.length} 台设备已登录</span>
          <span><Database aria-hidden="true" />{accountRestricted ? "当前仅可查看记录和提交申诉" : "支持导出个人数据"}</span>
        </div>
      </header>

      {accountRestricted ? <p className="account-security__notice account-security__notice--error" role="alert"><AlertTriangle aria-hidden="true" />{data.suspensionSource === "admin" ? "账号已被管理员停用，当前仅可查看记录和提交申诉。申诉通过后账号会自动恢复。" : "账号当前不可使用普通功能，请通过下方申诉入口联系管理员复核。"}</p> : null}
      {message ? <p className="account-security__notice account-security__notice--success" role="status"><CheckCircle2 aria-hidden="true" />{message}</p> : null}
      {actionError ? <p className="account-security__notice account-security__notice--error" role="alert"><AlertTriangle aria-hidden="true" />{actionError}</p> : null}

      <nav className="account-security__nav" aria-label="账号与安全功能">
        <a href="#visibility"><Eye aria-hidden="true" />资料可见性</a>
        <a href="#sessions"><MonitorSmartphone aria-hidden="true" />登录设备</a>
        <a href="#account-state"><UserRoundX aria-hidden="true" />账号状态</a>
        <a href="#appeals"><FileQuestion aria-hidden="true" />账号申诉</a>
        <a href="#data-export"><Download aria-hidden="true" />数据导出</a>
      </nav>

      <section className="account-security__section" id="visibility" aria-labelledby="visibility-heading">
        <div className="account-security__section-heading">
          <span className="account-security__section-icon"><Eye aria-hidden="true" /></span>
          <div><small>隐私设置</small><h2 id="visibility-heading">资料可见性</h2><p>你可以随时隐藏资料，已经建立的聊天不会被删除。</p></div>
        </div>
        <fieldset className="account-security__choice-list">
          <legend className="sr-only">选择资料可见范围</legend>
          {visibilityOptions.map((option) => {
            const Icon = option.icon;
            return (
              <label className={visibility === option.value ? "is-selected" : undefined} key={option.value}>
                <input type="radio" name="profile-visibility" value={option.value} checked={visibility === option.value} disabled={accountRestricted} onChange={() => setVisibility(option.value)} />
                <span className="account-security__choice-icon"><Icon aria-hidden="true" /></span>
                <span><strong>{option.title}</strong><small>{option.description}</small></span>
              </label>
            );
          })}
        </fieldset>
        <div className="account-security__section-actions">
          <button className="button button--primary button--large" type="button" disabled={accountRestricted || busyAction === "visibility" || visibility === data.visibility} onClick={() => void saveVisibility()}>
            {busyAction === "visibility" ? "正在保存..." : "保存可见范围"}
          </button>
          <small>当前设置：{visibilityOptions.find((item) => item.value === data.visibility)?.title}</small>
        </div>
      </section>

      <section className="account-security__section" id="sessions" aria-labelledby="sessions-heading">
        <div className="account-security__section-heading account-security__section-heading--actions">
          <span className="account-security__section-icon account-security__section-icon--blue"><MonitorSmartphone aria-hidden="true" /></span>
          <div><small>登录保护</small><h2 id="sessions-heading">登录设备</h2><p>发现不认识的设备时，请立即让它退出登录。</p></div>
          <button className="button button--soft button--large" type="button" disabled={accountRestricted || otherSessionCount === 0 || busyAction === "other-sessions"} onClick={() => void revokeOtherSessions()}>
            <LogOut aria-hidden="true" />{busyAction === "other-sessions" ? "正在退出..." : "退出其他设备"}
          </button>
        </div>
        <ul className="account-security__session-list">
          {data.sessions.map((session) => {
            const Icon = deviceIcon(session.userAgent);
            return (
              <li key={session.id}>
                <span className="account-security__device-icon"><Icon aria-hidden="true" /></span>
                <span className="account-security__session-detail">
                  <span><strong>{session.userAgent || "未知设备"}</strong>{session.current ? <small className="account-security__current">当前设备</small> : null}</span>
                  <small>最近使用：{formatDate(session.lastUsedAt)}</small>
                </span>
                {session.current
                  ? <span className="account-security__protected"><ShieldCheck aria-hidden="true" />正在使用</span>
                  : <button className="button button--soft" type="button" disabled={accountRestricted || busyAction === `session-${session.id}`} onClick={() => void revokeSession(session.id)}>{busyAction === `session-${session.id}` ? "正在退出..." : "退出此设备"}</button>}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="account-security__section" id="account-state" aria-labelledby="account-state-heading">
        <div className="account-security__section-heading">
          <span className="account-security__section-icon account-security__section-icon--orange"><UserRoundX aria-hidden="true" /></span>
          <div><small>谨慎操作</small><h2 id="account-state-heading">账号状态</h2><p>暂时不使用可选择停用；确定不再使用时可申请注销。</p></div>
        </div>
        {accountRestricted ? (
          <div className="account-security__cooling">
            <AlertTriangle aria-hidden="true" />
            <div><strong>账号当前处于受限状态</strong><p>普通功能已经暂停，请在“账号申诉”中提交情况说明，等待管理员复核。</p></div>
          </div>
        ) : data.deletionRequest ? (
          <div className="account-security__cooling">
            <Clock3 aria-hidden="true" />
            <div><strong>注销冷静期至 {formatDate(data.deletionRequest.scheduledAt)}</strong><p>冷静期结束前账号仍然保留，你可以取消注销申请。</p></div>
            <button className="button button--primary button--large" type="button" disabled={busyAction === "cancel-deletion"} onClick={() => void cancelDeletion()}>{busyAction === "cancel-deletion" ? "正在取消..." : "取消注销"}</button>
          </div>
        ) : (
          <div className="account-security__account-actions">
            <article><div><strong>暂时停用账号</strong><p>立即退出所有设备并隐藏资料，之后通过手机号验证登录即可恢复。</p></div><button className="button button--soft button--large" type="button" onClick={() => setDialog("suspend")}>停用账号</button></article>
            <article><div><strong>申请注销账号</strong><p>提交后进入 7 天冷静期，期间可取消；冷静期结束后再执行注销。</p></div><button className="account-security__danger-button" type="button" onClick={() => setDialog("deletion")}>申请注销</button></article>
          </div>
        )}
      </section>

      <section className="account-security__section" id="appeals" aria-labelledby="appeals-heading">
        <div className="account-security__section-heading">
          <span className="account-security__section-icon account-security__section-icon--yellow"><FileQuestion aria-hidden="true" /></span>
          <div><small>问题处理</small><h2 id="appeals-heading">账号申诉</h2><p>对账号或资料处理结果有疑问时，可以提交说明申请复核。</p></div>
        </div>
        <div className="account-security__appeal-layout">
          <form className="account-security__form" onSubmit={(event) => { event.preventDefault(); void submitAppeal(); }}>
            <label><span>申诉原因</span><textarea aria-label="申诉原因" rows={5} maxLength={1_000} value={appealReason} onChange={(event) => setAppealReason(event.target.value)} placeholder="请说明需要复核的情况" /></label>
            <label><span>补充说明（选填）</span><textarea aria-label="补充说明（选填）" rows={4} value={appealEvidence} onChange={(event) => setAppealEvidence(event.target.value)} placeholder="每行填写一条，最多 10 条" /></label>
            {appealError ? <p className="account-security__form-error" role="alert">{appealError}</p> : null}
            <button className="button button--primary button--large" type="submit" disabled={busyAction === "appeal"}>{busyAction === "appeal" ? "正在提交..." : "提交申诉"}</button>
          </form>
          <div className="account-security__history" aria-label="申诉记录">
            <h3>申诉记录</h3>
            {data.appeals.length ? <ul>{data.appeals.map((appeal) => <li key={appeal.id}><div><span className={`account-security__status account-security__status--${appeal.status}`}>{appealStatusText[appeal.status]}</span><time dateTime={appeal.createdAt}>{formatDate(appeal.createdAt)}</time></div><strong>{appeal.reason}</strong>{appeal.resolution ? <p>处理说明：{appeal.resolution}</p> : null}</li>)}</ul> : <p className="account-security__empty">目前没有申诉记录。</p>}
          </div>
        </div>
      </section>

      <section className="account-security__section" id="data-export" aria-labelledby="data-export-heading">
        <div className="account-security__section-heading">
          <span className="account-security__section-icon account-security__section-icon--green"><Database aria-hidden="true" /></span>
          <div><small>个人数据</small><h2 id="data-export-heading">个人数据导出</h2><p>生成账号、婚恋档案、照片记录和互动记录的数据文件，仅供本人下载。</p></div>
        </div>
        <div className="account-security__export-panel">
          <div>
            {latestExport ? <><strong>{exportStatusText[latestExport.status]}</strong><p>生成时间：{formatDate(latestExport.createdAt)}{latestExport.expiresAt ? `，下载有效期至 ${formatDate(latestExport.expiresAt)}` : ""}</p></> : <><strong>还没有生成数据文件</strong><p>生成后请妥善保管，文件中可能包含你的个人资料。</p></>}
          </div>
          {latestExport?.status === "ready"
            ? <button className="button button--primary button--large" type="button" disabled={accountRestricted || busyAction === "download"} onClick={() => void downloadDataExport()}><Download aria-hidden="true" />{busyAction === "download" ? "正在下载..." : "下载数据文件"}</button>
            : <button className="button button--primary button--large" type="button" disabled={accountRestricted || busyAction === "export" || latestExport?.status === "pending"} onClick={() => void requestDataExport()}><Database aria-hidden="true" />{busyAction === "export" ? "正在生成..." : "生成数据文件"}</button>}
        </div>
      </section>

      {dialog === "suspend" ? (
        <div className="account-security__dialog-backdrop" role="presentation">
          <section ref={dialogRef} className="account-security__dialog" role="dialog" aria-modal="true" aria-labelledby="suspend-dialog-heading">
            <button className="account-security__dialog-close" type="button" aria-label="关闭" onClick={() => setDialog(null)}><X aria-hidden="true" /></button>
            <span className="account-security__dialog-icon"><LogOut aria-hidden="true" /></span>
            <h2 id="suspend-dialog-heading">确认停用账号</h2>
            <p>停用后会立即退出所有设备，并从匹配大厅隐藏你的资料。之后重新验证手机号即可恢复。</p>
            <label><span>停用原因（选填）</span><textarea aria-label="停用原因（选填）" rows={3} maxLength={500} value={suspendReason} onChange={(event) => setSuspendReason(event.target.value)} /></label>
            <div className="account-security__dialog-actions"><button className="button button--soft button--large" type="button" onClick={() => setDialog(null)}>暂不停用</button><button className="button button--primary button--large" type="button" disabled={busyAction === "suspend"} onClick={() => void suspendAccount()}>{busyAction === "suspend" ? "正在停用..." : "确认停用并退出"}</button></div>
          </section>
        </div>
      ) : null}

      {dialog === "deletion" ? (
        <div className="account-security__dialog-backdrop" role="presentation">
          <section ref={dialogRef} className="account-security__dialog account-security__dialog--danger" role="dialog" aria-modal="true" aria-labelledby="deletion-dialog-heading">
            <button className="account-security__dialog-close" type="button" aria-label="关闭" onClick={() => setDialog(null)}><X aria-hidden="true" /></button>
            <span className="account-security__dialog-icon"><AlertTriangle aria-hidden="true" /></span>
            <h2 id="deletion-dialog-heading">确认申请注销</h2>
            <p>提交后进入 7 天冷静期。冷静期内可以取消，结束后账号和平台内个人数据将按规则处理。</p>
            <label className="account-security__confirm-check"><input type="checkbox" checked={deletionConfirmed} onChange={(event) => setDeletionConfirmed(event.target.checked)} /><span>我已了解账号将在冷静期结束后注销</span></label>
            <div className="account-security__dialog-actions"><button className="button button--soft button--large" type="button" onClick={() => setDialog(null)}>返回</button><button className="account-security__danger-button account-security__danger-button--large" type="button" disabled={!deletionConfirmed || busyAction === "deletion"} onClick={() => void requestDeletion()}>{busyAction === "deletion" ? "正在提交..." : "确认申请注销"}</button></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
