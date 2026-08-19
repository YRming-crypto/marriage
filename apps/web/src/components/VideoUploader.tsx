import { useRef, useState } from "react";
import { Upload, X, Play, AlertCircle } from "lucide-react";

export function VideoUploader({
  onUpload,
  onDelete,
  existingVideo,
}: {
  onUpload: (dataUrl: string, filename: string, durationSeconds: number) => Promise<void>;
  onDelete: () => Promise<void>;
  existingVideo?: { url: string; durationSeconds: number; reviewStatus: string } | null;
}) {
  const [preview, setPreview] = useState<string | null>(existingVideo?.url ?? null);
  const [duration, setDuration] = useState<number>(existingVideo?.durationSeconds ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setMessage(null);

    // Validate
    if (!file.type.startsWith("video/")) {
      setError("请选择视频文件（支持 MP4、WebM 等格式）");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("视频大小不能超过 20MB");
      return;
    }

    // Read as data URL for preview
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);

      // Get duration
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const dur = Math.round(video.duration);
        setDuration(dur);
        if (dur < 10 || dur > 90) {
          setError("视频时长需在 10-90 秒之间");
          setPreview(null);
          return;
        }
        URL.revokeObjectURL(video.src);
      };
      video.src = dataUrl;
    };
    reader.onerror = () => setError("视频读取失败");
    reader.readAsDataURL(file);
  }

  async function handleUpload() {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onUpload(preview, "video.webm", duration);
      setMessage("视频已上传，等待审核中…");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      setPreview(null);
      setDuration(0);
      setMessage("视频已删除");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="video-uploader">
      {preview ? (
        <div className="video-uploader__preview">
          <video ref={videoRef} src={preview} controls className="video-uploader__video">
            <track kind="captions" />
          </video>
          <div className="video-uploader__info">
            <span>时长：{duration} 秒</span>
            {existingVideo?.reviewStatus === "pending" && (
              <span className="video-uploader__status video-uploader__status--pending">审核中</span>
            )}
            {existingVideo?.reviewStatus === "approved" && (
              <span className="video-uploader__status video-uploader__status--approved">已通过</span>
            )}
            {existingVideo?.reviewStatus === "rejected" && (
              <span className="video-uploader__status video-uploader__status--rejected">已拒绝</span>
            )}
          </div>
          <div className="video-uploader__actions">
            <button className="button button--primary" type="button" disabled={busy} onClick={() => void handleUpload()}>
              <Upload aria-hidden="true" />
              {busy ? "上传中..." : "上传视频"}
            </button>
            <button className="button button--secondary" type="button" disabled={busy} onClick={() => void handleDelete()}>
              <X aria-hidden="true" />
              删除
            </button>
          </div>
        </div>
      ) : (
        <div className="video-uploader__dropzone">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={(event) => void handleFileSelect(event)}
            className="video-uploader__input"
            aria-label="选择视频文件"
          />
          <div className="video-uploader__placeholder">
            <Upload aria-hidden="true" />
            <strong>点击或拖拽上传视频</strong>
            <span>支持 MP4、WebM 格式，10-90 秒，不超过 20MB</span>
          </div>
        </div>
      )}

      {error && (
        <p className="video-uploader__error" role="alert">
          <AlertCircle aria-hidden="true" />
          {error}
        </p>
      )}
      {message && (
        <p className="video-uploader__message" role="status">{message}</p>
      )}
    </div>
  );
}
