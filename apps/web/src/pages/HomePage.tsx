import {
  ArrowRight,
  CalendarDays,
  HeartHandshake,
  MessageCircleMore,
  Newspaper,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRoundPen,
  Users,
} from "lucide-react";
import type { ContentItem } from "@ai-marriage/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getContent } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { MemberCard } from "../components/MemberCard";
import { QuickSearch } from "../components/QuickSearch";
import { SkeletonGrid, SkeletonHero } from "../components/Skeleton";
import { SectionHeading } from "../components/SectionHeading";
import { useMembers } from "../api/useMembers";
import { MemberInterestProvider } from "../features/interests/MemberInterestContext";

const services = [
  { icon: Search, title: "找对象", text: "按城市、年龄和交往目标，寻找愿意认真认识的人。", to: "/find", tone: "red" },
  { icon: Sparkles, title: "智能牵线", text: "选择心仪对象后，先和 TA 的 AI 分身安心聊聊。", to: "/matchmaking", tone: "blue" },
  { icon: HeartHandshake, title: "性格缘分", text: "趣味小题探索你的性格画像，匹配更合适的人。", to: "/soul-test", tone: "purple" },
  { icon: MessageCircleMore, title: "我的消息", text: "查看聊天申请、系统通知和已经开启的真人聊天。", to: "/messages", tone: "green" },
  { icon: Users, title: "生活动态", text: "从日常照片和分享中，更自然地了解一个人。", to: "/moments", tone: "yellow" },
  { icon: CalendarDays, title: "线下活动", text: "查看人数适中、地点公开的同城活动形式。", to: "/activities", tone: "orange" },
  { icon: Trophy, title: "任务中心", text: "每日签到、完成任务，累积积分解锁更多特权。", to: "/tasks", tone: "purple" },
  { icon: UserRoundPen, title: "完善资料", text: "建立完整婚恋档案，让合适的人更容易认识你。", to: "/onboarding", tone: "rose" },
];

type ContentFilters = NonNullable<Parameters<typeof getContent>[0]>;
type ContentState = { items: ContentItem[]; loading: boolean; error: boolean };

function useHomeContent(filters: ContentFilters): ContentState {
  const [state, setState] = useState<ContentState>({ items: [], loading: true, error: false });

  useEffect(() => {
    let active = true;
    setState({ items: [], loading: true, error: false });
    void getContent(filters).then((result) => {
      if (active) setState({ items: result.items, loading: false, error: false });
    }).catch(() => {
      if (active) setState({ items: [], loading: false, error: true });
    });
    return () => { active = false; };
  }, [filters.pageSize, filters.tag, filters.type, filters.upcomingOnly]);

  return state;
}

function ContentStatus({ state, label, emptyLabel, kind = "default" }: { state: ContentState; label: string; emptyLabel: string; kind?: "article" | "calendar" | "star" | "default" }) {
  if (state.loading) return null; // Skeleton handled at page level if needed
  if (state.error) return <EmptyState kind={kind} title={`${label}暂时无法加载`} description="请稍后再试。" />;
  if (!state.items.length) return <EmptyState kind={kind} title={emptyLabel} />;
  return null;
}

function formatShortDate(value: number) {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(value);
}

function formatPublishedAt(value: number | null) {
  if (!value) return "刚刚发布";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(value);
}

