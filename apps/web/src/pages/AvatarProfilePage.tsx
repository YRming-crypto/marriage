import type { AvatarProfile } from "@ai-marriage/shared";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  HeartHandshake,
  History,
  KeyRound,
  Pencil,
  Pause,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, enableAvatarProfile, generateAvatarProfile, getAvatarProfile, getOnboardingDraft, pauseAvatarProfile, revokeAvatarProfile } from "../api/client";

type KnowledgeGovernanceStatus = "allowed" | "sensitive" | "prohibited";
type AvatarVersionStatus = "draft" | "active" | "stale" | "archived";

interface KnowledgeItem {
  id: string;
  ownerId: string;
  title: string;
  content: string;
  topic: string;
  keywords: string[];
  status: KnowledgeGovernanceStatus;
  moderationReason: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

interface AvatarVersionItem {
  id: string;
  title: string;
  content: string;
  topic: string;
  keywords: string[];
  governanceStatus: Exclude<KnowledgeGovernanceStatus, "prohibited">;
  authorized: boolean;
  sourceRevision: number;
}

interface AvatarKnowledgeVersion {
  id: string;
  ownerId: string;
  versionNumber: number;
  status: AvatarVersionStatus;
  note: string | null;
  items: AvatarVersionItem[];
  createdAt: number;
  activatedAt: number | null;
}

interface ModelCallLog {
  id: string;
  ownerId: string;
  versionId: string;
  model: string;
  status: "succeeded" | "failed";
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  errorCode: "MODEL_CALL_FAILED" | null;
  createdAt: number;
}

interface KnowledgeForm {
  title: string;
  topic: string;
  content: string;
  keywords: string;
}

interface GovernanceDraft {
  status: KnowledgeGovernanceStatus;
  reason: string;
}

const emptyKnowledgeForm: KnowledgeForm = { title: "", topic: "", content: "", keywords: "" };
const API_BASE = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4184").replace(/\/$/, "");

const statusText: Record<AvatarProfile["status"], string> = {
  pending: "等待本人确认",
  enabled: "AI 分身已启用",
  paused: "AI 分身已暂停",
  revoked: "AI 分身授权已撤销",
};

const governanceText: Record<KnowledgeGovernanceStatus, string> = {
  allowed: "允许使用",
  sensitive: "敏感：每次使用前确认",
  prohibited: "禁止使用",
};

const versionText: Record<AvatarVersionStatus, string> = {
  draft: "待本人启用",
  active: "当前启用",
  stale: "需要更新",
  archived: "历史归档",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function avatarKnowledgeRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    response = await fetch(`${API_BASE}${path}`, { ...init, credentials: "include", headers });
  } catch {
    throw new Error("AI 分身服务暂时无法连接，请稍后重试。");
  }

  if (response.status === 204) return undefined as T;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("服务返回了无法识别的数据，请稍后重试。");
  }
  if (!response.ok) {
    const apiError = isRecord(body) && isRecord(body.error) ? body.error : null;
    throw new Error(apiError && typeof apiError.message === "string" ? apiError.message : "操作没有完成，请稍后重试。");
  }
  return (isRecord(body) ? body.data : undefined) as T;
}

function keywordsFromInput(value: string) {
  return [...new Set(value.split(/[,，]/).map((item) => item.trim()).filter(Boolean))];
}

