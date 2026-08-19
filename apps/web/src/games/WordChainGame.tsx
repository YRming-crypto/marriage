import { useState } from "react";
import { MessageCircle, RotateCcw, Send } from "lucide-react";
import { wordChainDictionary, type WordChainEntry } from "@ai-marriage/shared";

export function WordChainGame() {
  const [entries, setEntries] = useState<WordChainEntry[]>([
    { id: "start", word: "一心一意", playerId: "user", createdAt: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [isUserTurn, setIsUserTurn] = useState(true);
  const [gameOver, setGameOver] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const lastWord = entries[entries.length - 1]?.word ?? "";
  const lastChar = lastWord ? lastWord[lastWord.length - 1] : "";

  function isValidWord(word: string): boolean {
    if (word.length < 2) return false;
    if (word[0] !== lastChar) return false;
    // Check if word is in dictionary (or accept any 4-char input for demo)
    const inDictionary = wordChainDictionary.includes(word);
    const alreadyUsed = entries.some((e) => e.word === word);
    return !alreadyUsed && (inDictionary || word.length === 4);
  }

  function handleSubmit() {
    if (!input.trim() || !isUserTurn || gameOver) return;
    const word = input.trim();

    if (!lastChar) {
      // First word, any valid word works
      const newEntry: WordChainEntry = {
        id: `u-${Date.now()}`,
        word,
        playerId: "user",
        createdAt: Date.now(),
      };
      setEntries((prev) => [...prev, newEntry]);
      setInput("");
      setIsUserTurn(false);
      setMessage(null);
      simulateOpponent(word);
      return;
    }

    if (word[0] !== lastChar) {
      setMessage(`必须以「${lastChar}」开头`);
      return;
    }

    if (!isValidWord(word)) {
      setMessage("这个词不太合适，换一个吧");
      return;
    }

    const newEntry: WordChainEntry = {
      id: `u-${Date.now()}`,
      word,
      playerId: "user",
      createdAt: Date.now(),
    };
    setEntries((prev) => [...prev, newEntry]);
    setInput("");
    setIsUserTurn(false);
    setMessage(null);
    simulateOpponent(word);
  }

  function simulateOpponent(lastWord: string) {
    // Simulate opponent thinking
    setTimeout(() => {
      const lastCharOfUser = lastWord[lastWord.length - 1];
      const validWords = wordChainDictionary.filter(
        (w) => w[0] === lastCharOfUser && !entries.some((e) => e.word === w)
      );

      if (validWords.length === 0) {
        setGameOver(true);
        setMessage("对方接不上来了，你赢了！🎉");
        return;
      }

      const opponentWord = validWords[Math.floor(Math.random() * validWords.length)];
      const newEntry: WordChainEntry = {
        id: `o-${Date.now()}`,
        word: opponentWord,
        playerId: "opponent",
        createdAt: Date.now(),
      };
      setEntries((prev) => [...prev, newEntry]);
      setIsUserTurn(true);
    }, 1200);
  }

  function handleReset() {
    setEntries([{ id: "start", word: "一心一意", playerId: "user", createdAt: Date.now() }]);
    setInput("");
    setIsUserTurn(true);
    setGameOver(false);
    setMessage(null);
  }

  return (
    <div className="game-container game-word-chain">
      <div className="game-header">
        <MessageCircle size={24} className="game-header__icon" />
        <h2>成语接龙</h2>
        <p>用上一个成语的最后一个字接新成语</p>
      </div>

      <div className="word-chain__current">
        <div className="word-chain__current-word">
          <span className="word-chain__current-label">当前词：</span>
          <span className="word-chain__current-text">{lastWord}</span>
        </div>
        <div className="word-chain__current-hint">
          下一个词需要以「<strong>{lastChar || "?"}</strong>」开头
        </div>
      </div>

      <div className="word-chain__history">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`word-chain__entry word-chain__entry--${entry.playerId}`}
          >
            <span className="word-chain__entry-player">
              {entry.playerId === "user" ? "我" : "对方"}
            </span>
            <span className="word-chain__entry-word">{entry.word}</span>
          </div>
        ))}
      </div>

      {gameOver ? (
        <div className="word-chain__game-over">
          <p>{message ?? "游戏结束！"}</p>
          <button className="button button--soft" type="button" onClick={handleReset}>
            <RotateCcw size={16} /> 重新开始
          </button>
        </div>
      ) : (
        <div className="word-chain__input-area">
          {message && <p className="word-chain__message">{message}</p>}
          <div className="word-chain__input-row">
            <input
              className="word-chain__input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder={isUserTurn ? "输入成语..." : "对方正在思考..."}
              disabled={!isUserTurn}
              maxLength={8}
            />
            <button
              className="button button--primary"
              type="button"
              onClick={handleSubmit}
              disabled={!isUserTurn || !input.trim()}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="word-chain__stats">
        <span>已接 {entries.length - 1} 个词</span>
        <span>你：{entries.filter((e) => e.playerId === "user").length - 1} 个</span>
        <span>对方：{entries.filter((e) => e.playerId === "opponent").length} 个</span>
      </div>
    </div>
  );
}
