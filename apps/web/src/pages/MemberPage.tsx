import type { Member } from "@ai-marriage/shared";
import { ArrowLeft, Ban, Bot, Check, ChevronLeft, ChevronRight, Flag, Heart, MapPin, MessageCircleMore, RefreshCw, ShieldAlert, ShieldCheck, Sparkles, ZoomIn } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, blockUser, createInterest, createReport, getInterests, getMe, getMember } from "../api/client";
import { Lightbox } from "../components/Lightbox";
import { VoiceMessage } from "../components/VoiceMessage";

type MemberState =
  | { status: "loading" }
  | { status: "success"; member: Member }
  | { status: "error"; message: string };

type AccountState =
  | { status: "loading" }
  | { status: "profile-ready"; interested: boolean }
  | { status: "onboarding-required" }
  | { status: "signed-out" }
  | { status: "error"; message: string };

export function MemberPage() {
  const { memberId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<MemberState>({ status: "loading" });
  const [accountState, setAccountState] = useState<AccountState>({ status: "loading" });
  const [accountAttempt, setAccountAttempt] = useState(0);
  const [contactBusy, setContactBusy] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [contactMessage, setContactMessage] = useState("");
  const [safetyAction, setSafetyAction] = useState<"report" | "block" | null>(null);
  const [reportReason, setReportReason] = useState("资料虚假");
  const [reportDescription, setReportDescription] = useState("");
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [safetyMessage, setSafetyMessage] = useState("");

  useEffect(() => {
    let active = true;

    if (!memberId) {
      setState({ status: "error", message: "暂时找不到这位用户。" });
      return () => { active = false; };
    }

    setState({ status: "loading" });
    void getMember(memberId)
      .then(({ member }) => {
        if (active) {
          setActivePhotoIndex(0);
          setState({ status: "success", member });
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "会员资料暂时无法加载，请稍后重试。",
        });
      });

    return () => { active = false; };
  }, [memberId]);

  useEffect(() => {
    let active = true;
    setAccountState({ status: "loading" });
    void getMe()
      .then(async ({ profile }) => {
        if (!active) return;
        if (!profile) {
          setAccountState({ status: "onboarding-required" });
          return;
        }
        const interests = await getInterests();
        if (active) {
          setAccountState({
            status: "profile-ready",
            interested: interests.sent.some((interest) => interest.memberId === memberId && interest.status === "active"),
          });
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.code === "AUTH_REQUIRED") {
          setAccountState({ status: "signed-out" });
          return;
        }
        setAccountState({ status: "error", message: error instanceof Error ? error.message : "账号状态暂时无法读取，请稍后重试。" });
      });
    return () => { active = false; };
  }, [accountAttempt, memberId]);

  if (state.status === "loading") {
    return (
      <div className="page-shell shell">
        <div className="empty-state" role="status">
          <h1>正在加载会员资料</h1>
          <p>请稍候，我们正在读取已审核的信息。</p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="page-shell shell">
        <div className="empty-state" role="alert">
          <h1>会员资料暂时无法显示</h1>
          <p>{state.message}</p>
          <Link className="button button--primary" to="/find">返回匹配大厅</Link>
        </div>
      </div>
    );
  }

  const { member } = state;
  const photos = Array.from(new Set([member.photoUrl, ...(member.photoUrls ?? [])].filter(Boolean)));
  const activePhoto = photos[activePhotoIndex] ?? member.photoUrl;
  const hasMultiplePhotos = photos.length > 1;
  const next = encodeURIComponent(`/member/${member.id}`);
  const favoriteOnboardingTarget = `/onboarding?next=${next}&intent=favorite&member=${encodeURIComponent(member.id)}`;
  const chatTarget = `/matchmaking/${member.id}/chat`;
  const chatOnboardingTarget = `/onboarding?next=${encodeURIComponent(chatTarget)}&member=${encodeURIComponent(member.id)}`;

  async function markInterest(continueToChat = false) {
    if (contactBusy) return;
    setContactBusy(true);
    setContactMessage("");
    try {
      await createInterest(member.id);
      setAccountState({ status: "profile-ready", interested: true });
      setContactMessage("已记录感兴趣，接下来可以继续了解 TA。");
      if (continueToChat) navigate(chatTarget);
    } catch (error) {
      setContactMessage(error instanceof Error ? error.message : "暂时无法记录，请稍后重试。");
    } finally {
      setContactBusy(false);
    }
  }

  async function submitReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member.userId || !reportDescription.trim() || safetyBusy) return;
    setSafetyBusy(true);
    setSafetyMessage("");
    try {
      await createReport({ targetUserId: member.userId, reason: reportReason, description: reportDescription.trim() });
      setSafetyMessage("举报已提交，平台会尽快审核处理。");
      setSafetyAction(null);
      setReportDescription("");
    } catch (error) {
      setSafetyMessage(error instanceof Error ? error.message : "举报暂时无法提交，请稍后重试。");
    } finally {
      setSafetyBusy(false);
    }
  }

  async function confirmBlock() {
    if (!member.userId || safetyBusy) return;
    setSafetyBusy(true);
    setSafetyMessage("");
    try {
      await blockUser(member.userId);
      setSafetyMessage("已屏蔽此用户，双方将无法继续聊天。你可以在个人中心解除屏蔽。");
      setSafetyAction(null);
    } catch (error) {
      setSafetyMessage(error instanceof Error ? error.message : "暂时无法屏蔽此用户，请稍后重试。");
    } finally {
      setSafetyBusy(false);
    }
  }

  return (
    <div className="page-shell shell member-detail">
      <Link className="back-link" to="/find"><ArrowLeft />返回匹配大厅</Link>
      {searchParams.get("favorited") === "1" ? (
        <p className="favorite-confirmation" role="status"><Check />已记录感兴趣，接下来可以继续了解 TA</p>
      ) : null}
      <div className="member-detail__grid">
        <div className="member-gallery" data-reveal>
          <div className="member-gallery__stage">
            <button type="button" className="member-gallery__zoom-trigger" onClick={() => setLightboxOpen(true)} aria-label="点击放大查看照片">
              <img src={activePhoto} alt={hasMultiplePhotos ? `${member.nickname}的照片，第 ${activePhotoIndex + 1} 张` : `${member.nickname}的头像`} />
              <span className="member-gallery__zoom-icon"><ZoomIn size={18} /></span>
            </button>
            {member.demo ? <span className="demo-badge">演示资料</span> : member.verified ? <span className="demo-badge">资料已审核</span> : null}
            {hasMultiplePhotos ? <div className="member-gallery__navigation"><button className="icon-button" type="button" aria-label="上一张照片" onClick={() => setActivePhotoIndex((activePhotoIndex - 1 + photos.length) % photos.length)}><ChevronLeft /></button><button className="icon-button" type="button" aria-label="下一张照片" onClick={() => setActivePhotoIndex((activePhotoIndex + 1) % photos.length)}><ChevronRight /></button></div> : null}
          </div>
          {hasMultiplePhotos ? <><p className="member-gallery__counter" aria-live="polite">第 {activePhotoIndex + 1} 张，共 {photos.length} 张</p><div className="member-gallery__thumbnails" aria-label="照片选择">{photos.map((photo, index) => <button className={index === activePhotoIndex ? "is-active" : ""} type="button" aria-label={`查看第 ${index + 1} 张照片`} aria-pressed={index === activePhotoIndex} onClick={() => setActivePhotoIndex(index)} key={photo}><img src={photo} alt="" /></button>)}</div></> : null}
        </div>
        <section className="member-profile" data-reveal>
          <div className="member-profile__title">
            <div><span>{member.activeLabel}</span><h1>{member.nickname}，{member.age} 岁</h1></div>
            {member.verified ? <ShieldCheck aria-label="资料已审核" /> : null}
          </div>
          <p className="member-profile__location"><MapPin />{member.city} · {member.district} · {member.job}</p>
          <dl>
            <div><dt>婚姻状态</dt><dd>{member.maritalStatus}</dd></div>
            <div><dt>交往目标</dt><dd>{member.goal}</dd></div>
          </dl>
          <div className="tag-list tag-list--large">
            {member.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          {member.soulTestResult ? (
            <div className="profile-section profile-section--soul" aria-label="灵魂性格画像">
              <div className="profile-section__header">
                <h2><Sparkles size={20} aria-hidden="true" /> 灵魂性格画像</h2>
                <span className="soul-personality-label">{member.soulTestResult.personalityLabel}</span>
              </div>
              <p className="soul-description">{member.soulTestResult.personalityDescription ?? `TA 的性格关键词：${member.soulTestResult.tags.join("、")}`}</p>
              {member.soulTestResult.tags.length > 0 ? (
                <div className="tag-list">
                  {member.soulTestResult.tags.map((tag) => <span key={tag} className="soul-tag">{tag}</span>)}
                </div>
              ) : null}
              {member.soulTestResult.matchHint ? (
                <p className="soul-match-hint"><Sparkles size={14} aria-hidden="true" /> {member.soulTestResult.matchHint}</p>
              ) : null}
              {member.soulTestResult.dimensions?.length ? (
                <div className="soul-dimensions" aria-label="五维性格雷达">
                  {member.soulTestResult.dimensions.map((dimension) => (
                    <div key={dimension.dimension} className="soul-dimension">
                      <span className="soul-dimension__label">{dimension.labelA}</span>
                      <div className="soul-dimension__bar">
                        <div className="soul-dimension__fill" style={{ width: `${Math.max(4, Math.min(96, dimension.score))}%` }} />
                      </div>
                      <span className="soul-dimension__label">{dimension.labelB}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {member.voiceIntroUrl || member.voiceIntroDuration ? (
            <div className="profile-section profile-section--voice">
              <div className="profile-section__header">
                <h2>语音介绍</h2>
              </div>
              <VoiceMessage
                duration={member.voiceIntroDuration ?? 15}
                transcript={member.voiceIntroTranscript}
                memberName={member.nickname}
              />
            </div>
          ) : null}
          <div className="profile-section"><h2>关于我</h2><p>{member.introduction}</p></div>
          {(member.lifeStory || member.lifeHighlights?.length) ? (
            <div className="profile-section profile-section--story">
              <h2>生活方式</h2>
              {member.lifeStory ? <p>{member.lifeStory}</p> : null}
              {member.lifeHighlights?.length ? (
                <ul className="member-story-highlights">
                  {member.lifeHighlights.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="profile-section profile-section--notice">
            <ShieldAlert />
            <p>平台不会公开手机号、微信或详细地址。线下见面请选择公共场所。</p>
          </div>
          <div className="member-profile__actions" aria-label="联系操作">
            {accountState.status === "profile-ready"
              ? accountState.interested
                ? <button className="button button--soft" type="button" disabled><Check />已感兴趣</button>
                : <button className="button button--soft" type="button" disabled={contactBusy} onClick={() => void markInterest()}><Heart />{contactBusy ? "记录中..." : "感兴趣"}</button>
              : accountState.status === "onboarding-required"
                ? <Link className="button button--soft" to={favoriteOnboardingTarget}><Heart />感兴趣</Link>
                : accountState.status === "signed-out"
                  ? <Link className="button button--soft" to={`/auth?next=${encodeURIComponent(`/member/${member.id}`)}`}><Heart />登录后感兴趣</Link>
                  : <button className="button button--soft" type="button" disabled><Heart />正在检查账号</button>}
            {accountState.status === "profile-ready"
              ? accountState.interested
                ? <Link className="button button--primary" to={chatTarget}><Bot />和 TA 的 AI 分身聊聊</Link>
                : <button className="button button--primary" type="button" disabled={contactBusy} onClick={() => void markInterest(true)}><Bot />{contactBusy ? "正在设置心仪..." : "先设为心仪，再聊 AI 分身"}</button>
              : accountState.status === "onboarding-required"
                ? <Link className="button button--primary" to={chatOnboardingTarget}><Bot />和 TA 的 AI 分身聊聊</Link>
                : accountState.status === "signed-out"
                  ? <Link className="button button--primary" to={`/auth?next=${encodeURIComponent(chatTarget)}`}><Bot />登录后继续了解</Link>
                  : <button className="button button--primary" type="button" disabled><Bot />正在检查账号</button>}
          </div>
          {accountState.status === "error" ? <div className="form-tip" role="alert" aria-label="账号状态读取失败"><ShieldAlert /><span>{accountState.message}</span><button className="button button--text" type="button" onClick={() => setAccountAttempt((attempt) => attempt + 1)}><RefreshCw />重新检查账号</button></div> : null}
          {contactMessage ? <p className="favorite-confirmation" role="status"><Check />{contactMessage}</p> : null}
          <p className="ai-disclosure"><MessageCircleMore />AI 分身根据本人授权的婚恋档案回答，不是本人实时回复。</p>
          <div className="member-safety-actions" aria-label="安全操作">
            <button className="button button--text" type="button" disabled={!member.userId || safetyBusy} onClick={() => setSafetyAction((current) => current === "report" ? null : "report")}><Flag />举报此用户</button>
            <button className="button button--text" type="button" disabled={!member.userId || safetyBusy} onClick={() => setSafetyAction((current) => current === "block" ? null : "block")}><Ban />屏蔽此用户</button>
          </div>
          {safetyAction === "report" ? (
            <form className="member-safety-panel" aria-label="举报用户" onSubmit={(event) => void submitReport(event)}>
              <h2>举报问题</h2>
              <label><span>问题类型</span><select value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option>资料虚假</option><option>骚扰或不尊重</option><option>疑似诈骗</option><option>其他问题</option></select></label>
              <label><span>情况说明</span><textarea aria-label="举报情况说明" value={reportDescription} maxLength={500} onChange={(event) => setReportDescription(event.target.value)} placeholder="请简要说明你遇到的情况" /></label>
              <div><button className="button button--soft" type="button" onClick={() => setSafetyAction(null)}>取消</button><button className="button button--primary" type="submit" disabled={!reportDescription.trim() || safetyBusy}>{safetyBusy ? "提交中..." : "提交举报"}</button></div>
            </form>
          ) : null}
          {safetyAction === "block" ? (
            <section className="member-safety-panel" aria-label="确认屏蔽用户"><h2>确认屏蔽此用户？</h2><p>屏蔽后，双方无法发送真人消息，也不会继续出现在彼此的联系列表中。</p><div><button className="button button--soft" type="button" onClick={() => setSafetyAction(null)}>取消</button><button className="button button--primary" type="button" disabled={safetyBusy} onClick={() => void confirmBlock()}>{safetyBusy ? "处理中..." : "确认屏蔽"}</button></div></section>
          ) : null}
          {safetyMessage ? <p className="favorite-confirmation" role="status"><ShieldCheck />{safetyMessage}</p> : null}
        </section>
      </div>
      {lightboxOpen && <Lightbox images={photos} initialIndex={activePhotoIndex} altPrefix={member.nickname} onClose={() => setLightboxOpen(false)} />}
    </div>
  );
}