export function HomePage() {
  const { members: liveMembers, status: memberStatus, error: memberError, retry } = useMembers();
  const momentState = useHomeContent({ type: "article", tag: "动态", pageSize: 3 });
  const activityState = useHomeContent({ type: "event", upcomingOnly: true, pageSize: 3 });
  const storyState = useHomeContent({ type: "article", tag: "幸福案例", pageSize: 1 });
  const classroomState = useHomeContent({ type: "article", tag: "婚恋课堂", pageSize: 4 });
  const displayedMembers = liveMembers.slice(0, 8);
  const recommendedMembers = displayedMembers.slice(0, 3);
  const activities = activityState.items.filter((item) => item.event);
  const story = storyState.items[0];
  const trustHighlights = [
    { value: "4,300+", label: "已审核真实会员" },
    { value: "92%", label: "资料完成度" },
    { value: "24h", label: "平均沟通响应" },
  ];
  return (
    <MemberInterestProvider><>
      <section className="home-hero" data-page-hero>
        <img
          className="home-hero__image"
          src="/images/hero-v2.jpg"
          alt="两位中年人在公园里轻松交谈的生活场景"
          fetchPriority="high"
        />
        <div className="home-hero__shade" />
        <div className="shell home-hero__content" data-reveal>
          <p className="home-hero__kicker">面向认真交往人群的婚恋联系平台</p>
          <h1>认真认识，安心交往</h1>
          <p>不必急着开场。先看看真实资料，选择你愿意了解的人，再决定下一步。</p>
          <div className="home-hero__actions">
            <Link className="button button--primary button--large" to="/find">寻找合适对象<ArrowRight size={21} /></Link>
            <Link className="button button--light button--large" to="/onboarding">免费加入</Link>
          </div>
          <div className="home-hero__stats" aria-label="平台亮点数据">
            <div><strong>18k+</strong><span>真实会员</span></div>
            <div><strong>92%</strong><span>资料完整度</span></div>
            <div><strong>1:1</strong><span>安全聊天</span></div>
          </div>
          <div className="home-hero__value-strip" aria-label="平台优势">
            <div><strong>真实审核</strong><span>照片与资料均经审核</span></div>
            <div><strong>双方同意</strong><span>先了解再沟通</span></div>
            <div><strong>私密交往</strong><span>聊天与联系方式默认受控</span></div>
          </div>
          <ul className="trust-inline" aria-label="平台保障">
            <li><ShieldCheck />资料审核</li>
            <li><ShieldCheck />隐私保护</li>
            <li><ShieldCheck />双方同意后聊天</li>
          </ul>
        </div>
      </section>

      <section className="search-band" aria-labelledby="quick-search-title">
        <div className="shell">
          <div className="search-band__title">
            <span>从合适的条件开始</span>
            <h2 id="quick-search-title">快速找对象</h2>
          </div>
          <QuickSearch />
        </div>
      </section>

      <section className="section social-proof">
        <div className="shell social-proof__inner">
          <div className="social-proof__lead">
            <span>真实陪伴 · 更安心</span>
            <h2>每一次相遇，都是在真实信息下做决定</h2>
          </div>
          <div className="social-proof__grid">
            {trustHighlights.map((item) => (
              <article key={item.label} className="social-proof__item">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section shell home-members">
        <SectionHeading
          title="看看身边愿意认真认识的人"
          description="只展示审核通过并由本人允许公开的资料。"
          actionLabel="进入匹配大厅"
          actionTo="/find"
        />
        {memberStatus === "loading" ? <SkeletonGrid count={8} /> : null}
        {memberStatus === "error" ? <EmptyState kind="search" title="会员资料暂时无法加载" description={memberError} action={<button className="button button--primary" type="button" onClick={retry}>重新加载</button>} /> : null}
        {memberStatus === "success" && !displayedMembers.length ? <EmptyState kind="members" title="暂时没有公开会员" description="新的审核资料通过后会显示在这里。" /> : null}
        {displayedMembers.length ? <div className="member-grid member-grid--home" data-reveal-group>{displayedMembers.map((member) => <MemberCard key={member.id} member={member} />)}</div> : null}
      </section>

      <section className="section section--tinted">
        <div className="shell">
          <SectionHeading
            title="有共同点，更容易把话聊下去"
            description="推荐只说明对你有帮助的共同点，不公开内部判断过程。"
          />
          {recommendedMembers.length ? <div className="recommendation-rail" data-reveal-group>{recommendedMembers.map((member) => <MemberCard key={member.id} member={member} recommendation="查看资料后，可进入智能牵线了解你们值得继续聊的话题。" />)}</div> : <EmptyState kind="star" title="完成资料后查看智能推荐" description="推荐只显示对认识彼此有帮助的内容。" />}
        </div>
      </section>

      <section className="section daily-pick-band">
        <div className="shell daily-pick-band__inner">
          <div className="daily-pick-band__content">
            <div className="daily-pick-band__badge">
              <Sparkles size={18} />
              <span>每日精选</span>
            </div>
            <h2>今天的 3 位有缘人</h2>
            <p>每天零点更新，系统为你精心挑选。看完可以表示感兴趣，也可以先跳过。</p>
            <Link className="button button--primary" to="/daily-pick">查看今日缘分</Link>
          </div>
          <div className="daily-pick-band__illustration" aria-hidden="true">
            <svg viewBox="0 0 200 160" fill="none">
              <circle cx="100" cy="80" r="70" fill="oklch(0.94 0.04 280)" />
              <circle cx="72" cy="68" r="22" fill="oklch(0.88 0.08 280)" stroke="oklch(0.55 0.16 280)" strokeWidth="2" />
              <circle cx="128" cy="68" r="22" fill="oklch(0.88 0.08 320)" stroke="oklch(0.55 0.16 320)" strokeWidth="2" />
              <path d="M100 100 C80 110 75 120 82 128 C89 135 95 130 100 125 C105 130 111 135 118 128 C125 120 120 110 100 100Z" fill="oklch(0.70 0.18 18)" opacity="0.7" />
              <path d="M60 50 L65 45 L70 50" stroke="oklch(0.55 0.16 280)" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
              <path d="M130 50 L135 45 L140 50" stroke="oklch(0.55 0.16 320)" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
            </svg>
          </div>
        </div>
      </section>

      <section className="section shell">
        <SectionHeading title="常用功能" description="找人、了解对方、查看消息，都可以从这里直接进入。" />
        <div className="service-index" data-reveal-group>
          {services.map(({ icon: Icon, title, text, to, tone }) => (
            <Link className={`service-row service-row--${tone}`} to={to} key={title} data-reveal>
              <span className="service-row__icon"><Icon /></span>
              <span className="service-row__content"><strong>{title}</strong><small>{text}</small></span>
              <ArrowRight className="service-row__arrow" />
            </Link>
          ))}
        </div>
      </section>

      <section className="section section--moments">
        <div className="shell">
          <SectionHeading title="从真实日常，慢慢认识一个人" actionLabel="查看全部动态" actionTo="/moments" />
          <ContentStatus state={momentState} label="生活动态" emptyLabel="暂时没有生活动态" />
          {!momentState.loading && !momentState.error && momentState.items.length ? <div className="moment-cluster">
            {momentState.items.map((moment, index) => (
              <article className={`moment-card moment-card--${index + 1}`} key={moment.id}>
                {moment.coverImageUrl ? <img src={moment.coverImageUrl} alt={`${moment.title}的生活照片`} loading="lazy" /> : null}
                <div><strong>{moment.title}</strong><p>{moment.summary || moment.body}</p><span>{formatPublishedAt(moment.publishedAt)}</span></div>
              </article>
            ))}
          </div> : null}
        </div>
      </section>

      <section className="section shell home-columns">
        <div>
          <SectionHeading title="先在线上了解，再看看线下活动形式" description="日期、地点和剩余名额以活动页面公开信息为准。" actionLabel="查看全部活动" actionTo="/activities" />
          <ContentStatus state={{ ...activityState, items: activities }} label="线下活动" emptyLabel="暂时没有可报名的活动" />
          {!activityState.loading && !activityState.error && activities.length ? <div className="activity-list">
            {activities.map((activity) => (
              <Link to="/activities" className="activity-row" key={activity.id}>
                <time dateTime={new Date(activity.event!.startsAt).toISOString()}>{formatShortDate(activity.event!.startsAt)}</time>
                <span><small>{activity.event!.location}</small><strong>{activity.title}</strong><em>{activity.summary}</em></span>
                <b>{activity.event!.remainingCapacity > 0 ? `剩余 ${activity.event!.remainingCapacity} 个名额` : "名额已满"}</b>
              </Link>
            ))}
          </div> : null}
        </div>
        <aside>
          <ContentStatus state={storyState} label="幸福案例" emptyLabel="暂时没有幸福案例" />
          {!storyState.loading && !storyState.error && story ? <div className="story-feature">
            {story.coverImageUrl ? <img src={story.coverImageUrl} alt={`${story.title}案例配图`} loading="lazy" /> : null}
            <div>
              <span>幸福案例</span>
              <h2>{story.title}</h2>
              <p>{story.summary}</p>
              <Link className="inline-link inline-link--light" to="/stories">阅读案例：{story.title}<ArrowRight size={18} /></Link>
            </div>
          </div> : null}
        </aside>
      </section>

      <section className="section safety-band">
        <div className="shell safety-band__inner">
          <div className="safety-band__lead">
            <ShieldCheck size={44} />
            <div><span>安心交往</span><h2>你的选择和隐私，始终由你决定</h2></div>
          </div>
          <div className="safety-list">
            <span>审核通过的照片才会公开展示</span>
            <span>联系方式默认不公开</span>
            <span>双方同意后才能真人聊天</span>
            <span>随时可以举报、拉黑或结束了解</span>
          </div>
          <Link className="button button--light" to="/safety">进入安全中心</Link>
        </div>
      </section>

      <section className="section shell">
        <SectionHeading title="认真交往，也需要一些实用准备" actionLabel="查看更多文章" actionTo="/classroom" />
        <ContentStatus state={classroomState} label="婚恋课堂" emptyLabel="暂时没有课堂文章" />
        {!classroomState.loading && !classroomState.error && classroomState.items.length ? <div className="article-list">
          {classroomState.items.map((article) => (
            <Link to="/classroom" key={article.id}>
              <span>{article.tags.find((tag) => tag !== "婚恋课堂") ?? "实用文章"}</span>
              <strong>{article.title}</strong>
              <small>{Math.max(2, Math.ceil(article.body.length / 300))} 分钟</small>
              <Newspaper />
            </Link>
          ))}
        </div> : null}
      </section>
    </></MemberInterestProvider>
  );
}
