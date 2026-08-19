import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Heart, RotateCcw, Sparkles } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  ApiError,
  getSoulTestQuestions,
  getMySoulTest,
  submitSoulTest,
  type SoulTestQuestionPayload,
  type SoulTestResultPayload,
} from "../api/client";

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

export function SoulTestPage() {
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
    // Auto-advance after a short delay
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
  }

  if (loading) {
    return (
      <div className="page-shell shell">
        <div className="soul-test-loading">
          <div className="soul-test-loading__spinner" />
          <p>正在准备测试题目…</p>
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

  return (
    <div className="page-shell shell">
      <Link to="/" className="soul-test__back-link"><ArrowLeft size={16} /> 返回首页</Link>

      <div className="soul-test">
        {/* Header */}
        <div className="soul-test__header">
          <div className="soul-test__badge">
            <Sparkles size={18} />
            <span>灵魂测试</span>
          </div>
          <h1>探索你的性格画像</h1>
          <p>{questions.length} 道趣味小题，帮你了解自己，也让系统为你匹配更合适的人。大约需要 3 分钟。</p>
        </div>

        {/* Progress */}
        <div className="soul-test__progress-wrap">
          <div className="soul-test__progress-bar">
            <div className="soul-test__progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="soul-test__progress-meta">
            <span>第 {currentIndex + 1} 题 / 共 {questions.length} 题</span>
            <span>{progress}% 完成</span>
          </div>
        </div>

        {/* Question */}
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

        {/* Navigation */}
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

        {/* Question dots */}
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
