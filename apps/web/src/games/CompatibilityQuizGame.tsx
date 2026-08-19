import { useState } from "react";
import { RotateCcw, Sparkles, Zap } from "lucide-react";
import { compatibilityQuestions } from "@ai-marriage/shared";

interface QuizAnswer {
  questionId: string;
  userChoice: number;
  opponentChoice: number | null;
}

export function CompatibilityQuizGame() {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const [userSelection, setUserSelection] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [gamePhase, setGamePhase] = useState<"playing" | "waiting" | "finished">("playing");

  const currentQuestion = compatibilityQuestions[currentQuestionIndex];
  const totalQuestions = compatibilityQuestions.length;
  const progress = Math.round((answers.length / totalQuestions) * 100);

  function handleSelect(optionIndex: number) {
    if (gamePhase !== "playing") return;
    setUserSelection(optionIndex);
    setGamePhase("waiting");

    // Simulate opponent's choice after a short delay
    setTimeout(() => {
      const opponentChoice = Math.floor(Math.random() * currentQuestion.options.length);
      const answer: QuizAnswer = {
        questionId: currentQuestion.id,
        userChoice: optionIndex,
        opponentChoice,
      };
      setAnswers((prev) => [...prev, answer]);

      if (answers.length + 1 >= totalQuestions) {
        setGamePhase("finished");
        setShowResult(true);
      } else {
        setTimeout(() => {
          setCurrentQuestionIndex((prev) => prev + 1);
          setUserSelection(null);
          setGamePhase("playing");
        }, 1200);
      }
    }, 800);
  }

  function handleReset() {
    setCurrentQuestionIndex(0);
    setAnswers([]);
    setUserSelection(null);
    setShowResult(false);
    setGamePhase("playing");
  }

  const compatibilityScore = showResult ? calculateScore(answers) : 0;

  if (showResult) {
    return (
      <div className="game-container game-compatibility">
        <div className="game-header">
          <Sparkles size={24} className="game-header__icon" />
          <h2>默契测试结果</h2>
        </div>

        <div className="compatibility-result" data-reveal>
          <div className="compatibility-result__score" style={{
            "--score-color": compatibilityScore >= 80 ? "oklch(0.55 0.18 150)" :
                            compatibilityScore >= 60 ? "oklch(0.55 0.16 40)" :
                            "oklch(0.55 0.16 18)"
          } as React.CSSProperties}>
            <div className="compatibility-result__number">{compatibilityScore}%</div>
            <div className="compatibility-result__label">
              {compatibilityScore >= 80 ? "默契十足 💕" :
               compatibilityScore >= 60 ? "挺有默契 ✨" :
               compatibilityScore >= 40 ? "还不错 🌱" : "慢慢了解 🌸"}
            </div>
          </div>

          <div className="compatibility-result__details">
            {answers.map((answer, index) => {
              const question = compatibilityQuestions[index];
              const match = answer.userChoice === answer.opponentChoice;
              return (
                <div key={answer.questionId} className={`compatibility-result__item ${match ? "is-match" : ""}`}>
                  <span className="compatibility-result__item-icon">{match ? "✓" : "·"}</span>
                  <div className="compatibility-result__item-content">
                    <strong>{question.text}</strong>
                    <div className="compatibility-result__item-answers">
                      <span>你：{question.options[answer.userChoice]}</span>
                      <span>对方：{question.options[answer.opponentChoice ?? 0]}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button className="button button--soft" type="button" onClick={handleReset}>
            <RotateCcw size={16} /> 再测一次
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="game-container game-compatibility">
      <div className="game-header">
        <Sparkles size={24} className="game-header__icon" />
        <h2>默契测试</h2>
        <p>同时回答同一问题，看看你们有多默契！</p>
      </div>

      <div className="game-progress">
        <div className="game-progress__bar">
          <div className="game-progress__fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="game-progress__text">第 {currentQuestionIndex + 1} 题 / 共 {totalQuestions} 题</span>
      </div>

      {currentQuestion && (
        <div className="compatibility-question" data-reveal key={currentQuestion.id}>
          <h3 className="compatibility-question__text">{currentQuestion.text}</h3>
          <div className="compatibility-question__options">
            {currentQuestion.options.map((option, index) => {
              const isSelected = userSelection === index;
              const lastAnswer = answers[answers.length - 1];
              const isOpponentChoice = gamePhase === "waiting" && lastAnswer?.questionId === currentQuestion.id && lastAnswer.opponentChoice === index;
              return (
                <button
                  key={index}
                  className={`compatibility-option ${isSelected ? "is-selected" : ""} ${isOpponentChoice ? "is-opponent" : ""}`}
                  type="button"
                  disabled={gamePhase === "waiting"}
                  onClick={() => handleSelect(index)}
                >
                  <span className="compatibility-option__letter">{String.fromCharCode(65 + index)}</span>
                  <span className="compatibility-option__text">{option}</span>
                  {isSelected && <span className="compatibility-option__check">你</span>}
                  {isOpponentChoice && <span className="compatibility-option__check is-opponent">对方</span>}
                </button>
              );
            })}
          </div>
          {gamePhase === "waiting" && (
            <div className="compatibility-question__waiting">
              <Zap size={16} /> 等待对方选择...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function calculateScore(answers: QuizAnswer[]): number {
  if (!answers.length) return 0;
  const matches = answers.filter((a) => a.userChoice === a.opponentChoice).length;
  return Math.round((matches / answers.length) * 100);
}
