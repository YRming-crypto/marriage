import type { Member } from "@ai-marriage/shared";
import { Heart, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useMemberInterest } from "../features/interests/MemberInterestContext";

interface MemberCardProps {
  member: Member;
  recommendation?: string;
  demo?: boolean;
}

const onboardingErrorCodes = new Set([
  "AUTH_REQUIRED",
  "PROFILE_REQUIRED",
  "ANSWERS_REQUIRED",
  "AVATAR_PROFILE_REQUIRED",
  "ACCOUNT_REVIEW_REQUIRED",
]);

export function MemberCard({ member, recommendation, demo = false }: MemberCardProps) {
  const isDemo = demo || member.demo === true;
  const location = useLocation();
  const navigate = useNavigate();
  const mounted = useRef(true);
  const { busy, liked, toggleInterest } = useMemberInterest(member.id);
  const [favoriteError, setFavoriteError] = useState("");
  const memberPath = `/member/${encodeURIComponent(member.id)}`;
  const favoriteLabel = `${liked ? "取消对" : "对"}${member.nickname}感兴趣`;
  const compatibilityScore = Math.min(99, 78 + ((member.age + member.city.length + member.tags.length) % 18));
  const trustLabel = member.verified ? "真实资料" : "待完善";

  useEffect(() => () => { mounted.current = false; }, []);

  async function handleFavorite() {
    if (busy) return;
    setFavoriteError("");

    try {
      await toggleInterest(member.id);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ApiError && onboardingErrorCodes.has(error.code)) {
        const params = new URLSearchParams({
          next: memberPath,
          source: `${location.pathname}${location.search}`,
          intent: "favorite",
          member: member.id,
        });
        if (error.code === "ACCOUNT_REVIEW_REQUIRED") params.set("step", "photos");
        navigate(`/onboarding?${params}`);
        return;
      }

      setFavoriteError(error instanceof Error ? error.message : "暂时无法记录心仪，请稍后重试。");
    }
  }

  return (
    <article className="member-card" aria-label={`${isDemo ? "演示会员" : "会员"} ${member.nickname}`} data-reveal>
      <Link className="member-card__media" to={memberPath} aria-label={`查看 ${member.nickname} 的资料`}>
        <img src={member.photoUrl} alt={`${member.nickname}的头像`} loading="lazy" />
        {isDemo ? <span className="demo-badge">演示资料</span> : null}
        <span className="active-badge">{member.activeLabel}</span>
      </Link>
      <div className="member-card__body">
        <div className="member-card__meta" aria-label="会员概览">
          <span className="member-card__score">匹配度 {compatibilityScore}%</span>
          <span className="member-card__status">{trustLabel}</span>
        </div>
        <div className="member-card__title">
          <h3>{member.nickname}，{member.age} 岁</h3>
          {member.verified ? <ShieldCheck size={19} aria-label="资料已审核" /> : null}
        </div>
        <p className="member-card__location"><MapPin size={16} />{member.city} · {member.job}</p>
        <p className="member-card__goal">
          <span>{member.maritalStatus} · {member.goal}</span>
          <span className="member-card__pulse">{member.activeLabel}</span>
        </p>
        <div className="tag-list">
          {member.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
        {member.soulTestResult ? (
          <div className="member-card__personality" aria-label="性格画像">
            <span className="member-card__personality-badge">
              <Sparkles size={14} aria-hidden="true" />
              {member.soulTestResult.personalityLabel}
            </span>
            <div className="member-card__personality-tags">
              {member.soulTestResult.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="member-card__personality-tag">{tag}</span>
              ))}
            </div>
          </div>
        ) : null}
        {recommendation ? (
          <div className="member-card__reason-wrap">
            <span className="member-card__reason-label">推荐理由</span>
            <p className="member-card__reason">{recommendation}</p>
          </div>
        ) : null}
        <div className="member-card__actions">
          <Link className="button button--soft button--block" to={memberPath}>查看资料</Link>
          <button
            className={`icon-button member-card__favorite${liked ? " is-saved" : ""}`}
            type="button"
            aria-label={favoriteLabel}
            aria-pressed={liked}
            aria-busy={busy}
            title={liked ? "取消感兴趣" : "感兴趣"}
            disabled={busy}
            onClick={() => void handleFavorite()}
          >
            <Heart fill={liked ? "currentColor" : "none"} />
          </button>
        </div>
        {favoriteError ? <p className="member-card__action-error" role="alert">{favoriteError}</p> : null}
      </div>
    </article>
  );
}
