import type {
  AvatarProfile,
  AvatarProfileStatus,
  BlockListItem,
  Photo,
  ProfileStatus,
  UserStatus,
} from "@ai-marriage/shared";
import {
  ArrowRight,
  Bot,
  Camera,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Crown,
  HeartHandshake,
  LoaderCircle,
  LockKeyhole,
  MessageCircleMore,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRoundPen,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  getAvatarProfile,
  getBlocks,
  getMe,
  getMyPhotos,
  unblockUser,
  type GetMeResponse,
  type MyProfile,
} from "../api/client";
import "./MePage.css";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { VideoUploader } from "../components/VideoUploader";
import { deleteVideoIntro, getMyVideoIntro, uploadVideoIntro } from "../api/client";

interface AccountCenterData {
  account: GetMeResponse;
  photos: Photo[];
  avatarProfile: AvatarProfile | null;
  blocks: BlockListItem[];
}

interface AccountCenterSectionErrors {
  photos: string;
  avatarProfile: string;
  blocks: string;
}

const emptySectionErrors: AccountCenterSectionErrors = {
  photos: "",
  avatarProfile: "",
  blocks: "",
};

const profileStatusText: Record<ProfileStatus, string> = {
  draft: "资料尚未提交",
  pending_review: "资料审核中",
  approved: "资料审核通过",
  rejected: "资料需要修改",
};

const avatarStatusText: Record<AvatarProfileStatus, string> = {
  pending: "AI 分身等待本人确认",
  enabled: "AI 分身已启用",
  paused: "AI 分身已暂停",
  revoked: "AI 分身授权已撤销",
};

const accountStatusText: Record<UserStatus, string> = {
  active: "账户正常使用",
  suspended: "账户已暂停使用",
  deleted: "账户已注销",
};

const profileFields: Array<keyof Pick<MyProfile,
  "nickname" | "gender" | "birthYear" | "city" | "district" | "job" | "maritalStatus" | "goal" | "introduction"
>> = ["nickname", "gender", "birthYear", "city", "district", "job", "maritalStatus", "goal", "introduction"];

function hasValue(value: unknown) {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return value !== null && value !== undefined;
}

