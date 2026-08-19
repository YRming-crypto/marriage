import type { Gender, MaritalStatus, RelationshipGoal } from "@ai-marriage/shared";
import { Filter, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { MemberCard } from "../components/MemberCard";
import { SkeletonGrid } from "../components/Skeleton";
import { cities } from "../data/members";
import { useMembers } from "../api/useMembers";
import { MemberInterestProvider } from "../features/interests/MemberInterestContext";

const maritalStatuses: Array<"不限" | MaritalStatus> = ["不限", "未婚", "离异", "丧偶"];
const goals: Array<"不限" | RelationshipGoal> = ["不限", "认真交往", "以结婚为目标", "先认识了解"];
const smokingStatuses = ["不限", "不吸烟", "偶尔吸烟", "吸烟"] as const;
const childrenStatuses = ["不限", "无子女", "有子女", "子女已成年"] as const;
type SortOrder = "default" | "recent-active" | "newest" | "age-asc" | "age-desc";
const PAGE_SIZE = 6;

export function FindPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    const value = searchParams.get("sort");
    return value === "recent-active" || value === "newest" || value === "age-asc" || value === "age-desc" ? value : "default";
  });
  const [draft, setDraft] = useState(() => ({
    gender: searchParams.get("gender") ?? "不限",
    minAge: searchParams.get("minAge") ?? "35",
    maxAge: searchParams.get("maxAge") ?? "65",
    city: searchParams.get("city") ?? "不限",
    maritalStatus: searchParams.get("maritalStatus") ?? "不限",
    goal: searchParams.get("goal") ?? "不限",
    smoking: searchParams.get("smoking") ?? "不限",
    children: searchParams.get("children") ?? "不限",
    onlyWithPhoto: searchParams.get("onlyWithPhoto") === "1" ? "1" : "0",
  }));

  const applied = {
    gender: searchParams.get("gender") ?? "不限",
    minAge: Number(searchParams.get("minAge") ?? 35),
    maxAge: Number(searchParams.get("maxAge") ?? 65),
    city: searchParams.get("city") ?? "不限",
    maritalStatus: searchParams.get("maritalStatus") ?? "不限",
    goal: searchParams.get("goal") ?? "不限",
    smoking: searchParams.get("smoking") ?? "不限",
    children: searchParams.get("children") ?? "不限",
    onlyWithPhoto: searchParams.get("onlyWithPhoto") === "1",
  };
  const {
    members: liveMembers,
    total,
    hasMore,
    loadingMore,
    status: memberStatus,
    error: memberError,
    loadMore,
    retry,
  } = useMembers({
    gender: applied.gender === "不限" ? undefined : applied.gender as Gender,
    minAge: applied.minAge,
    maxAge: applied.maxAge,
    city: applied.city === "不限" ? undefined : applied.city,
    maritalStatus: applied.maritalStatus === "不限" ? undefined : applied.maritalStatus as MaritalStatus,
    goal: applied.goal === "不限" ? undefined : applied.goal as RelationshipGoal,
    smokingStatus: applied.smoking === "不限" ? undefined : applied.smoking,
    childrenStatus: applied.children === "不限" ? undefined : applied.children,
    onlyWithPhoto: applied.onlyWithPhoto || undefined,
    sort: sortOrder,
    pageSize: PAGE_SIZE,
  });

  const activeFilterCount = [applied.gender, applied.city, applied.maritalStatus, applied.goal, applied.smoking, applied.children]
    .filter((value) => value !== "不限").length + (applied.minAge !== 35 || applied.maxAge !== 65 ? 1 : 0) + (applied.onlyWithPhoto ? 1 : 0);
  const quickCities = ["不限", ...cities.filter((city) => city !== "不限").slice(0, 5)];

  const remainingCount = Math.max(0, total - liveMembers.length);

  function updateDraft(key: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function applyFilters() {
    const params = new URLSearchParams(searchParams);
    Object.entries(draft).forEach(([key, value]) => {
      if (value !== "不限" && value !== "0" && !((key === "minAge" && value === "35") || (key === "maxAge" && value === "65"))) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    if (sortOrder !== "default") params.set("sort", sortOrder);
    else params.delete("sort");
    setSearchParams(params);
    setMobileFiltersOpen(false);
  }

  function resetFilters() {
    const defaults = { gender: "不限", minAge: "35", maxAge: "65", city: "不限", maritalStatus: "不限", goal: "不限", smoking: "不限", children: "不限", onlyWithPhoto: "0" };
    setDraft(defaults);
    setSearchParams({});
    setSortOrder("default");
  }

  function changeSort(value: SortOrder) {
    setSortOrder(value);
    const params = new URLSearchParams(searchParams);
    if (value === "default") params.delete("sort");
    else params.set("sort", value);
    setSearchParams(params, { replace: true });
  }

  return (
    <MemberInterestProvider><div className="page-shell shell">
      <header className="page-header page-header--split find-header">
        <div><span>匹配大厅</span><h1>匹配大厅</h1><p>按你在意的条件筛选，也可以先看看更多真实生活信息。</p></div>
        <button className="button button--soft mobile-filter-button" type="button" onClick={() => setMobileFiltersOpen(true)}>
          <SlidersHorizontal /> 筛选条件{activeFilterCount ? `（${activeFilterCount}）` : ""}
        </button>
      </header>

      <section className="find-summary" aria-label="快捷筛选城市">
        <div className="find-summary__title">
          <span>快捷筛选</span>
          <strong>按城市快速锁定最适合的缘分</strong>
        </div>
        <div className="find-preset-row">
          {quickCities.map((city) => (
            <button
              key={city}
              type="button"
              className={`quick-search-preset ${draft.city === city ? "is-selected" : ""}`}
              onClick={() => updateDraft("city", city)}
            >
              {city}
            </button>
          ))}
        </div>
      </section>

      <div className="find-layout">
        <aside className={`filter-panel ${mobileFiltersOpen ? "is-open" : ""}`} aria-label="筛选条件">
          <div className="filter-panel__head"><strong><Filter />筛选条件</strong><span>已选 {activeFilterCount} 项</span></div>
          <label><span>想认识</span><select value={draft.gender} onChange={(event) => updateDraft("gender", event.target.value)}><option>不限</option><option>女性</option><option>男性</option></select></label>
          <fieldset><legend>年龄范围</legend><select aria-label="最小年龄" value={draft.minAge} onChange={(event) => updateDraft("minAge", event.target.value)}>{[35, 40, 45, 50, 55].map((age) => <option key={age}>{age}</option>)}</select><span>至</span><select aria-label="最大年龄" value={draft.maxAge} onChange={(event) => updateDraft("maxAge", event.target.value)}>{[45, 50, 55, 60, 65].map((age) => <option key={age}>{age}</option>)}</select></fieldset>
          <label><span>所在城市</span><select value={draft.city} aria-label="所在城市" onChange={(event) => updateDraft("city", event.target.value)}>{cities.map((city) => <option key={city}>{city}</option>)}</select></label>
          <label><span>婚姻状态</span><select value={draft.maritalStatus} onChange={(event) => updateDraft("maritalStatus", event.target.value)}>{maritalStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label><span>交往目标</span><select value={draft.goal} onChange={(event) => updateDraft("goal", event.target.value)}>{goals.map((goal) => <option key={goal}>{goal}</option>)}</select></label>
          <label><span>吸烟情况</span><select aria-label="吸烟情况" value={draft.smoking} onChange={(event) => updateDraft("smoking", event.target.value)}>{smokingStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label><span>子女情况</span><select aria-label="子女情况" value={draft.children} onChange={(event) => updateDraft("children", event.target.value)}>{childrenStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="filter-checkbox"><input type="checkbox" checked={draft.onlyWithPhoto === "1"} onChange={(event) => updateDraft("onlyWithPhoto", event.target.checked ? "1" : "0")} /><span>仅看有照片</span></label>
          <div className="filter-panel__actions">
            <button className="button button--primary" type="button" onClick={applyFilters}><Search />应用筛选</button>
            <button className="button button--text" type="button" onClick={resetFilters}><RotateCcw />重置</button>
            <button className="button button--soft filter-panel__cancel" type="button" onClick={() => setMobileFiltersOpen(false)}>取消</button>
          </div>
        </aside>

        <section className="find-results" aria-live="polite" aria-label="匹配结果">
          <div className="result-toolbar">
            <div>
              <strong>{memberStatus === "loading" ? "正在读取会员资料" : `找到 ${total} 位会员`}</strong>
              <span>{applied.city === "不限" ? "全部城市" : applied.city} · 仅展示审核通过的资料</span>
            </div>
            <div className="result-toolbar__meta" aria-label="结果概览">
              <span className="result-toolbar__chip">更适合你</span>
              <span className="result-toolbar__chip result-toolbar__chip--soft">真实资料</span>
            </div>
            <label><span>排序</span><select aria-label="排序方式" value={sortOrder} onChange={(event) => changeSort(event.target.value as SortOrder)}><option value="default">默认顺序</option><option value="recent-active">最近活跃</option><option value="newest">最新加入</option><option value="age-asc">年龄从小到大</option><option value="age-desc">年龄从大到小</option></select></label>
          </div>
          {memberStatus === "loading" ? (
            <SkeletonGrid count={6} />
          ) : memberStatus === "error" ? (
            <EmptyState kind="search" title="匹配大厅暂时无法加载" description={memberError} role="alert" action={<button className="button button--primary" type="button" onClick={retry}>重新加载</button>} />
          ) : liveMembers.length ? (
            <>
              <div className="member-grid member-grid--results" data-reveal-group>
                {liveMembers.map((member) => <MemberCard member={member} key={member.id} />)}
              </div>
              <div className="find-pagination">
                <span>{hasMore ? `已显示 ${liveMembers.length} / ${total} 位` : `已显示全部 ${total} 位会员`}</span>
                {hasMore ? <button className="button button--soft" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "正在加载..." : `加载更多（还剩 ${remainingCount} 位）`}</button> : null}
                {memberError ? <small role="alert">{memberError}</small> : null}
              </div>
            </>
          ) : (
            <EmptyState kind="heart" title="暂时没有符合全部条件的人" description="可以放宽城市或年龄范围，再看看其他愿意认真认识的人。" action={<button className="button button--primary" type="button" onClick={resetFilters}>清除筛选条件</button>} />
          )}
        </section>
      </div>
    </div></MemberInterestProvider>
  );
}
