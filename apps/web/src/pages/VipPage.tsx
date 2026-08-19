import { useEffect, useState } from "react";
import { Check, Crown, Gift, Heart, MessageCircle, Shield, Sparkles, Star, Zap } from "lucide-react";
import { getMyVip, subscribeVip } from "../api/client";

type VipPlan = {
  id: string;
  label: string;
  durationDays: number;
  price: number;
  pointsCost: number | null;
  features: string[];
};

const vipPerks = [
  { icon: Crown, title: "专属金色标识", description: "在个人资料和消息中展示 VIP 金色徽章" },
  { icon: Heart, title: "超级喜欢", description: "每天 3 次超级喜欢，对方优先看到你" },
  { icon: Eye, title: "查看谁喜欢了我", description: "查看所有对你感兴趣的人" },
  { icon: MessageCircle, title: "消息已读回执", description: "查看消息是否已读，沟通更安心" },
  { icon: Shield, title: "优先客服通道", description: "专属客服，问题快速解决" },
  { icon: Sparkles, title: "AI 顾问深度分析", description: "定期匹配分析和交友建议" },
];

function Eye(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}

export function VipPage() {
  const [loading, setLoading] = useState(true);
  const [vip, setVip] = useState<{ tier: string; isActive: boolean; expiresAt: string | null; superLikesRemaining: number; superLikesTotal: number } | null>(null);
  const [plans, setPlans] = useState<VipPlan[]>([]);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getMyVip()
      .then((result) => {
        if (!active) return;
        setVip(result.data.vip);
        setPlans(result.data.plans);
      })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function handleSubscribe(planId: string) {
    if (subscribing) return;
    setSubscribing(planId);
    setMessage(null);
    try {
      const result = await subscribeVip(planId);
      setVip(result.data.vip);
      setMessage(`恭喜！你已成为 ${result.data.plan.label}，有效期至 ${formatDate(result.data.vip.expiresAt)}`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "开通失败，请稍后重试");
    } finally {
      setSubscribing(null);
    }
  }

  if (loading) {
    return (
      <div className="page-shell shell">
        <div className="vip-loading" role="status">正在加载会员信息…</div>
      </div>
    );
  }

  const isActive = vip?.isActive ?? false;

  return (
    <div className="page-shell shell">
      <header className="page-header">
        <span>VIP 会员</span>
        <h1>认真交往，值得更好的体验</h1>
        <p>解锁专属特权，让缘分来得更快更稳。</p>
      </header>

      {message && (
        <div className="vip-message" role="status">{message}</div>
      )}

      {/* Current VIP status */}
      {isActive && vip && (
        <section className="vip-status-card" aria-label="当前会员状态">
          <div className="vip-status-card__icon"><Crown /></div>
          <div className="vip-status-card__info">
            <strong>当前会员：{vip.tier === "monthly" ? "月度会员" : vip.tier === "quarterly" ? "季度会员" : "年度会员"}</strong>
            <span>有效期至 {vip.expiresAt ? formatDate(vip.expiresAt) : "—"}</span>
          </div>
          <div className="vip-status-card__stats">
            <div>
              <strong>{vip.superLikesRemaining}</strong>
              <span>超级喜欢剩余</span>
            </div>
          </div>
        </section>
      )}

      {/* VIP Perks */}
      <section className="vip-perks" aria-label="VIP 特权">
        <h2>VIP 专属特权</h2>
        <div className="vip-perks__grid">
          {vipPerks.map((perk) => (
            <div key={perk.title} className="vip-perk">
              <perk.icon aria-hidden="true" />
              <div>
                <strong>{perk.title}</strong>
                <p>{perk.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing Plans */}
      <section className="vip-plans" aria-label="会员方案">
        <h2>选择适合你的方案</h2>
        <div className="vip-plans__grid">
          {plans.map((plan) => (
            <div key={plan.id} className={`vip-plan-card${plan.id === "quarterly" ? " is-recommended" : ""}`}>
              {plan.id === "quarterly" && <span className="vip-plan-card__badge">推荐</span>}
              <h3>{plan.label}</h3>
              <div className="vip-plan-card__price">
                <strong>¥{plan.price}</strong>
                <span>/{plan.durationDays} 天</span>
              </div>
              <ul className="vip-plan-card__features">
                {plan.features.map((feature) => (
                  <li key={feature}><Check aria-hidden="true" />{feature}</li>
                ))}
              </ul>
              <button
                className={`button ${isActive ? "button--secondary" : "button--primary"} button--block`}
                type="button"
                disabled={subscribing !== null}
                onClick={() => void handleSubscribe(plan.id)}
              >
                {subscribing === plan.id ? "处理中..." : isActive ? "续费 / 升级" : "立即开通"}
              </button>
              {plan.pointsCost && (
                <p className="vip-plan-card__points">
                  <Zap aria-hidden="true" />
                  或使用 {plan.pointsCost} 积分兑换
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="vip-faq" aria-label="常见问题">
        <h2>常见问题</h2>
        <details>
          <summary>VIP 可以退款吗？</summary>
          <p>目前为模拟支付环境，暂不支持退款。正式上线后将按相关法规处理。</p>
        </details>
        <details>
          <summary>超级喜欢有什么用？</summary>
          <p>超级喜欢会让对方在推荐列表中优先看到你，增加被注意到的机会。每天零点刷新次数。</p>
        </details>
        <details>
          <summary>积分可以兑换 VIP 吗？</summary>
          <p>可以。在任务中心累积积分后，可以在会员方案页面使用积分兑换对应天数的 VIP。</p>
        </details>
        <details>
          <summary>会员到期后数据会丢失吗？</summary>
          <p>不会。会员到期后你的资料和聊天记录都会保留，只是 VIP 特权会暂停。重新开通后立即恢复。</p>
        </details>
      </section>
    </div>
  );
}