function profileCompletion(profile: MyProfile | null) {
  if (!profile) return 0;
  const checks = [
    ...profileFields.map((field) => hasValue(profile[field])),
    Object.values(profile.preference).some(hasValue),
    Object.values(profile.answers).some(hasValue),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message : "账户服务暂时无法连接，请稍后重试。";
}

export function MePage() {
  const [data, setData] = useState<AccountCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<string>();
  const [errorText, setErrorText] = useState("");
  const [sectionErrors, setSectionErrors] = useState<AccountCenterSectionErrors>(emptySectionErrors);
  const [unblockingId, setUnblockingId] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const loadAccountCenter = useCallback(async () => {
    setLoading(true);
    setErrorCode(undefined);
    setErrorText("");
    setSectionErrors(emptySectionErrors);
    setData(null);
    try {
      const [accountResult, photoResult, avatarResult, blockResult] = await Promise.allSettled([
        getMe(),
        getMyPhotos(),
        getAvatarProfile(),
        getBlocks(),
      ]);
      if (accountResult.status === "rejected") throw accountResult.reason;

      setSectionErrors({
        photos: photoResult.status === "rejected" ? errorMessage(photoResult.reason) : "",
        avatarProfile: avatarResult.status === "rejected" ? errorMessage(avatarResult.reason) : "",
        blocks: blockResult.status === "rejected" ? errorMessage(blockResult.reason) : "",
      });
      setData({
        account: accountResult.value,
        photos: photoResult.status === "fulfilled" ? photoResult.value.items : [],
        avatarProfile: avatarResult.status === "fulfilled" ? avatarResult.value.avatarProfile : null,
        blocks: blockResult.status === "fulfilled" ? blockResult.value.items : [],
      });
    } catch (error) {
      setErrorCode(error instanceof ApiError ? error.code : undefined);
      setErrorText(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccountCenter();
  }, [loadAccountCenter]);

  const photoSummary = useMemo(() => {
    const photos = data?.photos ?? [];
    return {
      approved: photos.filter((photo) => photo.reviewStatus === "approved").length,
      pending: photos.filter((photo) => photo.reviewStatus === "pending").length,
      rejected: photos.filter((photo) => photo.reviewStatus === "rejected").length,
    };
  }, [data?.photos]);

  async function handleUnblock(item: BlockListItem) {
    const name = item.member?.nickname ?? "该用户";
    setUnblockingId(item.blockedUserId);
    setActionMessage("");
    try {
      await unblockUser(item.blockedUserId);
      setData((current) => current ? {
        ...current,
        blocks: current.blocks.filter((block) => block.blockedUserId !== item.blockedUserId),
      } : current);
      setActionMessage(`已解除对${name}的屏蔽`);
    } catch (error) {
      setActionMessage(`解除屏蔽失败：${errorMessage(error)}`);
    } finally {
      setUnblockingId("");
    }
  }

  if (loading) {
    return (
      <div className="page-shell shell me-page">
        <div className="empty-state" role="status">
          <LoaderCircle className="me-page__spinner" />
          <h1>正在读取账户信息</h1>
          <p>正在同步你的资料、照片和 AI 分身状态，请稍候。</p>
        </div>
      </div>
    );
  }

  if (errorText) {
    const signedOut = errorCode === "AUTH_REQUIRED";
    return (
      <div className="page-shell shell me-page">
        <div className="empty-state me-page__error" role="alert">
          <CircleAlert />
          <h1>{signedOut ? "请先登录后查看账户中心" : "账户信息读取失败"}</h1>
          <p>{errorText}</p>
          {signedOut
            ? <Link className="button button--primary button--large" to="/auth">去登录</Link>
            : <button className="button button--primary button--large" type="button" onClick={() => void loadAccountCenter()}><RefreshCw />重新加载</button>}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { account, photos, avatarProfile, blocks } = data;
  const profile = account.profile;
  const completion = profileCompletion(profile);
  const displayName = profile?.nickname ? `${profile.nickname}的账户中心` : "我的账户中心";
  const profileReviewText = profile ? profileStatusText[profile.profileStatus] : "尚未建立婚恋资料";
  const avatarText = avatarProfile ? avatarStatusText[avatarProfile.status] : "尚未生成 AI 分身";

  return (
    <div className="page-shell shell me-page">
      <header className="page-header me-page__header">
        <span>我的</span>
        <h1>{displayName}</h1>
        <p>在这里查看真实账户状态，并管理婚恋资料、照片、AI 分身和联系权限。</p>
        <div className="me-page__identity" aria-label="账户信息">
          <span><ShieldCheck />{accountStatusText[account.user.status]}</span>
          <span>登录手机：<strong>{account.user.phoneMasked}</strong></span>
        </div>
      </header>

      <section className="me-progress" aria-labelledby="profile-completion-heading">
        <div>
          <span>婚恋资料完成度</span>
          <strong id="profile-completion-heading">{completion}%</strong>
        </div>
        <div className="me-progress__details">
          <div className="progress-track" role="progressbar" aria-label="婚恋资料完成度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}>
            <span style={{ width: `${completion}%` }} />
          </div>
          <p>{completion === 100 ? "已填写全部主要资料，可以继续关注审核和照片状态。" : "资料越完整，越容易让合适的人认真了解你。"}</p>
        </div>
        <Link className="button button--light button--large" to="/onboarding"><UserRoundPen />{profile ? "检查并完善资料" : "开始建立资料"}</Link>
      </section>

      <section className="me-status-section" aria-labelledby="account-status-heading">
        <div className="me-section-heading">
          <span>当前进度</span>
          <h2 id="account-status-heading">账户状态一目了然</h2>
        </div>
        <div className="me-status-grid">
          <article>
            <span className="me-status-grid__icon"><ClipboardCheck /></span>
            <div><small>婚恋资料</small><h3>{profileReviewText}</h3><p>{profile ? `资料完成度 ${completion}%` : "完善资料后可提交审核"}</p></div>
          </article>
          <article>
            <span className="me-status-grid__icon"><Camera /></span>
            <div><small>我的照片</small><h3>{sectionErrors.photos ? "照片状态暂不可用" : `共 ${photos.length} 张照片`}</h3>{sectionErrors.photos ? <p role="alert" aria-label="照片状态读取失败">{sectionErrors.photos}</p> : <p>{photoSummary.approved} 张通过，{photoSummary.pending} 张审核中，{photoSummary.rejected} 张需调整</p>}</div>
          </article>
          <article>
            <span className="me-status-grid__icon"><Bot /></span>
            <div><small>AI 分身</small><h3>{sectionErrors.avatarProfile ? "AI 分身状态暂不可用" : avatarText}</h3>{sectionErrors.avatarProfile ? <p role="alert" aria-label="AI 分身状态读取失败">{sectionErrors.avatarProfile}</p> : <p>{avatarProfile ? `当前版本 ${avatarProfile.version}` : "完成关系问答后可以生成"}</p>}</div>
          </article>
        </div>
      </section>

      <section className="me-actions" aria-labelledby="account-actions-heading">
        <div className="me-section-heading">
          <span>常用功能</span>
          <h2 id="account-actions-heading">你想先做什么</h2>
        </div>
        <div className="me-actions__grid">
          <Link to="/onboarding"><UserRoundPen /><span><strong>完善婚恋资料</strong><small>更新基本资料和交往期待</small></span><ArrowRight /></Link>
          <Link to="/onboarding"><Camera /><span><strong>管理照片与建档</strong><small>上传照片并查看审核结果</small></span><ArrowRight /></Link>
          <Link to="/me/avatar"><Bot /><span><strong>管理 AI 分身</strong><small>确认、暂停或撤销授权</small></span><ArrowRight /></Link>
          <Link to="/messages"><MessageCircleMore /><span><strong>查看消息</strong><small>处理申请和真人聊天</small></span><ArrowRight /></Link>
          <Link to="/me/security"><ShieldCheck /><span><strong>账号与安全</strong><small>管理隐私、设备、申诉和数据</small></span><ArrowRight /></Link>
          <Link to="/matchmaking"><HeartHandshake /><span><strong>进入匹配大厅</strong><small>查看适合认真了解的会员</small></span><ArrowRight /></Link>
          <Link to="/soul-test"><Sparkles /><span><strong>性格缘分</strong><small>探索性格画像，匹配更合适的人</small></span><ArrowRight /></Link>
          <Link to="/tasks"><Trophy /><span><strong>任务中心</strong><small>每日签到、完成任务、累积积分</small></span><ArrowRight /></Link>
          <Link to="/vip"><Crown /><span><strong>VIP 会员</strong><small>解锁专属特权，让缘分更快到来</small></span><ArrowRight /></Link>
          {account.user.role === "admin" ? <Link to="/admin/review"><ClipboardCheck /><span><strong>管理员审核</strong><small>处理审核、安全与运营事项</small></span><ArrowRight /></Link> : null}
          {account.user.role === "moderator" ? <Link to="/admin/review"><ClipboardCheck /><span><strong>进入审核后台</strong><small>处理资料、照片和举报</small></span><ArrowRight /></Link> : null}
        </div>
      </section>

      <section className="me-voice" aria-labelledby="voice-intro-heading">
        <div className="me-section-heading">
          <span>声音名片</span>
          <h2 id="voice-intro-heading">录制语音介绍</h2>
        </div>
        <p className="me-voice__intro">让对方听到你真实的声音，更容易建立信任。录制一段 15-60 秒的自我介绍吧。</p>
        <VoiceRecorder maxDuration={60} label="我的语音介绍" />
      </section>

      <section className="me-video" aria-labelledby="video-intro-heading">
        <div className="me-section-heading">
          <span>视频名片</span>
          <h2 id="video-intro-heading">录制视频介绍</h2>
        </div>
        <p className="me-video__intro">一段 10-90 秒的视频，让对方更直观地感受你的真诚。</p>
        <VideoUploader
          onUpload={async (dataUrl, filename, duration) => {
            await uploadVideoIntro(dataUrl, filename, duration);
          }}
          onDelete={async () => {
            await deleteVideoIntro();
          }}
        />
      </section>

      <section className="me-blocks" aria-labelledby="block-list-heading">
        <div className="me-section-heading me-section-heading--row">
          <div><span>联系与隐私</span><h2 id="block-list-heading">我的黑名单</h2></div>
          <LockKeyhole />
        </div>
        <p className="me-blocks__intro">黑名单中的用户不能继续与你联系。解除后，对方将重新出现在可联系范围内。</p>
        {sectionErrors.blocks ? <p className="form-tip" role="alert" aria-label="黑名单读取失败">{sectionErrors.blocks}</p> : null}
        {!sectionErrors.blocks && blocks.length === 0 ? <div className="me-blocks__empty"><CheckCircle2 /><span><strong>黑名单中暂无用户</strong><small>需要时，你可以在会员资料或聊天页面屏蔽对方。</small></span></div> : null}
        {!sectionErrors.blocks && blocks.length > 0 ? <ul>
          {blocks.map((item) => {
            const name = item.member?.nickname ?? `用户 ${item.blockedUserId.slice(-6)}`;
            return <li key={item.id}>
              {item.member?.photoUrl ? <img src={item.member.photoUrl} alt={`${name}的头像`} /> : <span className="me-blocks__placeholder" aria-hidden="true"><LockKeyhole /></span>}
              <span><strong>{name}</strong><small>{item.member ? `${item.member.city} · ${item.member.age} 岁` : "该用户的公开资料当前不可见"}</small></span>
              <button className="button button--soft button--large" type="button" disabled={unblockingId === item.blockedUserId} aria-label={`解除对${name}的屏蔽`} onClick={() => void handleUnblock(item)}>{unblockingId === item.blockedUserId ? "正在解除..." : "解除屏蔽"}</button>
            </li>;
          })}
        </ul> : null}
        {actionMessage ? <p className="form-tip" role="status">{actionMessage}</p> : null}
      </section>
    </div>
  );
}
