import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Volume2 } from "lucide-react";

interface VoiceMessageProps {
  duration: number;
  transcript?: string | null;
  waveform?: number[];
  memberName?: string;
  variant?: "card" | "inline";
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function generateStaticWaveform(duration: number): number[] {
  const bars = Math.min(40, Math.max(12, Math.floor(duration * 2)));
  // Use a deterministic but varied pattern
  return Array.from({ length: bars }, (_, i) => {
    const base = Math.sin(i * 0.7 + duration * 0.3) * 0.3;
    const noise = Math.sin(i * 2.1 + duration * 1.7) * 0.2;
    return Math.max(0.15, Math.min(0.95, 0.5 + base + noise));
  });
}

export function VoiceMessage({ duration, transcript, waveform, memberName, variant = "card" }: VoiceMessageProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bars = waveform ?? generateStaticWaveform(duration);

  const stopPlayback = useCallback(() => {
    setPlaying(false);
    setProgress(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startPlayback = useCallback(() => {
    if (playing) {
      stopPlayback();
      return;
    }
    setPlaying(true);
    setProgress(0);
    const stepMs = 100;
    const totalSteps = (duration * 1000) / stepMs;
    let step = 0;
    timerRef.current = setInterval(() => {
      step++;
      setProgress(Math.min(1, step / totalSteps));
      if (step >= totalSteps) {
        stopPlayback();
      }
    }, stepMs);
  }, [playing, duration, stopPlayback]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const playedBars = Math.floor(progress * bars.length);

  if (variant === "inline") {
    return (
      <div className="voice-message voice-message--inline">
        <button
          className={`voice-message__play-btn ${playing ? "is-playing" : ""}`}
          type="button"
          onClick={startPlayback}
          aria-label={playing ? "暂停播放" : "播放语音"}
          aria-pressed={playing}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <div className="voice-message__wave-mini" aria-hidden="true">
          {bars.map((height, i) => (
            <div
              key={i}
              className={`voice-message__bar-mini ${i < playedBars ? "is-played" : ""}`}
              style={{ height: `${height * 100}%` }}
            />
          ))}
        </div>
        <span className="voice-message__duration">
          {playing ? formatDuration(duration * (1 - progress)) : formatDuration(duration)}
        </span>
      </div>
    );
  }

  return (
    <div className="voice-message">
      <div className="voice-message__header">
        <div className="voice-message__icon">
          <Mic size={16} />
        </div>
        <span className="voice-message__title">
          {memberName ? `${memberName} 的语音介绍` : "语音介绍"}
        </span>
        <span className="voice-message__duration-badge">
          <Volume2 size={12} />
          {formatDuration(duration)}
        </span>
      </div>

      <div className="voice-message__body">
        <button
          className={`voice-message__play-btn voice-message__play-btn--large ${playing ? "is-playing" : ""}`}
          type="button"
          onClick={startPlayback}
          aria-label={playing ? "暂停播放" : "播放语音介绍"}
          aria-pressed={playing}
        >
          {playing ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <div className="voice-message__wave" aria-hidden="true">
          {bars.map((height, i) => (
            <div
              key={i}
              className={`voice-message__bar ${i < playedBars ? "is-played" : ""}`}
              style={{ height: `${height * 100}%` }}
            />
          ))}
        </div>
      </div>

      <div className="voice-message__footer">
        <span className="voice-message__progress-text">
          {playing ? `正在播放 ${formatDuration(duration * progress)} / ${formatDuration(duration)}` : `共 ${formatDuration(duration)}`}
        </span>
        {transcript && (
          <button
            className="voice-message__transcript-toggle"
            type="button"
            onClick={() => setShowTranscript((prev) => !prev)}
            aria-expanded={showTranscript}
          >
            {showTranscript ? "收起文字版" : "查看文字版"}
          </button>
        )}
      </div>

      {showTranscript && transcript && (
        <div className="voice-message__transcript">
          <p>{transcript}</p>
        </div>
      )}
    </div>
  );
}
