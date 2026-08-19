import { useState } from "react";
import { ArrowLeft, Gamepad2, Heart, MessageCircle, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { TruthOrDareGame } from "../games/TruthOrDareGame";
import { CompatibilityQuizGame } from "../games/CompatibilityQuizGame";
import { WordChainGame } from "../games/WordChainGame";

type GameId = "truth-dare" | "compatibility-quiz" | "word-chain" | null;

const games = [
  {
    id: "truth-dare" as const,
    title: "真心话大冒险",
    description: "从轻松到深入，用问题拉近距离。三个难度等级，让了解自然发生。",
    icon: Heart,
    color: "rose",
    tags: ["了解对方", "互动感强"],
  },
  {
    id: "compatibility-quiz" as const,
    title: "默契测试",
    description: "同时回答同一问题，看你们的默契度有多高。8 道题，测出隐藏的共同点。",
    icon: Sparkles,
    color: "purple",
    tags: ["趣味测试", "找共同点"],
  },
  {
    id: "word-chain" as const,
    title: "成语接龙",
    description: "用上一个成语的最后一个字接新成语。考验默契和文化底蕴。",
    icon: MessageCircle,
    color: "blue",
    tags: ["文化趣味", "互动性强"],
  },
];

const colorMap: Record<string, { bg: string; fg: string; border: string }> = {
  rose: { bg: "oklch(0.96 0.03 18)", fg: "oklch(0.50 0.16 18)", border: "oklch(0.88 0.06 18)" },
  purple: { bg: "oklch(0.96 0.03 280)", fg: "oklch(0.50 0.14 280)", border: "oklch(0.88 0.05 280)" },
  blue: { bg: "oklch(0.96 0.03 220)", fg: "oklch(0.50 0.14 220)", border: "oklch(0.88 0.05 220)" },
};

export function MiniGamesPage() {
  const [activeGame, setActiveGame] = useState<GameId>(null);

  if (activeGame) {
    return (
      <div className="page-shell shell">
        <button className="soul-test__back-link" type="button" onClick={() => setActiveGame(null)}>
          <ArrowLeft size={16} /> 返回游戏选择
        </button>
        {activeGame === "truth-dare" && <TruthOrDareGame />}
        {activeGame === "compatibility-quiz" && <CompatibilityQuizGame />}
        {activeGame === "word-chain" && <WordChainGame />}
      </div>
    );
  }

  return (
    <div className="page-shell shell">
      <Link to="/" className="soul-test__back-link"><ArrowLeft size={16} /> 返回首页</Link>

      <div className="mini-games">
        <div className="mini-games__header">
          <div className="mini-games__badge">
            <Gamepad2 size={18} />
            <span>破冰小游戏</span>
          </div>
          <h1>聊不下去？来玩个小游戏吧</h1>
          <p>不用刻意找话题，让游戏自然地帮你们打开话匣子。选一个游戏，邀请对方一起玩。</p>
        </div>

        <div className="mini-games__list">
          {games.map((game) => {
            const colors = colorMap[game.color];
            const Icon = game.icon;
            return (
              <button
                key={game.id}
                className="mini-game-card"
                type="button"
                style={{ "--game-bg": colors.bg, "--game-fg": colors.fg, "--game-border": colors.border } as React.CSSProperties}
                onClick={() => setActiveGame(game.id)}
                data-reveal
              >
                <div className="mini-game-card__icon">
                  <Icon size={24} />
                </div>
                <div className="mini-game-card__body">
                  <h3>{game.title}</h3>
                  <p>{game.description}</p>
                  <div className="mini-game-card__tags">
                    {game.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </div>
                <span className="mini-game-card__arrow">开始</span>
              </button>
            );
          })}
        </div>

        <div className="mini-games__tip">
          <p>💡 小提示：这些游戏可以在聊天过程中随时开启，帮助你们更轻松地了解彼此。</p>
        </div>
      </div>
    </div>
  );
}
