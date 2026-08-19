import { useEffect, useState } from "react";
import type { ContentItem, TopicCategory } from "@ai-marriage/shared";
import { topicCategories } from "@ai-marriage/shared";
import { CalendarDays, Camera, ChevronDown, ChevronUp, CircleUserRound, Hash, Heart, MapPin, Newspaper, RefreshCw, Send, ShieldCheck, Trash2 } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  cancelEventRegistration,
  createMoment,
  deleteMyContent,
  getContent,
  getMyEventRegistrations,
  getMyContent,
  likeContent,
  registerEvent,
  unlikeContent,
} from "../api/client";
import { members } from "../data/members";
import { useOtpAccount } from "../hooks/useOtpAccount";
import { CommentSection } from "../components/CommentSection";

const classroomCategories = [
  { label: "全部文章", value: "全部" },
  { label: "安全防骗", value: "安全" },
  { label: "相处沟通", value: "沟通" },
  { label: "家庭关系", value: "家庭" },
  { label: "线下见面", value: "见面" },
] as const;

type ClassroomCategory = (typeof classroomCategories)[number]["value"];

export interface ContentPageApi {
  getContent: typeof getContent;
  likeContent: typeof likeContent;
  unlikeContent: typeof unlikeContent;
  registerEvent: typeof registerEvent;
  cancelEventRegistration: typeof cancelEventRegistration;
  getMyEventRegistrations: typeof getMyEventRegistrations;
}

const defaultContentPageApi: ContentPageApi = {
  getContent,
  likeContent,
  unlikeContent,
  registerEvent,
  cancelEventRegistration,
  getMyEventRegistrations,
};

export interface MomentPageApi {
  createMoment: typeof createMoment;
  getMyContent: typeof getMyContent;
  deleteMyContent: typeof deleteMyContent;
}

const defaultMomentPageApi: MomentPageApi = { createMoment, getMyContent, deleteMyContent };

type ContentFilters = NonNullable<Parameters<ContentPageApi["getContent"]>[0]>;

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

function useContentCollection(contentApi: ContentPageApi, filters: ContentFilters) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void contentApi.getContent(filters).then((result) => {
      if (!active) return;
      setItems(result.items);
      setLoading(false);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(errorMessage(cause, "内容暂时无法加载，请稍后再试。"));
      setLoading(false);
    });
    return () => { active = false; };
  }, [contentApi, filters.pageSize, filters.query, filters.tag, filters.type, filters.upcomingOnly, requestVersion]);

  return { items, loading, error, retry: () => setRequestVersion((value) => value + 1) };
}

function ContentState({ loading, error, empty, label, retry }: { loading: boolean; error: string | null; empty: boolean; label: string; retry: () => void }) {
  if (loading) return <div className="content-state" role="status" aria-label={`正在加载${label}`}><RefreshCw className="content-state__spinner" aria-hidden="true" /><strong>正在加载{label}</strong><p>请稍候，内容很快就好。</p></div>;
  if (error) return <div className="content-state content-state--error" role="alert"><strong>{label}加载失败</strong><p>{error}</p><button className="button button--secondary" type="button" onClick={retry}><RefreshCw aria-hidden="true" />重新加载</button></div>;
  if (empty) return <div className="content-state"><Newspaper aria-hidden="true" /><strong>暂时还没有{label}</strong><p>新内容发布后会显示在这里，可以过一会儿再来看看。</p></div>;
  return null;
}

function LikeButton({ item, contentApi, kind }: { item: ContentItem; contentApi: ContentPageApi; kind: "动态" | "活动" | "案例" | "文章" }) {
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(item.likeCount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleLike() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = liked ? await contentApi.unlikeContent(item.id) : await contentApi.likeContent(item.id);
      setLiked(result.liked);
      setCount(result.likeCount);
    } catch (cause) {
      setError(errorMessage(cause, "操作没有完成，请稍后重试。"));
    } finally {
      setBusy(false);
    }
  }

  return <div className="content-reaction"><button className={`content-like-button${liked ? " is-liked" : ""}`} type="button" disabled={busy} aria-pressed={liked} aria-label={`${liked ? "取消喜欢" : "喜欢"}${kind}：${item.title}`} onClick={() => void toggleLike()}><Heart aria-hidden="true" fill={liked ? "currentColor" : "none"} /><span>{liked ? "已喜欢" : "喜欢"}</span><b>{count}</b></button>{error ? <small role="alert">{error}</small> : null}</div>;
}

