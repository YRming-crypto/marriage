import type { Member, Recommendation, SavedMatchFilter } from "@ai-marriage/shared";
import {
  ArrowRight,
  Bot,
  BookmarkPlus,
  ChevronDown,
  Heart,
  HeartHandshake,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Undo2,
  UserRound,
  UserRoundCheck,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  cancelInterest,
  createInterest,
  deleteMatchFilter,
  getInterests,
  getMatchFilters,
  getRecommendations,
  restoreSkippedMember,
  saveMatchFilter,
  skipMember,
  type MemberInterest,
} from "../api/client";
import "./MatchmakingPage.css";

type PageStatus = "loading" | "success" | "unauthenticated" | "profile-required" | "answers-required" | "avatar-required" | "review-required" | "error";
type RecoveryStatus = Extract<PageStatus, "unauthenticated" | "profile-required" | "answers-required" | "avatar-required" | "review-required">;
type MatchmakingTab = "recommended" | "sent" | "received" | "mutual" | "skipped";

interface FilterDraft {
  gender: string;
  minAge: string;
  maxAge: string;
  city: string;
  maritalStatus: string;
  goal: string;
  sort: string;
}

interface RelationshipGroups {
  sent: MemberInterest[];
  received: MemberInterest[];
  mutual: MemberInterest[];
}

const defaultFilters: FilterDraft = {
  gender: "不限",
  minAge: "35",
  maxAge: "65",
  city: "",
  maritalStatus: "不限",
  goal: "不限",
  sort: "default",
};

const emptyRelationships: RelationshipGroups = { sent: [], received: [], mutual: [] };
const returnToMatchmaking = encodeURIComponent("/matchmaking");

function filtersForRequest(draft: FilterDraft): Record<string, string | number | undefined> {
  return {
    gender: draft.gender === "不限" ? undefined : draft.gender,
    minAge: Number(draft.minAge),
    maxAge: Number(draft.maxAge),
    city: draft.city.trim() || undefined,
    maritalStatus: draft.maritalStatus === "不限" ? undefined : draft.maritalStatus,
    goal: draft.goal === "不限" ? undefined : draft.goal,
    sort: draft.sort,
  };
}

function draftFromCriteria(criteria: Record<string, unknown>): FilterDraft {
  const stringValue = (key: keyof FilterDraft, fallback: string) => {
    const value = criteria[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
  };
  return {
    gender: stringValue("gender", "不限"),
    minAge: stringValue("minAge", "35"),
    maxAge: stringValue("maxAge", "65"),
    city: stringValue("city", ""),
    maritalStatus: stringValue("maritalStatus", "不限"),
    goal: stringValue("goal", "不限"),
    sort: stringValue("sort", "default"),
  };
}

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function recoveryStatusFrom(error: unknown): RecoveryStatus | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "AUTH_REQUIRED") return "unauthenticated";
  if (error.code === "PROFILE_REQUIRED") return "profile-required";
  if (error.code === "ANSWERS_REQUIRED") return "answers-required";
  if (error.code === "AVATAR_PROFILE_REQUIRED") return "avatar-required";
  if (error.code === "ACCOUNT_REVIEW_REQUIRED") return "review-required";
  return null;
}

