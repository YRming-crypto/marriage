import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Heart, Mic, MicOff, RotateCcw, Send, Sparkles, Volume2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  ApiError,
  getSoulTestQuestions,
  getMySoulTest,
  submitSoulTest,
  type SoulTestQuestionPayload,
  type SoulTestResultPayload,
} from "../api/client";

/* ─── Speech API types ─────────────────────────────────────────────────── */
interface SpeechRecognitionEvent {
  results: Array<{ 0: { transcript: string } }>;
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

/* ─── Voice chat AI questions ─────────────────────────────────────────── */
const voiceChatQuestions = [
  { dimension: "social", text: "平时你更喜欢一个人待着，还是和朋友在一起？为什么？" },
  { dimension: "expression", text: "当你对一个人有好感时，你会怎么表达？" },
  { dimension: "pace", text: "如果放一周的假，你会怎么安排这段时间？" },
  { dimension: "decision", text: "做一个重要决定时，你更看重什么？" },
  { dimension: "intimacy", text: "你觉得两个人在一起，最重要的是什么？" },
  { dimension: "social", text: "周末的时候，你通常喜欢做什么？" },
  { dimension: "expression", text: "如果对方做了一件让你感动的事，你会怎么做？" },
  { dimension: "pace", text: "旅行时你更喜欢提前做好计划，还是到了再说？" },
];

const dimensionMeta: Record<string, { labelA: string; labelB: string; polarityA: string; polarityB: string; descriptionA: string; descriptionB: string }> = {
  social: { labelA: "外向", labelB: "内向", polarityA: "extrovert", polarityB: "introvert", descriptionA: "你喜欢热闹，善于在社交中获取能量。", descriptionB: "你享受独处，在安静中找到内心的力量。" },
  expression: { labelA: "直接", labelB: "含蓄", polarityA: "direct", polarityB: "reserved", descriptionA: "你习惯坦率表达感受，不喜欢猜来猜去。", descriptionB: "你更习惯用行动代替言语，在细节中传递温度。" },
  pace: { labelA: "随性", labelB: "规律", polarityA: "spontaneous", polarityB: "structured", descriptionA: "你随遇而安，享受生活中的不确定性和惊喜。", descriptionB: "你喜欢井井有条的生活，稳定的节奏让你安心。" },
  decision: { labelA: "感性", labelB: "理性", polarityA: "emotional", polarityB: "rational", descriptionA: "你习惯跟着感觉走，重视内心的体验和共鸣。", descriptionB: "你善于分析和权衡，做决定时更看重逻辑和事实。" },
  intimacy: { labelA: "紧密", labelB: "独立", polarityA: "attached", polarityB: "independent", descriptionA: "你希望和对方紧密联结，一起分享生活的每个角落。", descriptionB: "你重视彼此空间，在相互支持的同时保持独立。" },
};

const personalityTypes = [
  { type: "guardian", label: "温暖守护者", description: "你内心柔软而有力量，习惯用行动照顾身边的人。在关系中，你追求稳定、真诚和安全感。", tags: ["温暖", "可靠", "细心"], matchHint: "适合与懂得表达感激、重视家庭的人在一起。" },
  { type: "explorer", label: "浪漫探索家", description: "你对生活充满好奇，善于发现日常中的美好。在关系中，你追求新鲜感和共同成长。", tags: ["浪漫", "好奇", "感性"], matchHint: "适合与愿意一起尝试新事物、情感表达丰富的人在一起。" },
  { type: "pioneer", label: "稳重行动派", description: "你做事果断、有计划，同时内心有自己的浪漫。在关系中，你追求目标一致和互相支持。", tags: ["果断", "有规划", "务实"], matchHint: "适合与尊重你的节奏、同样认真对待关系的人在一起。" },
  { type: "dreamer", label: "深情理想家", description: "你内心丰富而细腻，对感情有很高的期待。在关系中，你追求精神共鸣和深层理解。", tags: ["细腻", "深情", "理想"], matchHint: "适合与能理解你内心世界、愿意深入交流的人在一起。" },
  { type: "anchor", label: "踏实陪伴者", description: "你重视承诺和陪伴，是关系中稳定的力量。在感情中，你追求细水长流和相互扶持。", tags: ["踏实", "忠诚", "陪伴"], matchHint: "适合与同样重视长期关系、珍惜平淡幸福的人在一起。" },
  { type: "spark", label: "活力感染者", description: "你乐观开朗，能带动身边人的情绪。在关系中，你追求快乐和积极的互动。", tags: ["乐观", "开朗", "活力"], matchHint: "适合与欣赏你的活力、能和你一起笑对生活的人在一起。" },
];

interface ChatMessage {
  id: string;
  sender: "ai" | "user";
  text: string;
  timestamp: number;
}

function analyzeVoiceResponses(messages: ChatMessage[]): SoulTestResultPayload {
  const dimensionScores: Record<string, number> = { social: 50, expression: 50, pace: 50, decision: 50, intimacy: 50 };

  const userMessages = messages.filter((m) => m.sender === "user");

  const keywordScores: Record<string, Record<string, number>> = {
    social: {
      extrovert: ["朋友", "聚会", "一起", "出去", "聊天", "社交", "热闹", "开心", "约", "玩"],
      introvert: ["一个人", "安静", "独处", "在家", "看书", "休息", "独处", "自己", "安静", "舒服"],
    },
    expression: {
      direct: ["直接说", "表达", "告诉", "说出来", "坦诚", "说清楚", "沟通", "说", "表达感受"],
      reserved: ["暗示", "行动", "默默", "做", "不说", "心里", "含蓄", "细节", "用心"],
    },
    pace: {
      spontaneous: ["随意", "看心情", "灵活", "到了再说", "随机", "随性", "自由", "放松"],
      structured: ["计划", "安排", "规律", "固定", "提前", "有条理", "时间表", "准时"],
    },
    decision: {
      emotional: ["感觉", "喜欢", "直觉", "心动", "感受", "开心", "共鸣", "感动"],
      rational: ["分析", "利弊", "理性", "考虑", "实际", "逻辑", "条件", "比较"],
    },
    intimacy: {
      attached: ["一起", "陪伴", "分享", "紧密", "联系", "在一起", "交流", "依赖"],
      independent: ["空间", "独立", "自己", "自由", "各自", "个人", "独处", "尊重"],
    },
  };

  for (const msg of userMessages) {
    const text = msg.text;
    for (const [dimension, keywords] of Object.entries(keywordScores)) {
      const aScore = keywords.extrovert?.filter((kw) => text.includes(kw)).length ?? keywords.direct?.filter((kw) => text.includes(kw)).length ?? keywords.spontaneous?.filter((kw) => text.includes(kw)).length ?? keywords.emotional?.filter((kw) => text.includes(kw)).length ?? keywords.attached?.filter((kw) => text.includes(kw)).length ?? 0;
      const bScore = keywords.introvert?.filter((kw) => text.includes(kw)).length ?? keywords.reserved?.filter((kw) => text.includes(kw)).length ?? keywords.structured?.filter((kw) => text.includes(kw)).length ?? keywords.rational?.filter((kw) => text.includes(kw)).length ?? keywords.independent?.filter((kw) => text.includes(kw)).length ?? 0;

      if (aScore > bScore) dimensionScores[dimension] = Math.min(90, dimensionScores[dimension] + 8);
      else if (bScore > aScore) dimensionScores[dimension] = Math.max(10, dimensionScores[dimension] - 8);
    }
  }

  const dimensions = Object.entries(dimensionMeta).map(([dimension, meta]) => {
    const score = dimensionScores[dimension];
    const isA = score >= 50;
    return {
      dimension,
      dimensionLabel: { social: "社交能量", expression: "情感表达", pace: "生活节奏", decision: "决策风格", intimacy: "亲密模式" }[dimension] ?? dimension,
      labelA: meta.labelA,
      labelB: meta.labelB,
      score,
      polarity: (isA ? meta.polarityA : meta.polarityB) as string,
      description: isA ? meta.descriptionA : meta.descriptionB,
    };
  });

  const polaritySet = new Set(dimensions.map((d) => d.polarity));
  let bestType = personalityTypes[0];
  let bestScore = -1;
  for (const pt of personalityTypes) {
    let score = 0;
    if (pt.type === "guardian" && polaritySet.has("reserved")) score += 3;
    if (pt.type === "guardian" && polaritySet.has("structured")) score += 2;
    if (pt.type === "explorer" && polaritySet.has("spontaneous")) score += 3;
    if (pt.type === "explorer" && polaritySet.has("emotional")) score += 2;
    if (pt.type === "pioneer" && polaritySet.has("extrovert")) score += 2;
    if (pt.type === "pioneer" && polaritySet.has("rational")) score += 2;
    if (pt.type === "pioneer" && polaritySet.has("structured")) score += 2;
    if (pt.type === "dreamer" && polaritySet.has("introvert")) score += 2;
    if (pt.type === "dreamer" && polaritySet.has("emotional")) score += 3;
    if (pt.type === "anchor" && polaritySet.has("reserved")) score += 2;
    if (pt.type === "anchor" && polaritySet.has("structured")) score += 3;
    if (pt.type === "spark" && polaritySet.has("extrovert")) score += 3;
    if (pt.type === "spark" && polaritySet.has("direct")) score += 2;
    if (score > bestScore) { bestScore = score; bestType = pt; }
  }

  return {
    userId: "",
    completedAt: new Date().toISOString(),
    dimensions,
    personalityType: bestType.type,
    personalityLabel: bestType.label,
    personalityDescription: bestType.description,
    tags: [...bestType.tags],
    matchHint: bestType.matchHint,
  };
}

/* ─── Dimension bar (shared) ──────────────────────────────────────────── */
interface DimensionBarProps {
  labelA: string;
  labelB: string;
  score: number;
  dimensionLabel: string;
  index: number;
}

function DimensionBar({ labelA, labelB, score, dimensionLabel, index }: DimensionBarProps) {
  const barScore = Math.max(0, Math.min(100, score));
  const dominantLabel = barScore >= 50 ? labelA : labelB;
  const dominantPercent = barScore >= 50 ? barScore : 100 - barScore;
  const hueBase = 15 + index * 30;
  const colorA = `oklch(0.65 0.16 ${hueBase})`;
  const colorB = `oklch(0.65 0.12 ${hueBase + 140})`;
  const bgA = `oklch(0.92 0.04 ${hueBase})`;
  const bgB = `oklch(0.92 0.04 ${hueBase + 140})`;

  return (
    <div className="soul-result__dimension" data-reveal style={{ "--reveal-delay": `${index * 80}ms` } as React.CSSProperties}>
      <div className="soul-result__dimension-header">
        <span className="soul-result__dimension-name">{dimensionLabel}</span>
        <span className="soul-result__dominant">{dominantLabel} {dominantPercent}%</span>
      </div>
      <div className="soul-result__bar">
        <div className="soul-result__bar-track" style={{ background: bgB }}>
          <div
            className="soul-result__bar-fill"
            style={{ width: `${barScore}%`, background: colorA }}
            role="progressbar"
            aria-valuenow={barScore}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${dimensionLabel} ${labelA} ${barScore}%`}
          />
        </div>
        <div className="soul-result__bar-labels">
          <span style={{ color: colorA }}>{labelA}</span>
          <span style={{ color: colorB }}>{labelB}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Result view ─────────────────────────────────────────────────────── */
function ResultView({ result, onRetake }: { result: SoulTestResultPayload; onRetake: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="soul-result" data-reveal>
      <div className="soul-result__header">
        <div className="soul-result__badge-wrap">
          <div className="soul-result__badge">
            <Sparkles size={20} />
            <span>我的性格画像</span>
          </div>
        </div>
        <h1 className="soul-result__title">
          我是 <span className="soul-result__label">{result.personalityLabel}</span>
        </h1>
        <p className="soul-result__description">{result.personalityDescription}</p>
        <div className="soul-result__tags">
          {result.tags.map((tag) => (
            <span key={tag} className="soul-result__tag">{tag}</span>
          ))}
        </div>
        {result.matchHint ? (
          <div className="soul-result__match-hint" aria-label="匹配提示">
            <Sparkles size={18} aria-hidden="true" />
            <p>{result.matchHint}</p>
          </div>
        ) : null}
      </div>

      <div className="soul-result__dimensions">
        <h2>五个维度的你</h2>
        {result.dimensions.map((dim, index) => (
          <DimensionBar
            key={dim.dimension}
            dimensionLabel={dim.dimensionLabel}
            labelA={dim.labelA}
            labelB={dim.labelB}
            score={dim.score}
            index={index}
          />
        ))}
      </div>

      <div className="soul-result__actions">
        <button className="button button--primary" type="button" onClick={() => navigate("/find")}>
          <Heart size={18} /> 去看看适合我的人
        </button>
        <button className="button button--soft" type="button" onClick={onRetake}>
          <RotateCcw size={18} /> 重新测试
        </button>
      </div>
    </div>
  );
}

/* ─── Voice Chat Mode ─────────────────────────────────────────────────── */
function VoiceChatMode({ onResult }: { onResult: (result: SoulTestResultPayload) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "welcome", sender: "ai", text: "你好！我是你的性格缘分助手。接下来我会和你聊几个轻松的话题，帮助你更好地了解自己。你可以用语音回答，也可以打字。准备好了吗？", timestamp: Date.now() },
  ]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(-1);
  const [inputText, setInputText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const chatSupported = typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  function speakText(text: string) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.9;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }

  function startListening() {
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "zh-CN";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      setInputText(transcript);
      setIsListening(false);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  function askNextQuestion() {
    const nextIndex = currentQuestionIndex + 1;
    if (nextIndex >= voiceChatQuestions.length) {
      finishChat();
      return;
    }
    setCurrentQuestionIndex(nextIndex);
    const question = voiceChatQuestions[nextIndex];
    const aiMsg: ChatMessage = {
      id: `q-${nextIndex}`,
      sender: "ai",
      text: question.text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, aiMsg]);
    speakText(question.text);
  }

  async function sendUserMessage() {
    const text = inputText.trim();
    if (!text) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: "user",
      text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputText("");

    // Short delay then ask next question
    setTimeout(() => {
      askNextQuestion();
    }, 800);
  }

  async function finishChat() {
    if (isSubmitting || isComplete) return;
    setIsSubmitting(true);
    setIsComplete(true);

    const finishingMsg: ChatMessage = {
      id: "finishing",
      sender: "ai",
      text: "好的，我已经了解你了很多。正在为你生成性格画像……",
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, finishingMsg]);
    speakText("好的，我已经了解你了很多。正在为你生成性格画像。");

    // Generate result locally
    const result = analyzeVoiceResponses(messages);

    // Try to submit to server
    try {
      const answerRecord: Record<string, "A" | "B"> = {};
      // Map the chat result to the standard question format for submission
      // We'll use the quiz questions to create a mapping
      const questions = await getSoulTestQuestions();
      for (const q of questions.questions) {
        const dimScore = result.dimensions.find((d) => d.dimension === q.dimension);
        if (dimScore) {
          answerRecord[q.id] = dimScore.score >= 50 ? "A" : "B";
        } else {
          answerRecord[q.id] = "A";
        }
      }
      const res = await submitSoulTest(answerRecord);
      onResult(res.result);
    } catch {
      // If submission fails, use the local result
      onResult(result);
    }
  }

  function handleStartChat() {
    askNextQuestion();
  }

  if (isComplete && isSubmitting) {
    return (
      <div className="voice-chat-container">
        <div className="voice-chat-messages">
          {messages.map((msg) => (
            <div key={msg.id} className={`voice-chat-message voice-chat-message--${msg.sender}`}>
              <div className="voice-chat-message__bubble">
                {msg.sender === "ai" && <div className="voice-chat-message__avatar"><Sparkles size={16} /></div>}
                <p>{msg.text}</p>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
    );
  }

  return (
    <div className="voice-chat-container">
      <div className="voice-chat-header">
        <Sparkles size={20} />
        <div>
          <strong>AI 性格聊天</strong>
          <p>和 AI 聊一聊，让它帮你了解性格画像</p>
        </div>
      </div>

      <div className="voice-chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`voice-chat-message voice-chat-message--${msg.sender}`}>
            <div className="voice-chat-message__bubble">
              {msg.sender === "ai" && <div className="voice-chat-message__avatar"><Sparkles size={16} /></div>}
              <p>{msg.text}</p>
            </div>
          </div>
        ))}
        {isSpeaking && (
          <div className="voice-chat-speaking-indicator">
            <Volume2 size={14} />
            <span>AI 正在说话…</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="voice-chat-input-area">
        {currentQuestionIndex < 0 ? (
          <button className="button button--primary button--block" type="button" onClick={handleStartChat}>
            <Mic size={18} /> 开始聊天
          </button>
        ) : currentQuestionIndex >= voiceChatQuestions.length - 1 && messages.filter((m) => m.sender === "user").length >= voiceChatQuestions.length ? (
          <button className="button button--primary button--block" type="button" onClick={() => void finishChat()} disabled={isSubmitting}>
            {isSubmitting ? "正在生成…" : "生成我的性格画像"}
            <Check size={18} />
          </button>
        ) : (
          <div className="voice-chat-input-row">
            {chatSupported && (
              <button
                className={`voice-chat-mic-button ${isListening ? "is-listening" : ""}`}
                type="button"
                onClick={isListening ? stopListening : startListening}
                aria-label={isListening ? "停止录音" : "开始语音输入"}
              >
                {isListening ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
            )}
            <input
              className="voice-chat-text-input"
              type="text"
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void sendUserMessage(); }}
              placeholder={isListening ? "正在听你说话…" : "输入你的回答，或点击麦克风说话"}
              disabled={isListening}
            />
            <button
              className="button button--primary"
              type="button"
              onClick={() => void sendUserMessage()}
              disabled={!inputText.trim()}
            >
              <Send size={16} />
            </button>
          </div>
        )}
        <div className="voice-chat-progress">
          <span>第 {Math.min(currentQuestionIndex + 1, voiceChatQuestions.length)} / {voiceChatQuestions.length} 个话题</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────────────── */
export function SoulTestPage() {
  const [mode, setMode] = useState<"select" | "quiz" | "voice">("select");
  const [questions, setQuestions] = useState<SoulTestQuestionPayload[]>([]);
  const [answers, setAnswers] = useState<Record<string, "A" | "B">>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SoulTestResultPayload | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [error, setError] = useState("");
  const questionRef = useRef<HTMLDivElement>(null);

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [qRes, myRes] = await Promise.allSettled([getSoulTestQuestions(), getMySoulTest()]);

      if (qRes.status === "rejected") {
        throw qRes.reason;
      }

      setQuestions(qRes.value.questions);

      if (myRes.status === "fulfilled" && myRes.value.completed && myRes.value.result) {
        setResult(myRes.value.result);
        setShowResult(true);
      }

      if (myRes.status === "rejected") {
        const reason = myRes.reason;
        if (!(reason instanceof ApiError && reason.code === "AUTH_REQUIRED")) {
          throw reason;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载题目失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadQuestions(); }, [loadQuestions]);

  const progress = useMemo(() => {
    if (!questions.length) return 0;
    return Math.round((Object.keys(answers).length / questions.length) * 100);
  }, [answers, questions.length]);

  const currentQuestion = questions[currentIndex];
  const allAnswered = Object.keys(answers).length === questions.length;
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;

  function selectOption(questionId: string, option: "A" | "B") {
    setAnswers((prev) => ({ ...prev, [questionId]: option }));
    if (currentIndex < questions.length - 1) {
      setTimeout(() => {
        setCurrentIndex((prev) => Math.min(prev + 1, questions.length - 1));
      }, 350);
    }
  }

  async function handleSubmit() {
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await submitSoulTest(answers);
      setResult(res.result);
      setShowResult(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  function handleRetake() {
    setAnswers({});
    setCurrentIndex(0);
    setResult(null);
    setShowResult(false);
    setMode("select");
  }

  function handleVoiceResult(voiceResult: SoulTestResultPayload) {
    setResult(voiceResult);
    setShowResult(true);
  }

  if (loading) {
    return (
      <div className="page-shell shell">
        <div className="soul-test-loading">
          <div className="soul-test-loading__spinner" />
          <p>正在准备测试…</p>
        </div>
      </div>
    );
  }

  if (error && !questions.length) {
    return (
      <div className="page-shell shell">
        <div className="empty-state-enhanced" role="alert">
          <h2>无法加载测试</h2>
          <p>{error}</p>
          <button className="button button--primary" type="button" onClick={() => void loadQuestions()}>重新加载</button>
        </div>
      </div>
    );
  }

  if (showResult && result) {
    return (
      <div className="page-shell shell">
        <Link to="/" className="soul-test__back-link"><ArrowLeft size={16} /> 返回首页</Link>
        <ResultView result={result} onRetake={handleRetake} />
      </div>
    );
  }

  /* ─── Mode: Voice Chat ────────────────────────────────────────── */
  if (mode === "voice") {
    return (
      <div className="page-shell shell">
        <Link to="/" className="soul-test__back-link"><ArrowLeft size={16} /> 返回首页</Link>
        <VoiceChatMode onResult={handleVoiceResult} />
      </div>
    );
  }

  /* ─── Mode: Quiz ─────────────────────────────────────────────── */
  if (mode === "quiz") {
    return (
      <div className="page-shell shell">
        <Link to="/" className="soul-test__back-link"><ArrowLeft size={16} /> 返回首页</Link>

        <div className="soul-test">
          <div className="soul-test__header">
            <div className="soul-test__badge">
              <Sparkles size={18} />
              <span>性格缘分 · 答题测试</span>
            </div>
            <h1>探索你的性格画像</h1>
            <p>{questions.length} 道趣味小题，帮你了解自己，也让系统为你匹配更合适的人。大约需要 {Math.ceil(questions.length * 0.15)} 分钟。</p>
          </div>

          <div className="soul-test__progress-wrap">
            <div className="soul-test__progress-bar">
              <div className="soul-test__progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="soul-test__progress-meta">
              <span>第 {currentIndex + 1} 题 / 共 {questions.length} 题</span>
              <span>{progress}% 完成</span>
            </div>
          </div>

          {currentQuestion && (
            <div className="soul-test__question" ref={questionRef} key={currentQuestion.id}>
              <span className="soul-test__dimension-tag">{currentQuestion.dimensionLabel}</span>
              <h2 className="soul-test__question-text">{currentQuestion.text}</h2>
              <div className="soul-test__options">
                <button
                  className={`soul-test__option ${currentAnswer === "A" ? "is-selected" : ""}`}
                  type="button"
                  onClick={() => selectOption(currentQuestion.id, "A")}
                  aria-pressed={currentAnswer === "A"}
                >
                  <span className="soul-test__option-letter">A</span>
                  <span className="soul-test__option-text">{currentQuestion.optionA.label}</span>
                </button>
                <button
                  className={`soul-test__option ${currentAnswer === "B" ? "is-selected" : ""}`}
                  type="button"
                  onClick={() => selectOption(currentQuestion.id, "B")}
                  aria-pressed={currentAnswer === "B"}
                >
                  <span className="soul-test__option-letter">B</span>
                  <span className="soul-test__option-text">{currentQuestion.optionB.label}</span>
                </button>
              </div>
            </div>
          )}

          <div className="soul-test__nav">
            <button
              className="button button--text"
              type="button"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
            >
              <ArrowLeft size={16} /> 上一题
            </button>
            {currentIndex < questions.length - 1 ? (
              <button
                className="button button--soft"
                type="button"
                disabled={!currentAnswer}
                onClick={() => setCurrentIndex((prev) => Math.min(prev + 1, questions.length - 1))}
              >
                下一题 <ArrowRight size={16} />
              </button>
            ) : (
              <button
                className="button button--primary"
                type="button"
                disabled={!allAnswered || submitting}
                onClick={() => void handleSubmit()}
              >
                {submitting ? "正在生成结果…" : <><Check size={16} /> 查看我的性格画像</>}
              </button>
            )}
          </div>

          <div className="soul-test__dots" aria-hidden="true">
            {questions.map((q, index) => (
              <button
                key={q.id}
                className={`soul-test__dot ${index === currentIndex ? "is-current" : ""} ${answers[q.id] ? "is-answered" : ""}`}
                type="button"
                onClick={() => setCurrentIndex(index)}
                aria-label={`第 ${index + 1} 题`}
              />
            ))}
          </div>

          {error ? <p className="soul-test__error" role="alert">{error}</p> : null}
        </div>
      </div>
    );
  }

  /* ─── Mode: Select ───────────────────────────────────────────── */
  return (
    <div className="page-shell shell">
      <Link to="/" className="soul-test__back-link"><ArrowLeft size={16} /> 返回首页</Link>

      <div className="soul-test">
        <div className="soul-test__header">
          <div className="soul-test__badge">
            <Sparkles size={18} />
            <span>性格缘分</span>
          </div>
          <h1>探索你的性格画像</h1>
          <p>选择一种方式，了解自己的性格特点，也让系统为你匹配更合适的人。</p>
        </div>

        <div className="soul-test-mode-selector">
          <button className="soul-test-mode-card" type="button" onClick={() => setMode("quiz")}>
            <div className="soul-test-mode-card__icon">
              <Check size={28} />
            </div>
            <div className="soul-test-mode-card__content">
              <strong>答题测试</strong>
              <p>{questions.length} 道趣味选择题，轻松了解自己的五个性格维度。大约需要 {Math.ceil(questions.length * 0.15)} 分钟。</p>
            </div>
            <ArrowRight className="soul-test-mode-card__arrow" />
          </button>

          <button className="soul-test-mode-card soul-test-mode-card--voice" type="button" onClick={() => setMode("voice")}>
            <div className="soul-test-mode-card__icon">
              <Mic size={28} />
            </div>
            <div className="soul-test-mode-card__content">
              <strong>AI 语音聊天</strong>
              <p>和 AI 聊一聊，通过自然的对话了解你的性格画像。支持语音输入和语音朗读。</p>
            </div>
            <ArrowRight className="soul-test-mode-card__arrow" />
          </button>
        </div>

        <p className="soul-test-mode-note">两种方式的结果都会被记录，帮助系统为你匹配更合适的人。</p>
      </div>
    </div>
  );
}
