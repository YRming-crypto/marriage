import { useCallback, useEffect, useState } from "react";
import { Heart, MessageCircle, Send, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { deleteComment, getComments, likeComment, postComment } from "../api/client";
import type { CommentPayload } from "../api/client";

function formatTime(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(ts);
}

function isLoggedIn() {
  try { return Boolean(JSON.parse(localStorage.getItem("ai-marriage-auth-user") ?? "null")); }
  catch { return false; }
}

function getCurrentUserId(): string | null {
  try {
    const user = JSON.parse(localStorage.getItem("ai-marriage-auth-user") ?? "null");
    return user?.id ?? null;
  } catch { return null; }
}

function CommentForm({ contentId, parentId, placeholder, onSubmit }: {
  contentId: string;
  parentId: string | null;
  placeholder?: string;
  onSubmit: (comment: CommentPayload) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postComment(contentId, trimmed, parentId);
      onSubmit(result.data.comment);
      setText("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "评论发送失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="comment-form">
      <textarea
        className="comment-form__input"
        rows={1}
        maxLength={500}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? "写下你的想法…"}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
      />
      <button className="comment-form__send" type="button" disabled={busy || !text.trim()} onClick={() => void submit()}>
        <Send aria-hidden="true" />
        {busy ? "发送中" : "发送"}
      </button>
      {error ? <p className="comment-form__error" role="alert">{error}</p> : null}
    </div>
  );
}

function CommentItem({ comment, contentId, onReply, onDelete, onLike }: {
  comment: CommentPayload;
  contentId: string;
  onReply: (parentId: string) => void;
  onDelete: (commentId: string) => void;
  onLike: (commentId: string) => void;
}) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(comment.likeCount);
  const isMine = getCurrentUserId() === comment.authorId;

  function handleLike() {
    if (liked) return;
    setLiked(true);
    setLikeCount((c) => c + 1);
    onLike(comment.id);
    void likeComment(comment.id).catch(() => {
      setLiked(false);
      setLikeCount((c) => c - 1);
    });
  }

  return (
    <div className="comment-item">
      <div className="comment-item__avatar">
        {comment.authorPhotoUrl
          ? <img src={comment.authorPhotoUrl} alt={`${comment.authorName}的头像`} />
          : <span className="comment-item__avatar-fallback">{comment.authorName.charAt(0)}</span>}
      </div>
      <div className="comment-item__body">
        <div className="comment-item__header">
          <strong>{comment.authorName}</strong>
          <time>{formatTime(comment.createdAt)}</time>
        </div>
        <p className="comment-item__text">{comment.text}</p>
        <div className="comment-item__actions">
          <button type="button" className="comment-action" onClick={handleLike} aria-pressed={liked}>
            <Heart aria-hidden="true" fill={liked ? "currentColor" : "none"} />
            <span>{likeCount || ""}</span>
          </button>
          <button type="button" className="comment-action" onClick={() => onReply(comment.id)}>
            <MessageCircle aria-hidden="true" />回复
          </button>
          {isMine ? (
            <button type="button" className="comment-action comment-action--danger" onClick={() => onDelete(comment.id)}>
              <Trash2 aria-hidden="true" />删除
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function CommentSection({ contentId }: { contentId: string }) {
  const [comments, setComments] = useState<CommentPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const loadComments = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getComments(contentId);
      setComments(result.data.items);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [contentId]);

  useEffect(() => { void loadComments(); }, [loadComments]);

  function handleNewComment(comment: CommentPayload) {
    setComments((prev) => [...prev, comment]);
    setReplyTo(null);
  }

  function handleDelete(commentId: string) {
    void deleteComment(commentId).then(() => {
      setComments((prev) => prev.filter((c) => c.id !== commentId && c.parentId !== commentId));
    });
  }

  const rootComments = comments.filter((c) => !c.parentId);
  const replies = comments.filter((c) => c.parentId);
  const visibleRoots = showAll ? rootComments : rootComments.slice(-5);

  const replyTarget = replyTo ? comments.find((c) => c.id === replyTo) : null;

  return (
    <section className="comment-section" aria-label="评论区">
      <div className="comment-section__header">
        <MessageCircle aria-hidden="true" />
        <strong>评论 ({comments.length})</strong>
      </div>

      {loading ? (
        <div className="comment-section__loading">正在加载评论…</div>
      ) : (
        <>
          {visibleRoots.length ? (
            <div className="comment-list">
              {visibleRoots.map((comment) => {
                const childReplies = replies.filter((r) => r.parentId === comment.id);
                return (
                  <div key={comment.id} className="comment-thread">
                    <CommentItem
                      comment={comment}
                      contentId={contentId}
                      onReply={setReplyTo}
                      onDelete={handleDelete}
                      onLike={() => undefined}
                    />
                    {childReplies.length ? (
                      <div className="comment-replies">
                        {childReplies.map((reply) => (
                          <CommentItem
                            key={reply.id}
                            comment={reply}
                            contentId={contentId}
                            onReply={setReplyTo}
                            onDelete={handleDelete}
                            onLike={() => undefined}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="comment-section__empty">还没有评论，来说两句吧～</p>
          )}

          {rootComments.length > 5 && !showAll ? (
            <button className="comment-section__show-more" type="button" onClick={() => setShowAll(true)}>
              <ChevronUp aria-hidden="true" />展开全部 {rootComments.length} 条评论
            </button>
          ) : null}

          {isLoggedIn() ? (
            <>
              {replyTo && replyTarget ? (
                <div className="comment-reply-indicator">
                  <span>回复 <strong>{replyTarget.authorName}</strong></span>
                  <button type="button" onClick={() => setReplyTo(null)}>取消</button>
                </div>
              ) : null}
              <CommentForm
                contentId={contentId}
                parentId={replyTo}
                placeholder={replyTo ? `回复 ${replyTarget?.authorName ?? ""}…` : "写下你的想法…"}
                onSubmit={handleNewComment}
              />
            </>
          ) : (
            <p className="comment-section__login-hint">
              <a href="/auth">登录</a>后可以发表评论
            </p>
          )}
        </>
      )}
    </section>
  );
}
