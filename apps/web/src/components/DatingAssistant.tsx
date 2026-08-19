import { useEffect, useRef, useState } from "react";
import { Bot, X, Send, Sparkles, Heart, Shield, Lightbulb, MessageCircle } from "lucide-react";

type AdviceCategory = "profile" | "icebreaker" | "safety" | "match";

interface AdviceMessage {
  id: string;
  role: "advisor" | "user";
  text: string;
  category?: AdviceCategory;
  timestamp: number;
}

const quickActions: Array<{ label: string; category: AdviceCategory; prompt: string; icon: React.ElementType }> = [
  { label: "优化资料建议", category: "profile", prompt: "帮我优化个人资料", icon: Lightbulb },
  { label: "破冰话题推荐", category: "icebreaker", prompt: "推荐一些破冰话题", icon: MessageCircle },
  { label: "安全交友提醒", category: "safety", prompt: "有什么安全建议？", icon: Shield },
  { label: "匹配分析", category: "match", prompt: "分析一下我的匹配情况", icon: Heart },
];

function generateAdvice(category: AdviceCategory, _userMessage: string): string {
  const adviceMap: Record<AdviceCategory, string[]> = {
    profile: [
      "你的资料整体不错！建议突出你的兴趣爱好，比如旅行或阅读，这能让对方找到共同话题。\n\n照片方面，建议选择一张清晰的生活照作为主图，展现真实的自己。",
      "在自我介绍中，可以加入一两个具体的生活场景，比如「周末喜欢做家常菜」比「喜欢做饭」更有画面感。\n\n交往目标写得很清楚，这是加分项。",
      "建议在资料中提及你期待的关系模式，比如「希望每周一起运动一次」。具体的期待能帮助匹配到更合适的人。",
    ],
    icebreaker: [
      "初次打招呼可以从对方的资料入手，比如：\n\n「看到你也很喜欢徒步，最近去了哪条路线？」\n\n这种方式既展示你认真看了资料，又自然地开启了话题。",
      "一些好用的破冰话题：\n\n1. 最近看的书或电影\n2. 喜欢的旅行目的地\n3. 周末通常做什么\n4. 美食推荐\n\n避免直接问年龄、收入等敏感问题。",
      "如果对方也喜欢摄影，可以问：「你最近拍过什么满意的照片吗？」\n\n共同的兴趣是最好的破冰利器。记得认真听对方的回答并回应。",
    ],
    safety: [
      "安全交友小贴士：\n\n• 初期不要在资料中公开手机号、住址等隐私信息\n• 线下见面选择公共场所，并告知亲友\n• 不要向未见面的陌生人转账\n• 遇到可疑行为立即举报",
      "识别风险信号：\n\n• 过快表达强烈感情\n• 提及投资或借款\n• 拒绝视频通话\n• 催促线下见面\n\n遇到这些情况请保持警惕，必要时举报。",
      "保护隐私的好方法：\n\n• 使用平台内置聊天，不轻易切换到第三方\n• 照片避免包含家庭地址、车牌等可识别信息\n• 信任自己的直觉，感觉不对劲就暂停联系",
    ],
    match: [
      "根据你的资料和偏好，你的匹配优势在于：\n\n• 目标明确：「认真交往」吸引了同样认真的人\n• 兴趣广泛：容易找到共同话题\n\n建议完善灵魂测试，可以让系统更精准地推荐。",
      "最近的匹配数据：\n\n• 你的资料完整度较高\n• 建议增加更多生活动态，让对方更了解你\n• 主动打招呼的成功率比被动等待高 3 倍",
      "提升匹配率的建议：\n\n1. 每天登录签到，保持活跃度\n2. 完善灵魂测试，让系统更好理解你\n3. 上传更多照片，展示真实的生活\n4. 对推荐的人及时回应，不要错过缘分",
    ],
  };

  const options = adviceMap[category];
  return options[Math.floor(Math.random() * options.length)];
}

export function DatingAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AdviceMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([{
        id: "welcome",
        role: "advisor",
        text: "你好！我是你的 AI 交友顾问 ✨\n\n我可以帮你优化资料、推荐破冰话题、提醒安全注意事项，或者分析你的匹配情况。有什么需要帮助的吗？",
        category: undefined,
        timestamp: Date.now(),
      }]);
    }
  }, [isOpen, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || isTyping) return;

    const userMessage: AdviceMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: text.trim(),
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    // Determine category from keywords
    let category: AdviceCategory = "match";
    const lower = text.toLowerCase();
    if (lower.includes("资料") || lower.includes("优化") || lower.includes("档案")) category = "profile";
    else if (lower.includes("破冰") || lower.includes("话题") || lower.includes("打招呼")) category = "icebreaker";
    else if (lower.includes("安全") || lower.includes("风险") || lower.includes("骗")) category = "safety";

    // Simulate AI thinking
    await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 600));

    const advice: AdviceMessage = {
      id: `advisor-${Date.now()}`,
      role: "advisor",
      text: generateAdvice(category, text),
      category,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, advice]);
    setIsTyping(false);
  }

  function handleQuickAction(action: (typeof quickActions)[number]) {
    void sendMessage(action.prompt);
  }

  return (
    <>
      {/* Floating button */}
      <button
        className="dating-assistant__fab"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? "关闭交友顾问" : "打开 AI 交友顾问"}
        aria-expanded={isOpen}
      >
        {isOpen ? <X aria-hidden="true" /> : <Bot aria-hidden="true" />}
        {!isOpen && <span className="dating-assistant__fab-badge"><Sparkles aria-hidden="true" /></span>}
      </button>

      {/* Dialog */}
      {isOpen && (
        <div className="dating-assistant__dialog" role="dialog" aria-label="AI 交友顾问">
          <div className="dating-assistant__header">
            <Bot aria-hidden="true" />
            <div>
              <strong>AI 交友顾问</strong>
              <span>随时为你提供帮助</span>
            </div>
            <button className="dating-assistant__close" type="button" onClick={() => setIsOpen(false)} aria-label="关闭">
              <X aria-hidden="true" />
            </button>
          </div>

          <div className="dating-assistant__messages">
            {messages.map((msg) => (
              <div key={msg.id} className={`dating-assistant__message dating-assistant__message--${msg.role}`}>
                <div className="dating-assistant__message-bubble">
                  {msg.category && (
                    <span className="dating-assistant__message-category">
                      {msg.category === "profile" && <Lightbulb aria-hidden="true" />}
                      {msg.category === "icebreaker" && <MessageCircle aria-hidden="true" />}
                      {msg.category === "safety" && <Shield aria-hidden="true" />}
                      {msg.category === "match" && <Heart aria-hidden="true" />}
                    </span>
                  )}
                  <p>{msg.text}</p>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="dating-assistant__message dating-assistant__message--advisor">
                <div className="dating-assistant__message-bubble dating-assistant__typing">
                  <span /><span /><span />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick actions */}
          {messages.length <= 1 && (
            <div className="dating-assistant__quick">
              {quickActions.map((action) => (
                <button
                  key={action.category}
                  className="dating-assistant__quick-btn"
                  type="button"
                  onClick={() => handleQuickAction(action)}
                >
                  <action.icon aria-hidden="true" />
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <form className="dating-assistant__input" onSubmit={(event) => { event.preventDefault(); void sendMessage(input); }}>
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="问我任何交友问题..."
              disabled={isTyping}
            />
            <button type="submit" disabled={!input.trim() || isTyping} aria-label="发送">
              <Send aria-hidden="true" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
