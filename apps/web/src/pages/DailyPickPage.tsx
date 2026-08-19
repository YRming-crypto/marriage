import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Heart, MapPin, ShieldCheck, SkipForward, Sparkles, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { getDailyPick, reactDailyPick, type DailyPickMemberPayload, type DailyPickPayload } from "../api/client";

function DailyPickCard({ pick, onReact, reacting }: { pick: DailyPickMemberPayload; onReact: (reaction: "interested" | "skipped") => void; reacting: boolean }) {
  const member = pick.member;
  const memberPath = `/member/${encodeURIComponent(member.id)}`;
  return (
    <article className="daily-pick-card" data-reveal>
      <div className="daily-pick-card__media">
        <Link to={memberPath} aria-label={`查看 ${member.nickname} 的资料`}>
          <img src={member.photoUrl} alt={`${member.nickname}的头像`} loading="lazy" />
        </Link>
        <div className="daily-pick-card__score-badge">
          <Sparkles size={14} />
          <span>匹配度 {pick.score}%</span>
        </div>
      </div>
      <div className="daily-pick-card__body">
        <div className="daily-pick-card__header">
          <h3>{member.nickname}，{member.age} 岁</h3>
          {member.verified ? <ShieldCheck size={18} aria-label="资料已审核" /> : null}
        </div>
        <p className="daily-pick-card__meta">
          <MapPin size={14} /> {member.city} · {member.job}
        </p>
        <p className="daily-pick-card__goal">{member.maritalStatus} · {member.goal}</p>
        <div className="daily-pick-card__reasons">
          {pick.reasons.map((reason, index) => (
            <div className="daily-pick-card__reason" key={index}>
              <span className="daily-pick-card__reason-dot" />
              <span>{reason}</span>
            </div>
          ))}
        </div>
        <div className="daily-pick-card__tags">
          {member.tags.slice(0, 4).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        <div className="daily-pick-card__actions">
          {pick.reaction ? (
            <div className={`daily-pick-card__reacted daily-pick-card__reacted--${pick.reaction}`}>
              {pick.reaction === "interested" ? <><Heart size={16} fill="currentColor" /> 已表示感兴趣</> : <>已跳过</>}
            </div>
          ) : (
            <>
              <button
                className="daily-pick-card__btn daily-pick-card__btn--skip"
                type="button"
                disabled={reacting}
                onClick={() => onReact("skipped")}
              >
                <SkipForward size={16} /> 先跳过
              </button>
              <Link className="daily-pick-card__btn daily-pick-card__btn--view" to={memberPath}>
                查看资料
              </Link>
              <button
                className="daily-pick-card__btn daily-pick-card__btn--like"
                type="button"
                disabled={reacting}
                onClick={() => onReact("interested")}
              >
                <Heart size={16} /> 感兴趣
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export function DailyPickPage() {
  const [pick, setPick] = useState<DailyPickPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reactingId, setReactingId] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadPick = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getDailyPick();
      setPick(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法加载今日推荐");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPick(); }, [loadPick]);

  async function handleReact(memberId: string, reaction: "interested" | "skipped") {
    setReactingId(memberId);
    try {
      await reactDailyPick(memberId, reaction);
      setPick((prev) => prev ? {
        ...prev,
        members: prev.members.map((m) => m.memberId === memberId ? { ...m, reaction } : m),
      } : null);
    } catch (err) {
      // silently fail, user can retry
    } finally {
      setReactingId(null);
    }
  }

  if (loading) {
    return (
      <div className="page-shell shell">
        <div className="soul-test-loading">
          <div className="soul-test-loading__spinner" />
          <p>正在为你挑选今日缘分…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-shell shell">
        <div className="empty-state-enhanced" role="alert">
          <h2>今日推荐暂时无法加载</h2>
          <p>{error}</p>
          <button className="button button--primary" type="button" onClick={() => void loadPick()}>重新加载</button>
        </div>
      </div>
    );
  }

  if (!pick) return null;

  return (
    <div className="page-shell shell">
      <Link to="/" className="soul-test__back-link"><ArrowLeft size={16} /> 返回首页</Link>

      <div className="daily-pick">
        <div className="daily-pick__header">
          <div className="daily-pick__badge">
            <Sparkles size={18} />
            <span>今日缘分</span>
          </div>
          <h1>今天的 3 位有缘人</h1>
          <p>每天零点更新，为你精心挑选。看完可以表示感兴趣，也可以先跳过。</p>
          <div className="daily-pick__date-strip">
            <span>{pick.date}</span>
            <span>明日零点更新</span>
          </div>
        </div>

        <div className="daily-pick__list">
          {pick.members.map((memberPick) => (
            <DailyPickCard
              key={memberPick.memberId}
              pick={memberPick}
              reacting={reactingId === memberPick.memberId}
              onReact={(reaction) => void handleReact(memberPick.memberId, reaction)}
            />
          ))}
        </div>

        <div className="daily-pick__footer">
          <p>今日推荐看完啦，明天零点再来看看吧。</p>
          <button className="button button--soft" type="button" onClick={() => navigate("/find")}>
            去匹配大厅看看更多人
          </button>
        </div>
      </div>
    </div>
  );
}