function formatDate(value: number | null) {
  if (value === null) return "尚未启用";
  const date = new Date(value < 10_000_000_000 ? value * 1_000 : value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric" }).format(date);
}

export function AvatarProfilePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedNext = searchParams.get("next");
  const nextPath = requestedNext?.startsWith("/")
    && !requestedNext.startsWith("//")
    && !requestedNext.includes("\\")
    && !/[\u0000-\u001F\u007F]/.test(requestedNext)
    ? requestedNext
    : null;
  const avatarReturnPath = nextPath ? `/me/avatar?next=${encodeURIComponent(nextPath)}` : "/me/avatar";
  const [profile, setProfile] = useState<AvatarProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [needsAnswers, setNeedsAnswers] = useState(false);
  const [hasPendingInterest, setHasPendingInterest] = useState(false);

  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [versions, setVersions] = useState<AvatarKnowledgeVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState<AvatarKnowledgeVersion | null>(null);
  const [calls, setCalls] = useState<ModelCallLog[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  const [knowledgeError, setKnowledgeError] = useState("");
  const [knowledgeMessage, setKnowledgeMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [knowledgeForm, setKnowledgeForm] = useState<KnowledgeForm>(emptyKnowledgeForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [governanceDrafts, setGovernanceDrafts] = useState<Record<string, GovernanceDraft>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [authorizedSensitiveIds, setAuthorizedSensitiveIds] = useState<Set<string>>(new Set());
  const [versionNote, setVersionNote] = useState("");

  useEffect(() => {
    let active = true;
    getAvatarProfile()
      .then((result) => { if (active) setProfile(result.avatarProfile); })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "暂时无法读取 AI 分身。"); })
      .finally(() => { if (active) setLoading(false); });

    getOnboardingDraft().then((result) => {
      if (!active) return;
      const pendingInterest = result.draft?.data.pendingInterest;
      setHasPendingInterest(isRecord(pendingInterest) && typeof pendingInterest.memberId === "string" && pendingInterest.memberId.length > 0);
    }).catch(() => {
      // 待办提示失败不应阻断 AI 分身的核心操作。
    });

    Promise.all([
      avatarKnowledgeRequest<{ items: KnowledgeItem[] }>("/api/me/avatar-knowledge"),
      avatarKnowledgeRequest<{ items: AvatarKnowledgeVersion[]; current: AvatarKnowledgeVersion | null; calls: ModelCallLog[] }>("/api/me/avatar-versions"),
    ]).then(([knowledge, versionData]) => {
      if (!active) return;
      setKnowledgeItems(knowledge.items);
      setVersions(versionData.items);
      setCurrentVersion(versionData.current);
      setCalls(versionData.calls);
      setGovernanceDrafts(Object.fromEntries(knowledge.items.map((item) => [item.id, {
        status: item.status,
        reason: item.moderationReason ?? "",
      }])));
    }).catch((error) => {
      if (active) setKnowledgeError(error instanceof Error ? error.message : "暂时无法读取知识与版本。");
    }).finally(() => {
      if (active) setKnowledgeLoading(false);
    });

    return () => { active = false; };
  }, []);

  const callSummary = useMemo(() => {
    const succeeded = calls.filter((call) => call.status === "succeeded").length;
    const tokens = calls.reduce((total, call) => total + call.inputTokens + call.outputTokens, 0);
    const averageLatency = calls.length === 0 ? 0 : Math.round(calls.reduce((total, call) => total + call.latencyMs, 0) / calls.length);
    return { total: calls.length, succeeded, failed: calls.length - succeeded, tokens, averageLatency };
  }, [calls]);

  const selectedSensitiveItems = knowledgeItems.filter((item) => item.status === "sensitive" && selectedIds.has(item.id));
  const canCreateVersion = selectedIds.size > 0
    && selectedSensitiveItems.every((item) => authorizedSensitiveIds.has(item.id));

  async function run(action: () => Promise<{ avatarProfile: AvatarProfile }>, successMessage?: string, continueAfterSuccess = false) {
    setBusy(true);
    setMessage("");
    setNeedsAnswers(false);
    try {
      const result = await action();
      setProfile(result.avatarProfile);
      if (successMessage) setMessage(successMessage);
      if (continueAfterSuccess && nextPath) navigate(nextPath);
    } catch (error) {
      if (error instanceof ApiError && error.code === "ANSWERS_REQUIRED") {
        setNeedsAnswers(true);
        setMessage("生成 AI 分身前，需要先回答至少 1 道关系问答。");
      } else {
        setMessage(error instanceof Error ? error.message : "操作失败，请稍后重试。");
      }
    } finally {
      setBusy(false);
    }
  }

  function beginKnowledgeAction(name: string) {
    setBusyAction(name);
    setKnowledgeMessage("");
    setKnowledgeError("");
  }

  function failKnowledgeAction(error: unknown) {
    setKnowledgeError(error instanceof Error ? error.message : "操作没有完成，请稍后重试。");
    setBusyAction("");
  }

  function markCurrentVersionStale() {
    setCurrentVersion((current) => current?.status === "active" ? { ...current, status: "stale" } : current);
    setVersions((items) => items.map((item) => item.status === "active" ? { ...item, status: "stale" } : item));
  }

  function replaceKnowledgeItem(item: KnowledgeItem) {
    setKnowledgeItems((items) => items.map((candidate) => candidate.id === item.id ? item : candidate));
    setGovernanceDrafts((drafts) => ({
      ...drafts,
      [item.id]: { status: item.status, reason: item.moderationReason ?? "" },
    }));
  }

  async function saveKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      title: knowledgeForm.title.trim(),
      topic: knowledgeForm.topic.trim(),
      content: knowledgeForm.content.trim(),
      keywords: keywordsFromInput(knowledgeForm.keywords),
    };
    if (!payload.title || !payload.topic || !payload.content) {
      setKnowledgeError("请填写知识标题、分类和内容。");
      return;
    }

    beginKnowledgeAction(editingId ? `edit-${editingId}` : "create-knowledge");
    try {
      const result = editingId
        ? await avatarKnowledgeRequest<{ item: KnowledgeItem }>(`/api/me/avatar-knowledge/${encodeURIComponent(editingId)}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await avatarKnowledgeRequest<{ item: KnowledgeItem }>("/api/me/avatar-knowledge", { method: "POST", body: JSON.stringify(payload) });
      if (editingId) replaceKnowledgeItem(result.item);
      else {
        setKnowledgeItems((items) => [...items, result.item]);
        setGovernanceDrafts((drafts) => ({ ...drafts, [result.item.id]: { status: result.item.status, reason: "" } }));
      }
      markCurrentVersionStale();
      setKnowledgeForm(emptyKnowledgeForm);
      setEditingId(null);
      setKnowledgeMessage(editingId ? "知识已更新，请生成新版本后再对外使用。" : "知识已添加，请选择它生成版本。");
      setBusyAction("");
    } catch (error) {
      failKnowledgeAction(error);
    }
  }

  function editKnowledge(item: KnowledgeItem) {
    setEditingId(item.id);
    setKnowledgeForm({ title: item.title, topic: item.topic, content: item.content, keywords: item.keywords.join("，") });
    setKnowledgeError("");
    setKnowledgeMessage("");
  }

  function cancelEdit() {
    setEditingId(null);
    setKnowledgeForm(emptyKnowledgeForm);
  }

  async function deleteKnowledge(item: KnowledgeItem) {
    beginKnowledgeAction(`delete-${item.id}`);
    try {
      await avatarKnowledgeRequest<void>(`/api/me/avatar-knowledge/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      setKnowledgeItems((items) => items.filter((candidate) => candidate.id !== item.id));
      setSelectedIds((ids) => new Set([...ids].filter((id) => id !== item.id)));
      setAuthorizedSensitiveIds((ids) => new Set([...ids].filter((id) => id !== item.id)));
      markCurrentVersionStale();
      if (editingId === item.id) cancelEdit();
      setKnowledgeMessage(`已删除“${item.title}”。`);
      setBusyAction("");
    } catch (error) {
      failKnowledgeAction(error);
    }
  }

  function updateGovernanceDraft(item: KnowledgeItem, changes: Partial<GovernanceDraft>) {
    setGovernanceDrafts((drafts) => ({
      ...drafts,
      [item.id]: {
        status: drafts[item.id]?.status ?? item.status,
        reason: drafts[item.id]?.reason ?? item.moderationReason ?? "",
        ...changes,
      },
    }));
  }

  async function saveGovernance(item: KnowledgeItem) {
    const draft = governanceDrafts[item.id] ?? { status: item.status, reason: item.moderationReason ?? "" };
    if (draft.status !== "allowed" && !draft.reason.trim()) {
      setKnowledgeError("敏感或禁止知识需要填写设置原因。");
      return;
    }
    beginKnowledgeAction(`governance-${item.id}`);
    try {
      const result = await avatarKnowledgeRequest<{ item: KnowledgeItem }>(`/api/me/avatar-knowledge/${encodeURIComponent(item.id)}/governance`, {
        method: "POST",
        body: JSON.stringify({ status: draft.status, reason: draft.status === "allowed" ? null : draft.reason.trim() }),
      });
      replaceKnowledgeItem(result.item);
      if (result.item.status === "prohibited") {
        setSelectedIds((ids) => new Set([...ids].filter((id) => id !== item.id)));
        setAuthorizedSensitiveIds((ids) => new Set([...ids].filter((id) => id !== item.id)));
      }
      markCurrentVersionStale();
      setKnowledgeMessage(`“${item.title}”的使用范围已保存。`);
      setBusyAction("");
    } catch (error) {
      failKnowledgeAction(error);
    }
  }

  function toggleSelected(item: KnowledgeItem, checked: boolean) {
    setSelectedIds((ids) => {
      const next = new Set(ids);
      if (checked) next.add(item.id);
      else next.delete(item.id);
      return next;
    });
    if (!checked) {
      setAuthorizedSensitiveIds((ids) => {
        const next = new Set(ids);
        next.delete(item.id);
        return next;
      });
    }
  }

  function toggleSensitiveAuthorization(itemId: string, checked: boolean) {
    setAuthorizedSensitiveIds((ids) => {
      const next = new Set(ids);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  async function createVersion() {
    if (!canCreateVersion) return;
    const knowledgeItemIds = knowledgeItems.filter((item) => selectedIds.has(item.id)).map((item) => item.id);
    const sensitiveItemIds = knowledgeItems.filter((item) => authorizedSensitiveIds.has(item.id) && selectedIds.has(item.id)).map((item) => item.id);
    beginKnowledgeAction("create-version");
    try {
      const result = await avatarKnowledgeRequest<{ version: AvatarKnowledgeVersion }>("/api/me/avatar-versions", {
        method: "POST",
        body: JSON.stringify({ knowledgeItemIds, sensitiveItemIds, note: versionNote.trim() }),
      });
      setVersions((items) => [result.version, ...items]);
      setSelectedIds(new Set());
      setAuthorizedSensitiveIds(new Set());
      setVersionNote("");
      setKnowledgeMessage(`版本 ${result.version.versionNumber} 草稿已生成，请本人确认后启用。`);
      setBusyAction("");
    } catch (error) {
      failKnowledgeAction(error);
    }
  }

  function applyCurrentVersion(version: AvatarKnowledgeVersion) {
    setCurrentVersion(version);
    setVersions((items) => items.map((item) => {
      if (item.id === version.id) return version;
      if (item.status === "active" || item.status === "stale") return { ...item, status: "archived" };
      return item;
    }));
  }

  async function activateVersion(version: AvatarKnowledgeVersion) {
    beginKnowledgeAction(`activate-${version.id}`);
    try {
      const result = await avatarKnowledgeRequest<{ version: AvatarKnowledgeVersion }>(`/api/me/avatar-versions/${encodeURIComponent(version.id)}/activate`, { method: "POST" });
      applyCurrentVersion(result.version);
      setKnowledgeMessage(`版本 ${version.versionNumber} 已启用。`);
      setBusyAction("");
    } catch (error) {
      failKnowledgeAction(error);
    }
  }

  async function rollbackVersion(version: AvatarKnowledgeVersion) {
    beginKnowledgeAction(`rollback-${version.id}`);
    try {
      const result = await avatarKnowledgeRequest<{ version: AvatarKnowledgeVersion }>(`/api/me/avatar-versions/${encodeURIComponent(version.id)}/rollback`, { method: "POST" });
      applyCurrentVersion(result.version);
      setKnowledgeMessage(`已回滚到版本 ${version.versionNumber}`);
      setBusyAction("");
    } catch (error) {
      failKnowledgeAction(error);
    }
  }

  return (
    <div className="page-shell shell">
      <header className="page-header">
        <span>我的 AI 分身</span>
        <h1>确认它可以代表你介绍什么</h1>
        <p>AI 只使用你主动填写并确认的内容，不会提供联系方式，也不会替你作出承诺。</p>
      </header>

      {hasPendingInterest ? (
        <div className="form-tip" role="status" aria-label="心仪对象待审核">
          <HeartHandshake />
          <div>
            <strong>心仪对象已经为你保留</strong>
            <p>资料、照片和 AI 分身满足条件后会自动恢复，无需重新选择。</p>
            <Link className="button button--text" to={`/onboarding?step=photos&next=${encodeURIComponent(avatarReturnPath)}`}>查看照片审核</Link>
          </div>
        </div>
      ) : null}

      {loading ? <div className="empty-state" role="status"><Bot /><h2>正在读取 AI 分身</h2><p>请稍候。</p></div> : null}
      {!loading && !profile ? (
        <div className="empty-state">
          <Bot />
          <h2>还没有生成 AI 分身摘要</h2>
          <p>完成关系问答后，可以生成一份由你确认的授权摘要。</p>
          <button className="button button--primary" type="button" disabled={busy} onClick={() => void run(generateAvatarProfile)}><RefreshCw />生成 AI 分身摘要</button>
        </div>
      ) : null}

      {profile ? (
        <div className="avatar-profile-layout">
          <section className="avatar-profile-summary">
            <div className="avatar-profile-summary__head"><span><Bot /></span><div><small>版本 {profile.version}</small><h2>{statusText[profile.status]}</h2></div>{profile.status === "enabled" ? <Check aria-label="已启用" /> : null}</div>
            <div><h3>允许介绍的内容</h3>{profile.approvedFacts.map((fact) => <article key={`${fact.topic}-${fact.fact}`}><strong>{fact.topic}</strong><p>{fact.fact}</p></article>)}</div>
            <div><h3>关系期待</h3><ul>{profile.relationshipExpectations.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>
            <div><h3>明确边界</h3><ul>{profile.boundaries.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>
            <div className="form-tip"><ShieldCheck /><span>没有得到明确授权的问题会回答：{profile.unknownResponse}</span></div>
          </section>
          <aside className="avatar-profile-actions">
            <h2>授权控制</h2>
            <p>启用后，其他会员才能与你的 AI 分身进行有限了解。你可以随时暂停或撤销。</p>
            {profile.status !== "enabled"
              ? <button className="button button--primary button--block" type="button" disabled={busy || profile.status === "revoked"} onClick={() => void run(enableAvatarProfile, "AI 分身已启用", true)}><CheckCircle2 />确认并启用 AI 分身</button>
              : <button className="button button--soft button--block" type="button" disabled={busy} onClick={() => void run(pauseAvatarProfile, "AI 分身已暂停")}><Pause />暂停 AI 分身</button>}
            <button className="button button--text button--block" type="button" disabled={busy || profile.status === "revoked"} onClick={() => void run(revokeAvatarProfile, "AI 分身授权已撤销")}><Trash2 />撤销授权</button>
            <button className="button button--text button--block" type="button" disabled={busy} onClick={() => void run(generateAvatarProfile, "已生成新的确认版本")}><RefreshCw />重新生成摘要</button>
            <Link className="inline-link" to="/me">返回个人中心</Link>
            {profile.status === "enabled" && nextPath ? <Link className="button button--primary button--block" to={nextPath}>继续原来的操作</Link> : null}
          </aside>
        </div>
      ) : null}
      {needsAnswers ? <p className="form-tip" role="alert">{message} <Link className="inline-link" to={`/onboarding?step=questions&next=${encodeURIComponent(avatarReturnPath)}`}>返回补充 AI 问答</Link></p> : message ? <p className="form-tip" role="status">{message}</p> : null}

      <section aria-labelledby="knowledge-version-title" style={{ marginTop: 48 }}>
        <div className="section-heading">
          <div>
            <span className="section-heading__eyebrow">本人可随时管理</span>
            <h2 id="knowledge-version-title">知识与版本</h2>
            <p>先整理 AI 可以使用的内容，再由本人选择并启用一个版本。禁止内容不会进入版本。</p>
          </div>
        </div>

        {knowledgeLoading ? <div className="empty-state" role="status"><RefreshCw /><h3>正在读取知识与版本</h3></div> : null}
        {knowledgeError ? <p className="form-tip" role="alert"><AlertTriangle />{knowledgeError}</p> : null}
        {knowledgeMessage ? <p className="form-tip" role="status"><CheckCircle2 />{knowledgeMessage}</p> : null}

        {!knowledgeLoading ? (
          <div className="avatar-profile-layout">
            <section className="avatar-profile-summary" aria-labelledby="knowledge-list-title">
              <div className="avatar-profile-summary__head">
                <span><KeyRound /></span>
                <div><small>{knowledgeItems.length} 条知识</small><h3 id="knowledge-list-title">AI 可以了解的内容</h3></div>
              </div>

              <form className="form-grid" aria-label={editingId ? "编辑知识" : "添加知识"} onSubmit={(event) => void saveKnowledge(event)}>
                <label><span>知识标题</span><input aria-label="知识标题" value={knowledgeForm.title} maxLength={80} onChange={(event) => setKnowledgeForm((form) => ({ ...form, title: event.target.value }))} placeholder="例如：我的周末安排" /></label>
                <label><span>知识分类</span><input aria-label="知识分类" value={knowledgeForm.topic} maxLength={50} onChange={(event) => setKnowledgeForm((form) => ({ ...form, topic: event.target.value }))} placeholder="例如：生活习惯" /></label>
                <label className="form-grid__wide"><span>可用于回答的内容</span><textarea aria-label="可用于回答的内容" value={knowledgeForm.content} maxLength={1000} onChange={(event) => setKnowledgeForm((form) => ({ ...form, content: event.target.value }))} placeholder="只填写你愿意让 AI 使用的事实，不要填写手机号、地址等联系方式。" /></label>
                <label className="form-grid__wide"><span>关键词（用逗号分隔）</span><input aria-label="关键词（用逗号分隔）" value={knowledgeForm.keywords} maxLength={200} onChange={(event) => setKnowledgeForm((form) => ({ ...form, keywords: event.target.value }))} placeholder="例如：阅读，散步，周末" /></label>
                <div className="form-grid__wide">
                  <button className="button button--primary" type="submit" disabled={busyAction === "create-knowledge" || busyAction.startsWith("edit-")}>{editingId ? <Save /> : <Plus />}{editingId ? "保存修改" : "添加知识"}</button>
                  {editingId ? <button className="button button--text" type="button" onClick={cancelEdit}><X />取消编辑</button> : null}
                </div>
              </form>

              <div>
                <h3>已保存的知识</h3>
                {knowledgeItems.length === 0 ? <p>还没有知识。请先在上方添加一条愿意授权的内容。</p> : knowledgeItems.map((item) => {
                  const draft = governanceDrafts[item.id] ?? { status: item.status, reason: item.moderationReason ?? "" };
                  return (
                    <article key={item.id} aria-label={item.title}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
                        <div><small>{item.topic} · 修订 {item.revision}</small><h3>{item.title}</h3></div>
                        <strong>{governanceText[item.status]}</strong>
                      </div>
                      <p>{item.content}</p>
                      {item.keywords.length > 0 ? <p><small>关键词：{item.keywords.join("、")}</small></p> : null}
                      {item.moderationReason ? <p>{item.moderationReason}</p> : null}
                      <div className="form-grid" style={{ marginTop: 14 }}>
                        <label><span>AI 使用范围</span><select aria-label="使用范围" value={draft.status} onChange={(event) => updateGovernanceDraft(item, { status: event.target.value as KnowledgeGovernanceStatus, reason: event.target.value === "allowed" ? "" : draft.reason })}><option value="allowed">允许使用</option><option value="sensitive">敏感，每次授权</option><option value="prohibited">禁止使用</option></select></label>
                        <label><span>设置原因</span><input aria-label="设置原因" value={draft.reason} disabled={draft.status === "allowed"} onChange={(event) => updateGovernanceDraft(item, { reason: event.target.value })} placeholder="说明为何敏感或禁止" /></label>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                        <button className="button button--soft" type="button" disabled={busyAction === `governance-${item.id}`} onClick={() => void saveGovernance(item)}><ShieldCheck />保存使用范围</button>
                        <button className="button button--text" type="button" aria-label={`编辑“${item.title}”`} onClick={() => editKnowledge(item)}><Pencil />编辑</button>
                        <button className="button button--text" type="button" aria-label={`删除“${item.title}”`} disabled={busyAction === `delete-${item.id}`} onClick={() => void deleteKnowledge(item)}><Trash2 />删除</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <aside className="avatar-profile-actions" aria-labelledby="version-builder-title">
              <h3 id="version-builder-title">生成本人确认版本</h3>
              <p>勾选这次允许 AI 使用的知识。敏感知识需要再确认一次。</p>
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="sr-only">选择版本知识</legend>
                {knowledgeItems.map((item) => (
                  <label className="check-row" key={item.id} style={{ marginTop: 12 }}>
                    <input type="checkbox" aria-label={`加入版本：${item.title}`} checked={selectedIds.has(item.id)} disabled={item.status === "prohibited"} onChange={(event) => toggleSelected(item, event.target.checked)} />
                    <span>{item.title}{item.status === "prohibited" ? "（禁止加入）" : ""}</span>
                  </label>
                ))}
              </fieldset>
              {selectedSensitiveItems.map((item) => (
                <label className="check-row" key={`authorize-${item.id}`} style={{ marginTop: 12 }}>
                  <input type="checkbox" aria-label={`本人确认允许“${item.title}”用于 AI 回答`} checked={authorizedSensitiveIds.has(item.id)} onChange={(event) => toggleSensitiveAuthorization(item.id, event.target.checked)} />
                  <span>本人确认允许“{item.title}”用于 AI 回答</span>
                </label>
              ))}
              <label style={{ display: "grid", gap: 6, marginTop: 16 }}><span>版本说明（选填）</span><input aria-label="版本说明（选填）" value={versionNote} maxLength={120} onChange={(event) => setVersionNote(event.target.value)} placeholder="例如：补充生活习惯" /></label>
              <button className="button button--primary button--block" type="button" disabled={!canCreateVersion || busyAction === "create-version"} onClick={() => void createVersion()}><Plus />生成草稿版本</button>
              {selectedSensitiveItems.some((item) => !authorizedSensitiveIds.has(item.id)) ? <p className="form-tip"><AlertTriangle />请先确认所选的敏感知识。</p> : null}
            </aside>
          </div>
        ) : null}

        {!knowledgeLoading ? (
          <div className="avatar-profile-layout" style={{ marginTop: 24 }}>
            <section className="avatar-profile-summary" aria-labelledby="version-history-title">
              <div className="avatar-profile-summary__head"><span><History /></span><div><small>{versions.length} 个版本</small><h3 id="version-history-title">版本记录</h3></div></div>
              {currentVersion?.status === "stale" ? <div className="form-tip" role="status" aria-label="版本需要更新"><AlertTriangle /><span>知识已变化，当前版本仍使用启用时的旧内容。请生成并启用新版本。</span></div> : null}
              {versions.length === 0 ? <p>还没有版本。选择知识后生成第一份草稿。</p> : versions.map((version) => (
                <article key={version.id} aria-label={`版本 ${version.versionNumber}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
                    <div><small>{formatDate(version.activatedAt)}</small><h3>版本 {version.versionNumber}</h3></div>
                    <strong>{versionText[version.status]}</strong>
                  </div>
                  <p>{version.note || "无版本说明"}</p>
                  <p><small>包含 {version.items.length} 条知识，其中 {version.items.filter((item) => item.governanceStatus === "sensitive" && item.authorized).length} 条敏感知识已由本人授权。</small></p>
                  {version.status === "draft" ? <button className="button button--primary" type="button" aria-label={`启用版本 ${version.versionNumber}`} disabled={busyAction === `activate-${version.id}`} onClick={() => void activateVersion(version)}><Check />启用这个版本</button> : null}
                  {version.status === "archived" ? <button className="button button--soft" type="button" aria-label={`回滚版本 ${version.versionNumber}`} disabled={busyAction === `rollback-${version.id}`} onClick={() => void rollbackVersion(version)}><History />回滚到这个版本</button> : null}
                </article>
              ))}
            </section>

            <aside className="avatar-profile-actions" aria-labelledby="call-summary-title">
              <h3 id="call-summary-title">AI 使用摘要</h3>
              <p>这里只显示调用次数、成功情况、耗时和令牌用量。</p>
              <div aria-label="模型调用摘要">
                <p><strong>共 {callSummary.total} 次</strong></p>
                <p>{callSummary.succeeded} 次成功</p>
                <p>{callSummary.failed} 次失败</p>
                <p>{callSummary.tokens} 个令牌</p>
                <p>平均 {callSummary.averageLatency} 毫秒</p>
              </div>
            </aside>
          </div>
        ) : null}
      </section>
    </div>
  );
}
