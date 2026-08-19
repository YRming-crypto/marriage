import { useState } from "react";
import { Heart, RotateCcw, SkipForward, Shuffle } from "lucide-react";
import { truthDareQuestions } from "@ai-marriage/shared";

type Level = "safe" | "medium" | "deep";
type Category = "truth" | "dare" | null;

const levelLabels: Record<Level, string> = {
  safe: "轻松",
  medium: "进阶",
  deep: "深入",
};

const levelColors: Record<Level, string> = {
  safe: "oklch(0.55 0.14 150)",
  medium: "oklch(0.55 0.14 40)",
  deep: "oklch(0.55 0.16 18)",
};

function pickRandom<T>(arr: readonly T[], exclude?: T): T {
  const filtered = exclude !== undefined ? arr.filter((x) => x !== exclude) : [...arr];
  return filtered[Math.floor(Math.random() * filtered.length)];
}

export function TruthOrDareGame() {
  const [level, setLevel] = useState<Level>("safe");
  const [choice, setChoice] = useState<Category>(null);
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [showResponse, setShowResponse] = useState(false);

  function pickQuestion(cat: Category) {
    const pool = truthDareQuestions.filter((q) => q.level === level && (cat === null || q.category === cat));
    if (!pool.length) return;
    const q = pickRandom(pool);
    setChoice(cat);
    setCurrentQuestion(q.text);
    setShowResponse(false);
    setHistory((prev) => [q.text, ...prev].slice(0, 5));
  }

  function handleShuffle() {
    pickQuestion(choice);
  }

  function handleReset() {
    setChoice(null);
    setCurrentQuestion(null);
    setHistory([]);
    setShowResponse(false);
  }

  return (
    <div className="game-container game-truth-dare">
      <div className="game-header">
        <Heart size={24} className="game-header__icon" />
        <h2>真心话大冒险</h2>
        <p>选一个难度，选真心话或大冒险，然后轮流回答吧。</p>
      </div>

      <div className="game-level-selector">
        {(Object.keys(levelLabels) as Level[]).map((l) => (
          <button
            key={l}
            className={`game-level-btn ${level === l ? "is-selected" : ""}`}
            type="button"
            style={{ "--level-color": levelColors[l] } as React.CSSProperties}
            onClick={() => { setLevel(l); handleReset(); }}
          >
            {levelLabels[l]}
          </button>
        ))}
      </div>

      {!currentQuestion ? (
        <div className="game-choice">
          <p className="game-choice__prompt">请选择：</p>
          <div className="game-choice__buttons">
            <button className="game-btn game-btn--truth" type="button" onClick={() => pickQuestion("truth")}>
              💬 真心话
            </button>
            <button className="game-btn game-btn--dare" type="button" onClick={() => pickQuestion("dare")}>
              🎯 大冒险
            </button>
            <button className="game-btn game-btn--random" type="button" onClick={() => pickQuestion(null)}>
              🎲 随机
            </button>
          </div>
        </div>
      ) : (
        <div className="game-question-display">
          <div className="game-question-card" data-reveal>
            <span className={`game-question__badge game-question__badge--${choice}`}>
              {choice === "truth" ? "💬 真心话" : "🎯 大冒险"}
            </span>
            <p className="game-question__text">{currentQuestion}</p>
          </div>

          {!showResponse ? (
            <div className="game-question__actions">
              <button className="button button--primary" type="button" onClick={() => setShowResponse(true)}>
                已回答 / 已完成
              </button>
              <button className="button button--text" type="button" onClick={handleShuffle}>
                <Shuffle size={16} /> 换一个
              </button>
            </div>
          ) : (
            <div className="game-response-area">
              <div className="game-response-bubble game-response-bubble--user">
                <span>我：</span>
                <textarea placeholder="写下你的回答..." rows={3} className="game-response-input" />
              </div>
              <div className="game-response-bubble game-response-bubble--opponent">
                <span>对方：</span>
                <textarea placeholder="等对方回答..." rows={3} className="game-response-input" disabled />
              </div>
              <button className="button button--soft" type="button" onClick={handleReset}>
                <RotateCcw size={16} /> 下一题
              </button>
            </div>
          )}
        </div>
      )}

      {history.length > 1 && (
        <div className="game-history">
          <h4>历史记录</h4>
          <ul>
            {history.slice(1).map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
