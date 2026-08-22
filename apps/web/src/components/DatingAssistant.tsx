import { useState } from "react";
import { Bot, Sparkles, Heart, Shield, Lightbulb, MessageCircle } from "lucide-react";

type AdviceCategory = "profile" | "icebreaker" | "safety" | "match";

interface AdviceMessage {
  id: string;
  role: "advisor" | "user";
  text: string;
  category?: AdviceCategory;
  timestamp: number;
}

const quickActions: Array<{ label: string; category: AdviceCategory; prompt: string; icon: React.ElementType }> = [
  { label: "优化资料", category: "profile", prompt: "帮我优化个人资料", icon: Lightbulb },
  { label: "破冰话题", category: "icebreaker", prompt: "推荐一些破冰话题", icon: MessageCircle },
  { label: "安全提醒", category: "safety", prompt: "有什么安全建议？", icon: Shield },
  { label: "匹配分析", category: "match", prompt: "分析一下我的匹配情况", icon: Heart },
];

function generateAdvice(category: AdviceCategory, _userMessage: string): string {
  const adviceMap: Record<AdviceCategory, string[]> = {
    profile: [
      "建议突出兴趣爱好，比如旅行或阅读，让对方找到共同话题。选择一张清晰生活照作为主图。",
      "自我介绍加入具体生活场景，比如「周末喜欢做家常菜」比「喜欢做饭」更有画面感。",
      "提及期待的关系模式，比如「希望每周一起运动一次」，帮助匹配到更合适的人。",
    ],
    icebreaker: [
      "从对方资料入手：「看到你也很喜欢徒步，最近去了哪条路线？」既展示认真又自然开启话题。",
      "好用话题：最近看的书或电影、喜欢的旅行目的地、周末通常做什么、美食推荐。避免直接问敏感问题。",
      "共同兴趣是最好的破冰利器。如果对方也喜欢摄影，可以问：「你最近拍过什么满意的照片吗？」",
    ],
    safety: [
      "初期不要公开手机号、住址等隐私。线下见面选公共场所并告知亲友。不要向未见面的陌生人转账。",
      "警惕风险信号：过快表达强烈感情、提及投资借款、拒绝视频通话、催促线下见面。遇可疑行为立即举报。",
      "使用平台内置聊天，不轻易切换第三方。照片避免包含家庭地址、车牌等可识别信息。信任直觉。",
    ],
    match: [
      "你的匹配优势：目标明确、兴趣广泛。建议完善性格缘分，让系统更精准推荐。",
      "资料完整度较高，建议增加更多生活动态。主动打招呼的成功率比被动等待高 3 倍。",
      "提升匹配率：每天登录签到、完善性格缘分、上传更多照片、对推荐的人及时回应。",
    ],
  };

  const options = adviceMap[category];
  return options[Math.floor(Math.random() * options.length)];
}

export function DatingAssistant() {
  const [advice, setAdvice] = useState<AdviceMessage | null>(null);
  const [isTyping, setIsTyping] = useState(false);

  async function handleQuickAction(action: (typeof quickActions)[number]) {
    setIsTyping(true);
    setAdvice(null);

    // Determine category from prompt
    let category: AdviceCategory = action.category;

    // Simulate AI thinking
    await new Promise((resolve) => setTimeout(resolve, 600 + Math.random() * 400));

    const adviceMsg: AdviceMessage = {
      id: `advisor-${Date.now()}`,
      role: "advisor",
      text: generateAdvice(category, action.prompt),
      category,
      timestamp: Date.now(),
    };
    setAdvice(adviceMsg);
    setIsTyping(false);
  }

  return (
    <div className="dating-assistant-inline">
      <div className="dating-assistant-inline__header">
        <Bot size={16} aria-hidden="true" />
        <strong>AI 交友顾问</strong>
        <Sparkles size={14} aria-hidden="true" />
      </div>

      <div className="dating-assistant-inline__actions">
        {quickActions.map((action) => (
          <button
            key={action.category}
            className="dating-assistant-inline__btn"
            type="button"
            onClick={() => void handleQuickAction(action)}
            disabled={isTyping}
          >
            <action.icon size={14} aria-hidden="true" />
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      {isTyping && (
        <div className="dating-assistant-inline__typing">
          <span /><span /><span />
          <small>正在思考...</small>
        </div>
      )}

      {advice && !isTyping && (
        <div className="dating-assistant-inline__advice">
          <span className="dating-assistant-inline__advice-icon">
            {advice.category === "profile" && <Lightbulb size={14} aria-hidden="true" />}
            {advice.category === "icebreaker" && <MessageCircle size={14} aria-hidden="true" />}
            {advice.category === "safety" && <Shield size={14} aria-hidden="true" />}
            {advice.category === "match" && <Heart size={14} aria-hidden="true" />}
          </span>
          <p>{advice.text}</p>
        </div>
      )}
    </div>
  );
}