function authorFor(authorId: string) {
  return members.find((member) => member.id === authorId);
}

function formatPublishedAt(value: number | null) {
  if (!value) return "刚刚发布";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(value);
}

function articleParagraphs(body: string) {
  return body.split(/\n\s*\n|\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

export function MomentsPage({ contentApi = defaultContentPageApi, momentApi = defaultMomentPageApi }: { contentApi?: ContentPageApi; momentApi?: MomentPageApi }) {
  const state = useContentCollection(contentApi, { type: "article", tag: "动态", pageSize: 50 });
  return <MomentsExperience contentApi={contentApi} momentApi={momentApi} state={state} />;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("照片读取失败。"));
    reader.onerror = () => reject(new Error("照片读取失败。"));
    reader.readAsDataURL(file);
  });
}

function MomentsExperience({ contentApi, momentApi, state }: { contentApi: ContentPageApi; momentApi: MomentPageApi; state: ReturnType<typeof useContentCollection> }) {
  const loggedIn = (() => {
    try { return Boolean(JSON.parse(localStorage.getItem("ai-marriage-auth-user") ?? "null")); }
    catch { return false; }
  })();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [myContent, setMyContent] = useState<ContentItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!loggedIn) return;
    let active = true;
    void momentApi.getMyContent().then((result) => { if (active) setMyContent(result.items); }).catch(() => undefined);
    return () => { active = false; };
  }, [loggedIn, momentApi]);

  async function submitMoment() {
    const text = body.trim();
    if (!text) { setMessage("请先写下想分享的生活内容。"); return; }
    setBusy(true); setMessage("");
    try {
      let totalBytes = 0;
      const images: Array<{ filename: string; mimeType: "image/jpeg" | "image/png" | "image/webp"; sizeBytes: number; dataUrl: string }> = [];
      for (const file of files) {
        if (file.type !== "image/jpeg" && file.type !== "image/png" && file.type !== "image/webp") throw new Error("请选择 JPG、PNG 或 WebP 照片。");
        if (file.size > 4 * 1024 * 1024) throw new Error("动态照片单张不能超过 4MB。");
        totalBytes += file.size;
        if (totalBytes > 32 * 1024 * 1024) throw new Error("本次动态照片总大小不能超过 32MB。");
        images.push({ filename: file.name, mimeType: file.type, sizeBytes: file.size, dataUrl: await readFileAsDataUrl(file) });
      }
      const result = await momentApi.createMoment({ body: text, images });
      setMyContent((current) => [result.content, ...current.filter((item) => item.id !== result.content.id)]);
      setBody(""); setFiles([]); setMessage("已提交审核");
    } catch (cause) { setMessage(errorMessage(cause, "动态提交失败，请稍后重试。")); }
    finally { setBusy(false); }
  }

  async function removeMoment(item: ContentItem) {
    setBusy(true); setMessage("");
    try {
      await momentApi.deleteMyContent(item.id);
      setMyContent((current) => current.filter((content) => content.id !== item.id));
      setMessage("动态已删除");
    } catch (cause) { setMessage(errorMessage(cause, "删除失败，请稍后重试。")); }
    finally { setBusy(false); }
  }

  return <div className="page-shell shell"><header className="page-header"><span>生活动态</span><h1>从真实日常，了解真实的人</h1><p>看看会员愿意公开分享的生活片段，找到让你感到亲切的日常。</p></header>
    <section className="moment-publisher" aria-label="发布生活动态">
      {loggedIn ? <><div className="moment-publisher__heading"><div><strong>分享我的生活</strong><span>提交后由平台审核，审核通过后大家都能看到。</span></div><Camera aria-hidden="true" /></div><label><span>动态内容</span><textarea aria-label="动态内容" rows={4} maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="比如：今天去了哪里、做了什么、有什么小收获……" /></label><div className="moment-publisher__actions"><label className="button button--soft"><Camera aria-hidden="true" />选择照片<input aria-label="动态照片" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => { const selected = [...(event.target.files ?? [])].slice(0, 9); setFiles(selected); setMessage(selected.length ? `已选择 ${selected.length} 张照片` : ""); }} /></label><button className="button button--primary" type="button" disabled={busy} onClick={() => void submitMoment()}><Send aria-hidden="true" />{busy ? "正在提交..." : "提交动态审核"}</button></div>{message ? <p className="moment-publisher__message" role="status">{message}</p> : null}{myContent.length ? <div className="my-moment-list"><strong>我的动态</strong>{myContent.map((item) => <article key={item.id}><div><span>{item.status === "published" ? "已发布" : item.status === "offline" ? "已下线" : "审核中"}</span><p>{item.body}</p></div><button type="button" className="icon-button" aria-label={`删除动态：${item.title}`} title="删除动态" disabled={busy} onClick={() => void removeMoment(item)}><Trash2 aria-hidden="true" /></button></article>)}</div> : null}</> : <div className="moment-login-prompt"><div><strong>登录后可以分享生活动态</strong><span>文字和照片提交审核后，会展示在这里。</span></div><Link className="button button--primary" to="/auth?next=%2Fmoments">登录 / 注册</Link></div>}
    </section>
    <ContentState {...state} empty={!state.items.length} label="生活动态" />{!state.loading && !state.error && state.items.length ? <div className="moments-feed">{state.items.map((item) => { const author = authorFor(item.authorId); const images = item.imageUrls?.length ? item.imageUrls : item.coverImageUrl ? [item.coverImageUrl] : []; return <article key={item.id}><header>{author ? <img src={author.photoUrl} alt={`${author.nickname}的头像`} /> : <span className="content-author-fallback" aria-hidden="true"><CircleUserRound /></span>}<span><strong>{author?.nickname ?? "平台会员"}</strong><small>{formatPublishedAt(item.publishedAt)}</small></span></header><div className="moment-copy"><h2>{item.title}</h2><p>{item.body || item.summary}</p></div>{images.length ? <div className={`moment-images moment-images--${Math.min(images.length, 3)}`}>{images.map((url, index) => <img key={`${item.id}-${url}`} src={url} alt={`${item.title}的生活照片 ${index + 1}`} />)}</div> : null}<footer><LikeButton item={item} contentApi={contentApi} kind="动态" /></footer><CommentSection contentId={item.id} /></article>; })}</div> : null}</div>;
}


