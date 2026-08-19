import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square, Trash2 } from "lucide-react";

interface VoiceRecorderProps {
  maxDuration?: number;
  onRecordingComplete?: (data: { duration: number; waveform: number[] }) => void;
  onClear?: () => void;
  existingDuration?: number | null;
  label?: string;
}

function generateWaveform(duration: number): number[] {
  const bars = Math.min(40, Math.max(12, Math.floor(duration * 2)));
  return Array.from({ length: bars }, () => 0.2 + Math.random() * 0.8);
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function VoiceRecorder({ maxDuration = 60, onRecordingComplete, onClear, existingDuration, label = "语音介绍" }: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  const hasRecording = existingDuration !== null && existingDuration !== undefined && existingDuration > 0;

  const startRecording = useCallback(() => {
    setRecording(true);
    setPaused(false);
    setDuration(0);
    setWaveform([]);

    timerRef.current = setInterval(() => {
      setDuration((prev) => {
        if (prev + 0.1 >= maxDuration) {
          stopRecording();
          return maxDuration;
        }
        return prev + 0.1;
      });
    }, 100);
  }, [maxDuration]);

  const stopRecording = useCallback(() => {
    setRecording(false);
    setPaused(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const finalDuration = Math.max(1, duration);
    const bars = generateWaveform(finalDuration);
    setWaveform(bars);
    onRecordingComplete?.({ duration: finalDuration, waveform: bars });
  }, [duration, onRecordingComplete]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Live waveform during recording
  useEffect(() => {
    if (!recording) return;
    let frame = 0;
    const drawLiveWaveform = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const barCount = 30;
      const barWidth = width / barCount - 2;

      for (let i = 0; i < barCount; i++) {
        const amplitude = paused ? 0.1 : (0.2 + Math.sin(frame * 0.1 + i * 0.5) * 0.3 + Math.random() * 0.3);
        const barHeight = amplitude * height * 0.8;
        const x = i * (barWidth + 2);
        const y = (height - barHeight) / 2;
        ctx.fillStyle = `oklch(0.60 0.18 ${18 + i * 2})`;
        ctx.fillRect(x, y, barWidth, barHeight);
      }
      frame++;
      animationRef.current = requestAnimationFrame(drawLiveWaveform);
    };
    drawLiveWaveform();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [recording, paused]);

  function handleClear() {
    setDuration(0);
    setWaveform([]);
    setRecording(false);
    setPaused(false);
    onClear?.();
  }

  return (
    <div className="voice-recorder">
      <div className="voice-recorder__label">{label}</div>
      <div className="voice-recorder__panel">
        {!recording && !hasRecording && waveform.length === 0 && (
          <div className="voice-recorder__idle">
            <Mic size={24} />
            <p>点击下方按钮开始录制语音介绍</p>
            <small>最长 {maxDuration} 秒，让对方听到你真实的声音</small>
          </div>
        )}

        {(recording || waveform.length > 0) && (
          <div className="voice-recorder__active">
            <canvas
              ref={canvasRef}
              width={320}
              height={60}
              className={`voice-recorder__canvas ${!recording ? "voice-recorder__canvas--static" : ""}`}
            />
            {!recording && waveform.length > 0 && (
              <StaticWaveform waveform={waveform} />
            )}
          </div>
        )}

        {hasRecording && !recording && waveform.length === 0 && (
          <div className="voice-recorder__existing">
            <Play size={16} />
            <span>语音介绍已录制（{formatDuration(existingDuration!)}）</span>
          </div>
        )}

        <div className="voice-recorder__controls">
          {recording ? (
            <>
              <button
                className="voice-recorder__btn voice-recorder__btn--pause"
                type="button"
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? "继续录制" : "暂停录制"}
              >
                {paused ? <Play size={16} /> : <Pause size={16} />}
              </button>
              <span className="voice-recorder__duration voice-recorder__duration--recording">
                {formatDuration(duration)}
              </span>
              <button
                className="voice-recorder__btn voice-recorder__btn--stop"
                type="button"
                onClick={stopRecording}
                aria-label="停止录制"
              >
                <Square size={16} />
              </button>
            </>
          ) : (
            <>
              <button
                className="voice-recorder__btn voice-recorder__btn--record"
                type="button"
                onClick={startRecording}
                aria-label="开始录制"
              >
                <Mic size={16} />
                {waveform.length > 0 || hasRecording ? "重新录制" : "开始录制"}
              </button>
              {(waveform.length > 0 || hasRecording) && (
                <button
                  className="voice-recorder__btn voice-recorder__btn--clear"
                  type="button"
                  onClick={handleClear}
                  aria-label="清除录音"
                >
                  <Trash2 size={16} />
                </button>
              )}
              {waveform.length > 0 && (
                <span className="voice-recorder__duration">
                  {formatDuration(duration || existingDuration || 0)}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StaticWaveform({ waveform }: { waveform: number[] }) {
  return (
    <div className="voice-recorder__static-wave" aria-hidden="true">
      {waveform.map((height, i) => (
        <div
          key={i}
          className="voice-recorder__static-bar"
          style={{ height: `${height * 100}%` }}
        />
      ))}
    </div>
  );
}