export function MatchmakingPage() {
  const [status, setStatus] = useState<PageStatus>("loading");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [relationships, setRelationships] = useState<RelationshipGroups>(emptyRelationships);
  const [savedFilters, setSavedFilters] = useState<SavedMatchFilter[]>([]);
  const [skipped, setSkipped] = useState<Recommendation[]>([]);
  const [draft, setDraft] = useState<FilterDraft>(defaultFilters);
  const [applied, setApplied] = useState<FilterDraft>(defaultFilters);
  const [activeTab, setActiveTab] = useState<MatchmakingTab>("recommended");
  const [selectedFilterId, setSelectedFilterId] = useState("");
  const [filterName, setFilterName] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [supplementaryLoadFailed, setSupplementaryLoadFailed] = useState(false);
  const [supplementaryBusy, setSupplementaryBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [advisorPrompt, setAdvisorPrompt] = useState("");
  const [recommendationCursor, setRecommendationCursor] = useState<string | null>(null);
  const [recommendationHasMore, setRecommendationHasMore] = useState(false);
  const [recommendationTotal, setRecommendationTotal] = useState(0);
  const [recommendationPageSize, setRecommendationPageSize] = useState(12);
  const [loadingMore, setLoadingMore] = useState(false);
  const recommendationRequestVersion = useRef(0);
  const paginationRequestSequence = useRef(0);
  const activePaginationRequest = useRef<number | null>(null);

  function beginRecommendationQuery() {
    const version = ++recommendationRequestVersion.current;
    activePaginationRequest.current = null;
    setLoadingMore(false);
    setRecommendationCursor(null);
    setRecommendationHasMore(false);
    return version;
  }

  function recoverFrom(error: unknown) {
    const recoveryStatus = recoveryStatusFrom(error);
    if (!recoveryStatus) return false;
    setErrorMessage("");
    setNotice("");
    setSupplementaryLoadFailed(false);
    setStatus(recoveryStatus);
    return true;
  }

  async function loadPage() {
    const version = beginRecommendationQuery();
    setStatus("loading");
    setErrorMessage("");
    setNotice("");
    setSupplementaryLoadFailed(false);
    const [recommendationResult, interestResult, filterResult] = await Promise.allSettled([
      getRecommendations(filtersForRequest(applied)),
      getInterests(),
      getMatchFilters(),
    ]);
    if (version !== recommendationRequestVersion.current) return;

    const recoveryError = [recommendationResult, interestResult, filterResult]
      .find((result) => result.status === "rejected" && recoveryStatusFrom(result.reason));
    if (recoveryError?.status === "rejected" && recoverFrom(recoveryError.reason)) return;

    if (recommendationResult.status === "rejected") {
      const message = messageFrom(recommendationResult.reason, "推荐暂时无法加载，请稍后重试。");
      setErrorMessage(message);
      setStatus("error");
      return;
    }

    setRecommendations(recommendationResult.value.items);
    setRecommendationCursor(recommendationResult.value.nextCursor ?? null);
    setRecommendationHasMore(Boolean(recommendationResult.value.hasMore && recommendationResult.value.nextCursor));
    setRecommendationTotal(recommendationResult.value.total ?? recommendationResult.value.items.length);
    setRecommendationPageSize(recommendationResult.value.pageSize ?? 12);
    if (interestResult.status === "fulfilled") setRelationships(interestResult.value);
    if (filterResult.status === "fulfilled") setSavedFilters(filterResult.value.items);
    if (interestResult.status === "rejected" || filterResult.status === "rejected") {
      setSupplementaryLoadFailed(true);
      setNotice("关系和筛选方案暂时未完整更新，你仍可继续浏览推荐。");
    }
    setStatus("success");
  }

  useEffect(() => {
    void loadPage();
    return () => {
      recommendationRequestVersion.current += 1;
      activePaginationRequest.current = null;
    };
    // Initial loading intentionally uses the initial filter selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sentMemberIds = useMemo(
    () => new Set(relationships.sent.map((item) => item.member.id)),
    [relationships.sent],
  );
  const mutualMemberIds = useMemo(
    () => new Set(relationships.mutual.map((item) => item.member.id)),
    [relationships.mutual],
  );

  function updateDraft(key: keyof FilterDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function loadRecommendations(nextFilters: FilterDraft, refreshedNotice?: string) {
    const version = beginRecommendationQuery();
    setErrorMessage("");
    try {
      const result = await getRecommendations(filtersForRequest(nextFilters));
      if (version !== recommendationRequestVersion.current) return;
      setRecommendations(result.items);
      setRecommendationCursor(result.nextCursor ?? null);
      setRecommendationHasMore(Boolean(result.hasMore && result.nextCursor));
      setRecommendationTotal(result.total ?? result.items.length);
      setRecommendationPageSize(result.pageSize ?? 12);
      setApplied(nextFilters);
      setActiveTab("recommended");
      if (refreshedNotice) setNotice(refreshedNotice);
    } catch (error) {
      if (version !== recommendationRequestVersion.current) return;
      if (refreshedNotice) setNotice("");
      if (!recoverFrom(error)) setErrorMessage(messageFrom(error, "筛选结果暂时无法加载，请稍后重试。"));
    }
  }

  async function loadMoreRecommendations() {
    if (!recommendationHasMore || !recommendationCursor || activePaginationRequest.current !== null) return;
    const version = recommendationRequestVersion.current;
    const requestId = ++paginationRequestSequence.current;
    activePaginationRequest.current = requestId;
    setLoadingMore(true);
    setErrorMessage("");
    try {
      const result = await getRecommendations({
        ...filtersForRequest(applied),
        cursor: recommendationCursor,
        pageSize: recommendationPageSize,
      });
      if (version !== recommendationRequestVersion.current || activePaginationRequest.current !== requestId) return;
      setRecommendations((current) => {
        const byMemberId = new Map(current.map((item) => [item.member.id, item]));
        for (const item of result.items) byMemberId.set(item.member.id, item);
        return [...byMemberId.values()];
      });
      setRecommendationCursor(result.nextCursor ?? null);
      setRecommendationHasMore(Boolean(result.hasMore && result.nextCursor));
      setRecommendationTotal(result.total ?? recommendationTotal);
      setRecommendationPageSize(result.pageSize ?? recommendationPageSize);
    } catch (error) {
      if (version !== recommendationRequestVersion.current || activePaginationRequest.current !== requestId) return;
      if (error instanceof ApiError && error.code === "INVALID_CURSOR") {
        setNotice("推荐列表有更新，正在自动刷新。");
        await loadRecommendations(applied, "推荐列表已自动刷新，请继续浏览。");
        return;
      }
      if (!recoverFrom(error)) setErrorMessage(messageFrom(error, "更多推荐暂时无法加载，请稍后重试。"));
    } finally {
      if (activePaginationRequest.current === requestId) {
        activePaginationRequest.current = null;
        if (version === recommendationRequestVersion.current) setLoadingMore(false);
      }
    }
  }

  async function applyFilters() {
    if (Number(draft.minAge) > Number(draft.maxAge)) {
      setErrorMessage("最小年龄不能大于最大年龄。");
      return;
    }
    setSelectedFilterId("");
    await loadRecommendations(draft);
  }

  async function resetFilters() {
    setDraft(defaultFilters);
    setSelectedFilterId("");
    await loadRecommendations(defaultFilters);
  }

  async function refreshRelationships() {
    const result = await getInterests();
    setRelationships(result);
  }

  async function retrySupplementaryData() {
    if (supplementaryBusy) return;
    setSupplementaryBusy(true);
    setErrorMessage("");
    setNotice("");
    try {
      const [interestResult, filterResult] = await Promise.allSettled([getInterests(), getMatchFilters()]);
      const recoveryError = [interestResult, filterResult]
        .find((result) => result.status === "rejected" && recoveryStatusFrom(result.reason));
      if (recoveryError?.status === "rejected" && recoverFrom(recoveryError.reason)) return;

      if (interestResult.status === "fulfilled") setRelationships(interestResult.value);
      if (filterResult.status === "fulfilled") setSavedFilters(filterResult.value.items);
      const retryFailed = interestResult.status === "rejected" || filterResult.status === "rejected";
      setSupplementaryLoadFailed(retryFailed);
      setNotice(retryFailed ? "关系和筛选方案仍未完整更新，请稍后再试。" : "关系和筛选方案已更新。");
    } finally {
      setSupplementaryBusy(false);
    }
  }

  async function runMemberAction(key: string, action: () => Promise<void>, successMessage: string) {
    if (actionBusy) return;
    setActionBusy(key);
    setErrorMessage("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
    } catch (error) {
      if (!recoverFrom(error)) setErrorMessage(messageFrom(error, "操作没有完成，请稍后重试。"));
    } finally {
      setActionBusy("");
    }
  }

  function toggleInterest(member: Member, liked: boolean) {
    return runMemberAction(`interest-${member.id}`, async () => {
      if (liked) await cancelInterest(member.id);
      else await createInterest(member.id);
      await refreshRelationships();
    }, liked ? `已取消喜欢${member.nickname}。` : `已记录你对${member.nickname}的喜欢。`);
  }

  function skipRecommendation(item: Recommendation) {
    return runMemberAction(`skip-${item.member.id}`, async () => {
      await skipMember(item.member.id);
      setRecommendations((current) => current.filter((candidate) => candidate.member.id !== item.member.id));
      setSkipped((current) => current.some((candidate) => candidate.member.id === item.member.id) ? current : [item, ...current]);
    }, `已暂时跳过${item.member.nickname}，本次浏览中可以恢复。`);
  }

  function restoreRecommendation(item: Recommendation) {
    return runMemberAction(`restore-${item.member.id}`, async () => {
      await restoreSkippedMember(item.member.id);
      setSkipped((current) => current.filter((candidate) => candidate.member.id !== item.member.id));
      setRecommendations((current) => current.some((candidate) => candidate.member.id === item.member.id) ? current : [item, ...current]);
    }, `已恢复${item.member.nickname}的推荐。`);
  }

  async function applySavedFilter(filterId: string) {
    setSelectedFilterId(filterId);
    if (!filterId) return;
    const filter = savedFilters.find((item) => item.id === filterId);
    if (!filter) return;
    const nextDraft = draftFromCriteria(filter.criteria);
    setDraft(nextDraft);
    await loadRecommendations(nextDraft);
  }

  async function saveCurrentFilter() {
    const name = filterName.trim();
    if (!name) {
      setErrorMessage("请先填写方案名称。");
      return;
    }
    if (actionBusy) return;
    setActionBusy("save-filter");
    setErrorMessage("");
    try {
      const result = await saveMatchFilter({ name, criteria: filtersForRequest(draft) });
      setSavedFilters((current) => [result.filter, ...current.filter((item) => item.id !== result.filter.id)]);
      setSelectedFilterId(result.filter.id);
      setFilterName("");
      setNotice(`已保存筛选方案“${result.filter.name}”。`);
    } catch (error) {
      if (!recoverFrom(error)) setErrorMessage(messageFrom(error, "筛选方案暂时无法保存。"));
    } finally {
      setActionBusy("");
    }
  }

  function removeSavedFilter(filter: SavedMatchFilter) {
    return runMemberAction(`delete-filter-${filter.id}`, async () => {
      await deleteMatchFilter(filter.id);
      setSavedFilters((current) => current.filter((item) => item.id !== filter.id));
      if (selectedFilterId === filter.id) setSelectedFilterId("");
    }, `已删除筛选方案“${filter.name}”。`);
  }

  const tabItems = [
    { id: "recommended" as const, label: "为你推荐", count: recommendations.length, icon: <Search /> },
    { id: "sent" as const, label: "我的心仪", count: relationships.sent.length, icon: <Heart /> },
    { id: "received" as const, label: "收到的喜欢", count: relationships.received.length, icon: <Heart /> },
    { id: "mutual" as const, label: "互相心仪", count: relationships.mutual.length, icon: <HeartHandshake /> },
    { id: "skipped" as const, label: "刚刚跳过", count: skipped.length, icon: <Undo2 /> },
  ];
  const spotlightMember = relationships.received[0]?.member;
  const advisorSuggestions = [
    { label: "先问她周末怎么安排", prompt: "TA 平时喜欢怎样安排周末？" },
    { label: "先了解她的关系期待", prompt: "TA 希望建立怎样的关系？" },
  ];

  return (
    <div className="page-shell shell matchmaking-page">
      <header className="page-header page-header--split matchmaking-page__header">
        <div>
          <span>匹配大厅</span>
          <h1>认真了解，从合适的人开始</h1>
          <p>按你在意的条件寻找对象，查看简单清楚的匹配理由，再决定是否进一步了解。</p>
        </div>
        {status === "success" ? <div className="matchmaking-page__summary"><strong>{recommendationTotal}</strong><span>位符合推荐</span></div> : null}
      </header>

      {status === "loading" ? (
        <PageState role="status" icon={<Heart />} title="正在为你整理推荐" description="请稍候，我们正在读取推荐、喜欢和筛选方案。" />
      ) : null}

      {status === "unauthenticated" ? (
        <PageState icon={<UserRound />} title="登录后查看专属推荐" description="确认账号后，推荐结果才能与你的资料和交往期待对应。" action={<Link className="button button--primary" to={`/auth?next=${returnToMatchmaking}`}>登录或注册</Link>} />
      ) : null}

      {status === "profile-required" ? (
        <PageState icon={<ShieldCheck />} title="完善资料后开始推荐" description="完成基本资料和关系问答后，我们才能为你整理更合适的会员。" action={<Link className="button button--primary" to={`/onboarding?next=${returnToMatchmaking}`}>去完善资料</Link>} />
      ) : null}

      {status === "answers-required" ? (
        <PageState icon={<ShieldCheck />} title="补充关系问答后继续推荐" description="需要完成全部 15 道关系问答，系统才能继续整理专属推荐。" action={<Link className="button button--primary" to={`/onboarding?step=questions&next=${returnToMatchmaking}`}>去补充问答</Link>} />
      ) : null}

      {status === "avatar-required" ? (
        <PageState icon={<Bot />} title="启用 AI 分身后开始推荐" description="生成并启用自己的 AI 分身后，就可以进入专属匹配流程。" action={<Link className="button button--primary" to="/me/avatar">去生成 AI 分身</Link>} />
      ) : null}

      {status === "review-required" ? (
        <PageState icon={<ShieldCheck />} title="资料和照片审核通过后再联系" description="你的资料或照片仍在审核中。可以前往建档照片步骤查看当前审核状态。" action={<Link className="button button--primary" to={`/onboarding?step=photos&next=${returnToMatchmaking}`}>查看审核状态</Link>} />
      ) : null}

      {status === "error" ? (
        <PageState role="alert" icon={<Search />} title="推荐暂时无法加载" description={errorMessage} action={<button className="button button--primary" type="button" onClick={() => void loadPage()}>重新加载</button>} />
      ) : null}

      {status === "success" ? (
        <>
          {spotlightMember ? (
            <section className="matchmaking-interest-spotlight" aria-label="谁喜欢我">
              <div className="matchmaking-interest-spotlight__header">
                <div>
                  <span>谁喜欢我</span>
                  <h2>谁喜欢我</h2>
                </div>
                <button className="button button--soft" type="button" onClick={() => setActiveTab("received")}>查看全部喜欢</button>
              </div>
              <div className="matchmaking-interest-spotlight__card">
                <img src={spotlightMember.photoUrl} alt={`${spotlightMember.nickname}的头像`} />
                <div className="matchmaking-interest-spotlight__content">
                  <strong>{spotlightMember.nickname}想和你认识</strong>
                  <p>{spotlightMember.city} · {spotlightMember.job}</p>
                </div>
                <button className="button button--primary" type="button" disabled={actionBusy.includes(spotlightMember.id)} aria-label={`回复${spotlightMember.nickname}的喜欢`} onClick={() => void toggleInterest(spotlightMember, sentMemberIds.has(spotlightMember.id))}>
                  <Heart />{sentMemberIds.has(spotlightMember.id) ? "已回复喜欢" : "回复" + spotlightMember.nickname + "的喜欢"}
                </button>
              </div>
            </section>
          ) : null}

          {(relationships.received.length > 0 || relationships.mutual.length > 0) ? (
            <section className="matchmaking-interaction-summary" aria-label="互动提醒">
              {relationships.received.length > 0 ? (
                <div className="matchmaking-interaction-summary__item">
                  <strong>你有 {relationships.received.length} 位用户对你表达了喜欢</strong>
                  <button className="button button--soft" type="button" onClick={() => setActiveTab("received")}>查看收到的喜欢</button>
                </div>
              ) : null}
              {relationships.mutual.length > 0 ? (
                <div className="matchmaking-interaction-summary__item">
                  <strong>还有 {relationships.mutual.length} 组互相心仪，适合继续和对方的 AI 分身聊聊</strong>
                  <button className="button button--soft" type="button" onClick={() => setActiveTab("mutual")}>查看互相心仪</button>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="matchmaking-tools" aria-label="推荐筛选">
            <div className="matchmaking-tools__filters">
              <label><span>想认识</span><select aria-label="想认识" value={draft.gender} onChange={(event) => updateDraft("gender", event.target.value)}><option>不限</option><option>女性</option><option>男性</option></select></label>
              <label><span>最小年龄</span><select aria-label="最小年龄" value={draft.minAge} onChange={(event) => updateDraft("minAge", event.target.value)}>{[30, 35, 40, 45, 50, 55].map((age) => <option key={age}>{age}</option>)}</select></label>
              <label><span>最大年龄</span><select aria-label="最大年龄" value={draft.maxAge} onChange={(event) => updateDraft("maxAge", event.target.value)}>{[40, 45, 50, 55, 60, 65, 70].map((age) => <option key={age}>{age}</option>)}</select></label>
              <label><span>所在城市</span><input aria-label="所在城市" value={draft.city} placeholder="不限城市" onChange={(event) => updateDraft("city", event.target.value)} /></label>
              <label><span>婚姻状态</span><select aria-label="婚姻状态" value={draft.maritalStatus} onChange={(event) => updateDraft("maritalStatus", event.target.value)}><option>不限</option><option>未婚</option><option>离异</option><option>丧偶</option></select></label>
              <label><span>交往目标</span><select aria-label="交往目标" value={draft.goal} onChange={(event) => updateDraft("goal", event.target.value)}><option>不限</option><option>认真交往</option><option>以结婚为目标</option><option>先认识了解</option></select></label>
              <label><span>排序方式</span><select aria-label="排序方式" value={draft.sort} onChange={(event) => updateDraft("sort", event.target.value)}><option value="default">综合推荐</option><option value="age-asc">年龄从小到大</option><option value="age-desc">年龄从大到小</option></select></label>
            </div>
            <div className="matchmaking-tools__actions">
              <button className="button button--primary" type="button" onClick={() => void applyFilters()}><Search />应用筛选</button>
              <button className="button button--soft" type="button" onClick={() => void resetFilters()}><RotateCcw />重置</button>
            </div>
            <div className="saved-filter-form">
              <label><span>筛选方案</span><select aria-label="筛选方案" value={selectedFilterId} onChange={(event) => void applySavedFilter(event.target.value)}><option value="">选择已保存方案</option>{savedFilters.map((filter) => <option key={filter.id} value={filter.id}>{filter.name}{filter.isDefault ? "（默认）" : ""}</option>)}</select></label>
              <label><span>方案名称</span><input aria-label="方案名称" value={filterName} maxLength={80} placeholder="例如：杭州同龄人" onChange={(event) => setFilterName(event.target.value)} /></label>
              <button className="button button--soft" type="button" disabled={actionBusy === "save-filter"} onClick={() => void saveCurrentFilter()}><BookmarkPlus />{actionBusy === "save-filter" ? "保存中" : "保存当前筛选"}</button>
            </div>
            {savedFilters.length ? (
              <div className="saved-filter-list" role="region" aria-label="已保存的筛选方案">
                {savedFilters.map((filter) => <span key={filter.id}>{filter.name}<button type="button" aria-label={`删除${filter.name}`} title={`删除${filter.name}`} onClick={() => void removeSavedFilter(filter)}><Trash2 /></button></span>)}
              </div>
            ) : null}
          </section>

          <section className="matchmaking-advisor" aria-label="AI 约会顾问">
            <div className="matchmaking-advisor__title-row"><Bot /><h2>AI 约会顾问</h2></div>
            <p>先从生活节奏和关系期待开始，先聊清楚再推进，能更稳妥地建立信任。</p>
            <div className="matchmaking-advisor__actions">
              {advisorSuggestions.map((suggestion) => (
                <button key={suggestion.label} type="button" onClick={() => setAdvisorPrompt(suggestion.prompt)}>{suggestion.label}</button>
              ))}
            </div>
            {advisorPrompt ? <div className="matchmaking-advisor__prompt" role="status">已为你准备：{advisorPrompt}</div> : null}
          </section>

          <div className="matchmaking-tabs" role="tablist" aria-label="匹配关系">
            {tabItems.map((tab) => (
              <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "is-active" : ""} onClick={() => setActiveTab(tab.id)}>
                {tab.icon}<span>{tab.label}</span><strong>{tab.count}</strong>
              </button>
            ))}
          </div>

          {errorMessage ? <div className="matchmaking-feedback matchmaking-feedback--error" role="alert"><X />{errorMessage}</div> : null}
          {notice ? <div className="matchmaking-feedback" role="status"><UserRoundCheck /><span>{notice}</span>{supplementaryLoadFailed ? <button className="button button--text" type="button" disabled={supplementaryBusy} onClick={() => void retrySupplementaryData()}><RotateCcw />{supplementaryBusy ? "正在重新加载" : "重新加载关系和筛选方案"}</button> : null}</div> : null}

          <section className="matchmaking-results" aria-live="polite" aria-label="匹配结果">
            {activeTab === "recommended" ? (
              recommendations.length ? <>
                {recommendations.map((item) => (
                  <MatchCard
                    key={item.member.id}
                    member={item.member}
                    reasons={item.reasons}
                    liked={sentMemberIds.has(item.member.id)}
                    mutual={mutualMemberIds.has(item.member.id)}
                    busy={actionBusy.includes(item.member.id)}
                    onInterest={() => void toggleInterest(item.member, sentMemberIds.has(item.member.id))}
                    onSkip={() => void skipRecommendation(item)}
                  />
                ))}
                {recommendationHasMore ? <div className="matchmaking-load-more"><button className="button button--soft" type="button" disabled={loadingMore} onClick={() => void loadMoreRecommendations()}><ChevronDown />{loadingMore ? "正在加载更多" : "加载更多推荐"}</button><span>已显示 {recommendations.length} / {recommendationTotal}</span></div> : null}
              </> : <InlineEmpty title="暂时没有符合条件的推荐" description="可以放宽年龄、城市或交往目标，再看看其他愿意认真认识的人。" action={<button className="button button--primary" type="button" onClick={() => void resetFilters()}>清除筛选条件</button>} />
            ) : null}

            {activeTab === "received" ? (
              relationships.received.length ? relationships.received.map(({ member: item }) => <RelationshipCard key={item.id} member={item} kind="received" liked={sentMemberIds.has(item.id)} busy={actionBusy.includes(item.id)} onInterest={() => void toggleInterest(item, sentMemberIds.has(item.id))} />) : <InlineEmpty title="暂时没有收到新的喜欢" description="有人对你表达喜欢后，会在这里清楚显示。" />
            ) : null}

            {activeTab === "sent" ? (
              relationships.sent.length ? relationships.sent.map(({ member: item }) => <RelationshipCard key={item.id} member={item} kind="sent" liked busy={actionBusy.includes(item.id)} onInterest={() => void toggleInterest(item, true)} />) : <InlineEmpty title="还没有加入心仪的人" description="在推荐或会员资料中点击喜欢后，可以随时回到这里查看和管理。" />
            ) : null}

            {activeTab === "mutual" ? (
              relationships.mutual.length ? relationships.mutual.map(({ member: item }) => <RelationshipCard key={item.id} member={item} kind="mutual" liked busy={actionBusy.includes(item.id)} onInterest={() => void toggleInterest(item, true)} />) : <InlineEmpty title="还没有互相心仪的人" description="当你和对方都表达喜欢后，会在这里出现，并可以继续和对方的 AI 分身聊聊。" />
            ) : null}

            {activeTab === "skipped" ? (
              skipped.length ? skipped.map((item) => <SkippedCard key={item.member.id} item={item} busy={actionBusy.includes(item.member.id)} onRestore={() => void restoreRecommendation(item)} />) : <InlineEmpty title="本次浏览没有刚刚跳过的人" description="这里会保留本次浏览中跳过的会员，方便你立即反悔恢复。" />
            ) : null}
          </section>

          <div className="ai-explainer">
            <Bot />
            <div><strong>推荐理由只用于帮助了解</strong><p>页面只展示容易理解的共同点，不公开内部算法和计算方式。是否喜欢、跳过或继续交流，都由你自己决定。</p></div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MatchCard({ member, reasons, liked, mutual, busy, onInterest, onSkip }: { member: Member; reasons: string[]; liked: boolean; mutual: boolean; busy: boolean; onInterest: () => void; onSkip: () => void }) {
  return (
    <article className="match-card">
      <MemberSummary member={member} />
      <div className="match-card__reasons"><strong>{mutual ? "你们已经互相心仪" : "为什么值得了解"}</strong><ul>{reasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
      <div className="match-card__actions">
        <button className={`button ${liked ? "button--soft is-liked" : "button--primary"}`} type="button" disabled={busy} aria-label={`${liked ? "取消喜欢" : "喜欢"}${member.nickname}`} onClick={onInterest}><Heart />{liked ? "已喜欢" : "喜欢"}</button>
        <button className="button button--text" type="button" disabled={busy} aria-label={`暂时跳过${member.nickname}`} onClick={onSkip}><X />暂时跳过</button>
        <Link className="button button--soft" to={`/member/${member.id}`}>查看资料<ArrowRight /></Link>
      </div>
    </article>
  );
}

function RelationshipCard({ member, kind, liked, busy, onInterest }: { member: Member; kind: "sent" | "received" | "mutual"; liked: boolean; busy: boolean; onInterest: () => void }) {
  return (
    <article className="match-card match-card--relationship">
      <MemberSummary member={member} />
      <div className="match-card__reasons"><strong>{kind === "mutual" ? "你们已经互相心仪" : kind === "sent" ? "你已表达喜欢" : "TA 对你表达了喜欢"}</strong><p>{kind === "mutual" ? "可以先和对方的 AI 分身聊聊，进一步了解彼此。" : kind === "sent" ? "对方回应后会进入互相心仪，你也可以继续查看资料。" : "查看资料后，由你决定是否回应。"}</p></div>
      <div className="match-card__actions">
        {kind === "received" && !liked ? <button className="button button--primary" type="button" disabled={busy} aria-label={`也喜欢${member.nickname}`} onClick={onInterest}><Heart />也喜欢 TA</button> : null}
        {liked ? <button className="button button--text" type="button" disabled={busy} aria-label={`取消喜欢${member.nickname}`} onClick={onInterest}>取消喜欢</button> : null}
        {kind === "mutual" ? <Link className="button button--primary" aria-label={`和${member.nickname}的 AI 分身聊聊`} to={`/matchmaking/${member.id}/chat`}><Bot />和 TA 的 AI 分身聊聊</Link> : <Link className="button button--soft" aria-label={`查看${member.nickname}的资料`} to={`/member/${member.id}`}>查看资料<ArrowRight /></Link>}
      </div>
    </article>
  );
}

function SkippedCard({ item, busy, onRestore }: { item: Recommendation; busy: boolean; onRestore: () => void }) {
  return (
    <article className="match-card match-card--relationship">
      <MemberSummary member={item.member} />
      <div className="match-card__reasons"><strong>本次浏览中已跳过</strong><p>恢复后，TA 会重新回到当前推荐列表。</p></div>
      <div className="match-card__actions"><button className="button button--primary" type="button" disabled={busy} aria-label={`恢复${item.member.nickname}`} onClick={onRestore}><Undo2 />恢复推荐</button></div>
    </article>
  );
}

function MemberSummary({ member }: { member: Member }) {
  return (
    <div className="match-card__member">
      <img src={member.photoUrl} alt={`${member.nickname}的头像`} />
      <div><span>{member.demo ? "演示资料 · " : ""}{member.city} · {member.job}</span><h2>{member.nickname}，{member.age} 岁</h2><p>{member.maritalStatus} · {member.goal}</p></div>
    </div>
  );
}

function PageState({ role, icon, title, description, action }: { role?: "status" | "alert"; icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state" role={role}>{icon}<h2>{title}</h2><p>{description}</p>{action}</div>;
}

function InlineEmpty({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="matchmaking-inline-empty"><Search /><h2>{title}</h2><p>{description}</p>{action}</div>;
}