function formatEventDate(value: number) {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(value);
}

function formatEventDateTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(value);
}

function eventCity(item: ContentItem) {
  const location = item.event?.location.trim() ?? "";
  const matchingTag = item.tags.find((tag) => tag.length >= 2 && tag.length <= 6 && location.startsWith(tag.replace(/市$/, "")));
  if (matchingTag) return matchingTag.replace(/市$/, "");
  const cityWithSuffix = location.match(/^(.{2,6}?)(?:市)/)?.[1];
  return (cityWithSuffix ?? location.slice(0, 2)) || "其他";
}

function EventCard({ item, index, contentApi, registered, onRegistrationChange }: { item: ContentItem; index: number; contentApi: ContentPageApi; registered: boolean; onRegistrationChange: (result: Awaited<ReturnType<typeof registerEvent>>) => void }) {
  const event = item.event;
  const [remainingCapacity, setRemainingCapacity] = useState(event?.remainingCapacity ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!event) return null;
  const full = remainingCapacity <= 0 && !registered;

  async function toggleRegistration() {
    if (busy || full) return;
    setBusy(true);
    setError(null);
    try {
      const result = registered ? await contentApi.cancelEventRegistration(item.id) : await contentApi.registerEvent(item.id);
      setRemainingCapacity(result.remainingCapacity);
      onRegistrationChange(result);
    } catch (cause) {
      setError(errorMessage(cause, "报名操作没有完成，请稍后重试。"));
    } finally {
      setBusy(false);
    }
  }

  const buttonLabel = full ? `活动已满：${item.title}` : registered ? `取消报名：${item.title}` : `报名活动：${item.title}`;
  const detailsId = `activity-details-${item.id}`;
  return <article><div className={`activity-poster activity-poster--${index % 3 + 1}`}>{item.coverImageUrl ? <img src={item.coverImageUrl} alt={`${item.title}活动照片`} /> : <><CalendarDays aria-hidden="true" /><span>{formatEventDate(event.startsAt)}</span></>}</div><div><span><MapPin aria-hidden="true" />{event.location}</span><h2>{item.title}</h2><p>{item.summary}</p><b>{registered ? "已报名" : full ? "名额已满" : `剩余 ${remainingCapacity} 个名额`}</b>{detailsOpen ? <div className="activity-details" id={detailsId}><dl><div><dt>开始时间</dt><dd>{formatEventDateTime(event.startsAt)}</dd></div><div><dt>结束时间</dt><dd>{formatEventDateTime(event.endsAt)}</dd></div><div><dt>活动人数</dt><dd>{event.capacity} 人</dd></div></dl><p>{item.body}</p></div> : null}<div className="content-action-row"><button className={`button ${registered ? "button--secondary" : "button--primary"}`} type="button" disabled={busy || full} aria-label={buttonLabel} onClick={() => void toggleRegistration()}>{busy ? "处理中..." : registered ? "取消报名" : full ? "活动已满" : "立即报名"}</button><button className="button button--text" type="button" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen((value) => !value)}>{detailsOpen ? "收起详情" : "查看详情"}{detailsOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}</button><LikeButton item={item} contentApi={contentApi} kind="活动" /></div>{error ? <small className="content-action-error" role="alert">{error}</small> : null}</div></article>;
}

export function ActivitiesPage({ contentApi = defaultContentPageApi }: { contentApi?: ContentPageApi }) {
  const state = useContentCollection(contentApi, { type: "event", upcomingOnly: true, pageSize: 50 });
  const [view, setView] = useState<"all" | "mine">("all");
  const [myRegistrations, setMyRegistrations] = useState<Awaited<ReturnType<typeof getMyEventRegistrations>>["items"]>([]);
  const [registrationLoading, setRegistrationLoading] = useState(true);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [city, setCity] = useState("全部城市");
  const [dateRange, setDateRange] = useState("全部日期");
  const [query, setQuery] = useState("");
  useEffect(() => {
    let active = true;
    setRegistrationLoading(true);
    setRegistrationError(null);
    void contentApi.getMyEventRegistrations().then((result) => {
      if (!active) return;
      setMyRegistrations(result.items);
      setRegistrationLoading(false);
    }).catch((cause: unknown) => {
      if (!active) return;
      setMyRegistrations([]);
      setRegistrationError(errorMessage(cause, "登录后可以查看我的活动。"));
      setRegistrationLoading(false);
    });
    return () => { active = false; };
  }, [contentApi]);
  const registeredIds = new Set(myRegistrations.map((item) => item.registration.contentId));
  const cities = [...new Set(state.items.map(eventCity))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const maxStartAt = dateRange === "7天内" ? Date.now() + 7 * 86_400_000 : dateRange === "30天内" ? Date.now() + 30 * 86_400_000 : Number.POSITIVE_INFINITY;
  const visibleItems = state.items.filter((item) => {
    const matchesCity = city === "全部城市" || eventCity(item) === city;
    const matchesDate = (item.event?.startsAt ?? Number.POSITIVE_INFINITY) <= maxStartAt;
    const searchable = [item.title, item.summary, item.event?.location ?? "", ...item.tags].join(" ").toLocaleLowerCase("zh-CN");
    return matchesCity && matchesDate && (!normalizedQuery || searchable.includes(normalizedQuery));
  });
  function clearFilters() {
    setCity("全部城市");
    setDateRange("全部日期");
    setQuery("");
  }
  function updateRegistration(item: ContentItem, result: Awaited<ReturnType<typeof registerEvent>>) {
    if (result.registration?.status === "registered") {
      setMyRegistrations((current) => [
        { registration: result.registration!, content: { ...item, registrationCount: result.registrationCount, event: item.event ? { ...item.event, remainingCapacity: result.remainingCapacity } : null } },
        ...current.filter((entry) => entry.registration.contentId !== item.id),
      ]);
    } else {
      setMyRegistrations((current) => current.filter((entry) => entry.registration.contentId !== item.id));
    }
  }
  const mine = myRegistrations.map((entry) => entry.content);
  const displayedItems = view === "mine" ? mine : visibleItems;
  const ready = !state.loading && !state.error && !registrationLoading;

  return <div className="page-shell shell">
    <header className="page-header"><span>线下活动</span><h1>在公开、轻松的场合认识新朋友</h1><p>查看时间、地点和剩余名额，选择适合自己的同城活动。</p></header>
    <p className="content-readonly-note"><ShieldCheck aria-hidden="true" />活动优先安排在公共场所，请自行保管好随身物品并告知家人行程。</p>
    <div className="segmented activity-view-switch" role="group" aria-label="活动查看方式"><button type="button" className={view === "all" ? "is-active" : ""} aria-pressed={view === "all"} onClick={() => setView("all")}>全部活动</button><button type="button" className={view === "mine" ? "is-active" : ""} aria-pressed={view === "mine"} onClick={() => setView("mine")}>我的活动（{myRegistrations.length}）</button></div>
    <ContentState {...state} loading={state.loading || registrationLoading} empty={view === "all" ? !state.items.length : false} label="可报名的活动" />
    {ready && view === "mine" && registrationError ? <div className="content-state"><CalendarDays aria-hidden="true" /><strong>登录后可以查看我的活动</strong><p>{registrationError}</p><Link className="button button--primary" to="/auth?next=%2Factivities">去登录</Link></div> : null}
    {ready && view === "all" && state.items.length ? <section className="activity-filters" aria-label="筛选线下活动"><label><span>搜索活动</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="活动名称或地点" /></label><label><span>活动城市</span><select value={city} onChange={(event) => setCity(event.target.value)}><option>全部城市</option>{cities.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>活动日期</span><select value={dateRange} onChange={(event) => setDateRange(event.target.value)}><option>全部日期</option><option>7天内</option><option>30天内</option></select></label></section> : null}
    {ready && (view === "all" || !registrationError) && displayedItems.length ? <div className="activity-grid">{displayedItems.map((item, index) => <EventCard key={item.id} item={item} index={index} contentApi={contentApi} registered={registeredIds.has(item.id)} onRegistrationChange={(result) => updateRegistration(item, result)} />)}</div> : null}
    {ready && view === "all" && state.items.length && !displayedItems.length ? <div className="content-state"><CalendarDays aria-hidden="true" /><strong>没有符合条件的活动</strong><p>可以换一个城市、日期或关键词再看看。</p><button className="button button--secondary" type="button" onClick={clearFilters}>清除筛选</button></div> : null}
    {ready && view === "mine" && !registrationError && !displayedItems.length ? <div className="content-state"><CalendarDays aria-hidden="true" /><strong>还没有已报名的活动</strong><p>可以回到全部活动，选择时间和地点合适的活动。</p><button className="button button--secondary" type="button" onClick={() => setView("all")}>查看全部活动</button></div> : null}
  </div>;
}

export function StoriesPage({ contentApi = defaultContentPageApi }: { contentApi?: ContentPageApi }) {
  const state = useContentCollection(contentApi, { type: "article", tag: "幸福案例", pageSize: 50 });
  const [openStory, setOpenStory] = useState<string | null>(null);
  return <div className="page-shell shell"><header className="page-header"><span>幸福案例</span><h1>认真了解之后，关系才真正开始</h1><p>案例使用化名并经过授权，用平实的经历分享相处方式。</p></header><ContentState {...state} empty={!state.items.length} label="幸福案例" />{!state.loading && !state.error && state.items.length ? <div className="story-list">{state.items.map((story, index) => { const expanded = openStory === story.id; const contentId = `story-content-${story.id}`; return <article key={story.id}>{story.coverImageUrl ? <img src={story.coverImageUrl} alt={`${story.title}案例配图`} /> : <div className="story-image-placeholder"><Heart aria-hidden="true" /></div>}<div><span>幸福案例 {index + 1}</span><h2>{story.title}</h2><p>{story.summary}</p>{expanded ? <div className="story-full-content" id={contentId}>{articleParagraphs(story.body).map((paragraph, paragraphIndex) => <p key={`${story.id}-${paragraphIndex}`}>{paragraph}</p>)}</div> : null}<div className="content-action-row"><button className="inline-link content-disclosure" type="button" aria-expanded={expanded} aria-controls={contentId} aria-label={`${expanded ? "收起" : "阅读"}完整案例：${story.title}`} onClick={() => setOpenStory(expanded ? null : story.id)}>{expanded ? "收起完整案例" : "阅读完整案例"}{expanded ? <ChevronUp /> : <ChevronDown />}</button><LikeButton item={story} contentApi={contentApi} kind="案例" /></div></div></article>; })}</div> : null}</div>;
}

function classroomCategory(article: ContentItem): Exclude<ClassroomCategory, "全部"> {
  const category = classroomCategories.slice(1).find((item) => article.tags.includes(item.value));
  if (!category || category.value === "全部") return "沟通";
  return category.value;
}

export function ClassroomPage({ contentApi = defaultContentPageApi }: { contentApi?: ContentPageApi }) {
  const state = useContentCollection(contentApi, { type: "article", tag: "婚恋课堂", pageSize: 50 });
  const [activeCategory, setActiveCategory] = useState<ClassroomCategory>("全部");
  const [openArticle, setOpenArticle] = useState<string | null>(null);
  const visibleArticles = activeCategory === "全部" ? state.items : state.items.filter((article) => classroomCategory(article) === activeCategory);

  function selectCategory(category: ClassroomCategory) {
    setActiveCategory(category);
    setOpenArticle(null);
  }

  return <div className="page-shell shell"><header className="page-header"><span>婚恋课堂</span><h1>把重要的话，提前想清楚</h1><p>阅读关于安全、沟通、家庭和第一次见面的实用内容。</p></header><ContentState {...state} empty={!state.items.length} label="课堂文章" />{!state.loading && !state.error && state.items.length ? <div className="classroom-layout"><aside aria-label="文章分类"><strong>文章分类</strong>{classroomCategories.map((category) => <button className={activeCategory === category.value ? "is-active" : undefined} type="button" aria-pressed={activeCategory === category.value} key={category.value} onClick={() => selectCategory(category.value)}>{category.label}</button>)}</aside><section className="classroom-list" aria-label="文章列表">{visibleArticles.length ? visibleArticles.map((article, articleIndex) => { const expanded = openArticle === article.id; const contentId = `classroom-article-${article.id}`; const category = classroomCategory(article); const paragraphs = articleParagraphs(article.body); const readTime = `${Math.max(2, Math.ceil(article.body.length / 300))} 分钟`; return <article key={article.id}><div className="classroom-article-summary"><span className={`article-number article-number--${articleIndex % 4 + 1}`}>{String(articleIndex + 1).padStart(2, "0")}</span><div><small>{category}</small><h2>{article.title}</h2><p>{article.summary}</p><b>{readTime}</b></div><Newspaper aria-hidden="true" /></div>{expanded ? <div className="classroom-article-body" id={contentId}>{paragraphs.map((paragraph, paragraphIndex) => <p key={`${article.id}-${paragraphIndex}`}>{paragraph}</p>)}</div> : null}<div className="content-action-row classroom-actions"><button className="inline-link content-disclosure" type="button" aria-expanded={expanded} aria-controls={contentId} aria-label={`${expanded ? "收起" : "阅读"}文章：${article.title}`} onClick={() => setOpenArticle(expanded ? null : article.id)}>{expanded ? "收起文章" : "阅读文章"}{expanded ? <ChevronUp /> : <ChevronDown />}</button><LikeButton item={article} contentApi={contentApi} kind="文章" /></div></article>; }) : <div className="content-state"><Newspaper aria-hidden="true" /><strong>这个分类暂时没有文章</strong><p>可以选择“全部文章”查看其他内容。</p></div>}</section></div> : null}</div>;
}

export function SafetyPage() {
  return <div className="page-shell shell"><header className="page-header"><span>安全中心</span><h1>认真交往，安全始终放在前面</h1><p>保护隐私、识别风险，也尊重自己和对方的边界。</p></header><div className="safety-topics">{["资料和照片经过审核", "联系方式默认不公开", "双方同意后才能聊天", "遇到骚扰可以举报拉黑"].map((item) => <article key={item}><ShieldCheck /><h2>{item}</h2><p>每一步都有清楚的状态和可撤回选择，不强迫用户继续联系。</p></article>)}</div><div className="warning-box"><strong>请特别注意</strong><p>不要向未见面的陌生人转账，不协助投资、代购或借款。发现诱导转账时请立即停止联系并举报。</p></div></div>;
}

function LegalPage({ title, introduction, sections }: { title: string; introduction: string; sections: Array<{ title: string; paragraphs: string[] }> }) {
  return (
    <div className="page-shell shell">
      <header className="page-header"><span>平台规则</span><h1>{title}</h1><p>{introduction}</p></header>
      <div className="story-list">
        {sections.map((section) => <section className="profile-section" key={section.title}><h2>{section.title}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}
      </div>
      <Link className="back-link" to="/auth">返回登录</Link>
    </div>
  );
}

export function UserAgreementPage() {
  return <LegalPage title="用户协议" introduction="使用缘来相伴前，请阅读并理解以下账号、资料、交流和安全规则。" sections={[
    { title: "账号与使用规则", paragraphs: ["你应使用本人手机号注册账号，并保证提交的年龄、婚姻状态、照片和个人资料真实、合法。不得冒用他人身份、批量注册账号或将账号交给他人使用。", "平台面向年满 18 周岁的用户。发现账号存在欺诈、骚扰、违法内容或危及他人安全的行为时，平台可以限制功能、暂停账号并保留必要记录。"] },
    { title: "资料与 AI 分身", paragraphs: ["你可以决定提交哪些婚恋资料，并在生成 AI 分身后确认是否启用。AI 分身仅根据授权信息回答，不代表本人实时发言，也不能替代双方直接沟通。", "请勿在资料、问答或聊天中发布手机号、身份证号、住址、金融账户等不必要的敏感信息。"] },
    { title: "交流与安全", paragraphs: ["只有在满足平台流程且双方同意后，才能进入真人聊天。任何一方都可以拒绝申请、停止交流、举报或屏蔽对方。", "不得诱导转账、借款、投资或从事违法活动。线下见面应选择公共场所并将行程告知可信任的亲友。"] },
    { title: "协议更新与联系", paragraphs: ["平台会根据功能和法律要求更新本协议。重要变化会以页面提示等合理方式告知；继续使用前请再次阅读相关内容。"] },
  ]} />;
}

export function PrivacyPolicyPage() {
  return <LegalPage title="隐私政策" introduction="我们只在提供账号、匹配、审核和聊天服务所必需的范围内处理个人信息。" sections={[
    { title: "我们收集的信息", paragraphs: ["注册时会处理手机号和验证码记录；建档时会处理昵称、出生年份、城市、婚姻状态、择偶偏好、问答和你主动上传的照片。", "使用匹配与聊天功能时，会处理兴趣记录、AI 分身会话、真人聊天申请、消息、举报和屏蔽记录。"] },
    { title: "信息的使用", paragraphs: ["这些信息用于身份验证、保存婚恋档案、生成你确认授权的 AI 分身、提供匹配和聊天、审核内容、处理举报以及保障账号安全。", "平台不会在未经允许的情况下公开手机号、详细地址或私密问答，也不会把个人信息用于与本服务无关的用途。"] },
    { title: "存储与保护", paragraphs: ["账号、资料和业务记录保存在受控数据库中，照片保存在受控对象存储中。敏感字段、验证码和会话凭证采用相应的加密或哈希保护，并限制后台访问权限。"] },
    { title: "你的选择", paragraphs: ["你可以修改资料、暂停或撤销 AI 分身授权、删除照片、屏蔽用户，并按照平台提供的方式申请处理个人信息或注销账号。为满足安全审计和法律义务，部分记录可能需要在限定期限内保留。"] },
  ]} />;
}

function safeNextPath(value: string | null) {
  return value?.startsWith("/")
    && !value.startsWith("//")
    && !value.includes("\\")
    && !/[\u0000-\u001F\u007F]/.test(value)
    ? value
    : null;
}

export function AuthPage() {
  const otpAccount = useOtpAccount();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const onboardingTarget = nextPath?.startsWith("/onboarding?")
    ? nextPath
    : nextPath
      ? `/onboarding?next=${encodeURIComponent(nextPath)}`
      : "/onboarding";
  const requestLabel = otpAccount.busy
    ? "发送中..."
    : otpAccount.secondsUntilResend > 0
      ? `${otpAccount.secondsUntilResend} 秒后重发`
      : "获取验证码";

  async function loginAndContinue() {
    const result = await otpAccount.verifyAccount();
    if (!result) return;
    localStorage.setItem("ai-marriage-auth-user", JSON.stringify(result.user));
    sessionStorage.removeItem("ai-marriage-auth-profile");
    if (result.user.status === "suspended") {
      navigate("/me/security");
      return;
    }
    if (result.user.role === "admin" || result.user.role === "moderator") {
      navigate(nextPath ?? "/admin/review");
      return;
    }
    if (result.profile) {
      navigate(nextPath ?? "/me");
      return;
    }
    navigate(onboardingTarget);
  }

  return <div className="auth-page"><section><span>欢迎回来</span><h1>登录缘来相伴</h1><p>登录后可以继续查看心仪对象、完成婚恋档案和处理聊天申请。未注册的手机号验证后会自动创建账号。</p><label><span>手机号码</span><input aria-label="手机号码" value={otpAccount.phone} onChange={(event) => otpAccount.setPhone(event.target.value)} type="tel" autoComplete="tel" placeholder="请输入手机号" /></label><label><span>验证码</span><span className="input-with-action"><input aria-label="验证码" value={otpAccount.code} onChange={(event) => otpAccount.setCode(event.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" placeholder="6 位验证码" /><button type="button" onClick={() => void otpAccount.sendCode()} disabled={otpAccount.busy || otpAccount.secondsUntilResend > 0 || otpAccount.isVerified}>{requestLabel}</button></span></label><div className="check-row auth-page__agreement-check"><input id="auth-agreement" aria-label="我已阅读并同意用户协议和隐私政策" type="checkbox" checked={otpAccount.agreed} onChange={(event) => otpAccount.setAgreed(event.target.checked)} /><span><label htmlFor="auth-agreement">我已阅读并同意</label>《<Link to="/terms">用户协议</Link>》和《<Link to="/privacy">隐私政策</Link>》</span></div><button className="button button--primary button--block" type="button" onClick={() => void loginAndContinue()} disabled={otpAccount.busy}>{otpAccount.busy ? "正在验证..." : "登录并继续"}</button>{otpAccount.message ? <p className={`form-tip account-status${otpAccount.isVerified ? " account-status--success" : ""}`} role="status">{otpAccount.message}</p> : null}<p className="auth-page__agreement">首次登录后，请继续完成婚恋档案。</p><Link className="inline-link" to={onboardingTarget}>直接进入完整建档流程</Link></section></div>;
}

export function TopicPlazaPage({ contentApi = defaultContentPageApi }: { contentApi?: ContentPageApi }) {
  const state = useContentCollection(contentApi, { type: "article", pageSize: 100 });
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

  const filteredItems = activeTopic
    ? state.items.filter((item) => item.tags.some((tag) => tag.includes(activeTopic)))
    : state.items;

  return (
    <div className="page-shell shell">
      <header className="page-header">
        <span>话题广场</span>
        <h1>聊聊大家都关心的事</h1>
        <p>选择一个感兴趣的话题，看看别人的分享，也留下你的想法。</p>
      </header>

      <nav className="topic-grid" aria-label="话题分类">
        {topicCategories.map((category) => (
          <button
            key={category.id}
            className={`topic-card${activeTopic === category.id ? " is-active" : ""}`}
            style={{ "--topic-color": category.color } as React.CSSProperties}
            type="button"
            aria-pressed={activeTopic === category.id}
            onClick={() => setActiveTopic(activeTopic === category.id ? null : category.id)}
          >
            <span className="topic-card__icon" aria-hidden="true">{category.icon}</span>
            <strong>{category.label}</strong>
            <small>{category.description}</small>
            <Hash aria-hidden="true" />
          </button>
        ))}
      </nav>

      {activeTopic && (
        <div className="topic-active-header">
          <strong>
            {topicCategories.find((c) => c.id === activeTopic)?.icon}{" "}
            {topicCategories.find((c) => c.id === activeTopic)?.label}
          </strong>
          <span>{filteredItems.length} 篇相关内容</span>
          <button type="button" className="button button--text" onClick={() => setActiveTopic(null)}>
            查看全部话题
          </button>
        </div>
      )}

      <ContentState {...state} empty={!state.items.length} label="话题内容" />

      {!state.loading && !state.error && filteredItems.length ? (
        <div className="topic-feed">
          {filteredItems.map((item) => {
            const author = authorFor(item.authorId);
            return (
              <article key={item.id}>
                <header>
                  {author ? (
                    <img src={author.photoUrl} alt={`${author.nickname}的头像`} />
                  ) : (
                    <span className="content-author-fallback" aria-hidden="true"><CircleUserRound /></span>
                  )}
                  <span>
                    <strong>{author?.nickname ?? "平台会员"}</strong>
                    <small>{formatPublishedAt(item.publishedAt)}</small>
                  </span>
                </header>
                <div className="moment-copy">
                  <h2>{item.title}</h2>
                  <p>{item.body || item.summary}</p>
                </div>
                {item.tags.length ? (
                  <div className="topic-tags">
                    {item.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                  </div>
                ) : null}
                <footer>
                  <LikeButton item={item} contentApi={contentApi} kind="动态" />
                </footer>
                <CommentSection contentId={item.id} />
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
