"use client";

import { useState, useEffect, useCallback } from "react";

interface Author {
  id: string;
  name: string;
  displayName: string;
  department: string | null;
}

interface Comment {
  id: string;
  body: string;
  author: Author;
  parentId: string | null;
  isResolved: boolean;
  createdAt: string;
  replies?: Comment[];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function Initials({ name, isSelf }: { name: string; isSelf: boolean }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div
      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${
        isSelf
          ? "bg-[#02773b] text-white"
          : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
      }`}
    >
      {initials}
    </div>
  );
}

function CommentItem({
  comment,
  currentUserId,
  onReply,
  onResolve,
  depth = 0,
}: {
  comment: Comment;
  currentUserId: string;
  onReply: (parentId: string, body: string) => Promise<void>;
  onResolve: (commentId: string, resolved: boolean) => Promise<void>;
  depth?: number;
}) {
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleReply() {
    if (!replyText.trim()) return;
    setSubmitting(true);
    await onReply(comment.id, replyText.trim());
    setReplyText("");
    setShowReplyInput(false);
    setSubmitting(false);
  }

  return (
    <div className={depth > 0 ? "ml-6 border-l-2 border-gray-100 dark:border-gray-800 pl-4" : ""}>
      <div className="flex gap-3 py-3">
        <Initials name={comment.author.displayName || comment.author.name} isSelf={comment.author.id === currentUserId} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {comment.author.displayName || comment.author.name}
            </span>
            {comment.author.department && (
              <span className="text-xs text-gray-400">{comment.author.department}</span>
            )}
            <span className="text-xs text-gray-400">{timeAgo(comment.createdAt)}</span>
            {comment.isResolved && (
              <span className="text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 px-2 py-0.5 rounded-full">
                Resolved
              </span>
            )}
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 whitespace-pre-wrap">
            {comment.body}
          </p>
          <div className="flex items-center gap-3 mt-2">
            {depth === 0 && (
              <button
                onClick={() => setShowReplyInput(!showReplyInput)}
                className="text-xs font-medium text-gray-500 hover:text-[#02773b] transition-colors"
              >
                Reply
              </button>
            )}
            {depth === 0 && (
              <button
                onClick={() => onResolve(comment.id, !comment.isResolved)}
                className="text-xs font-medium text-gray-500 hover:text-[#02773b] transition-colors"
              >
                {comment.isResolved ? "Unresolve" : "Resolve"}
              </button>
            )}
          </div>
          {showReplyInput && (
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleReply()}
                placeholder="Write a reply..."
                className="flex-1 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm outline-none focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/20"
              />
              <button
                onClick={handleReply}
                disabled={submitting || !replyText.trim()}
                className="h-8 px-3 rounded-lg bg-[#02773b] text-white text-xs font-medium hover:bg-[#014d28] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "..." : "Reply"}
              </button>
            </div>
          )}
        </div>
      </div>
      {comment.replies?.map((reply) => (
        <CommentItem
          key={reply.id}
          comment={reply}
          currentUserId={currentUserId}
          onReply={onReply}
          onResolve={onResolve}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

export default function CommentsPanel({
  documentId,
  currentUserId,
}: {
  documentId: string;
  currentUserId: string;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents/${documentId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments);
        setTotal(data.total);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [documentId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  async function handleAddComment() {
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: newComment.trim() }),
      });
      if (res.ok) {
        setNewComment("");
        fetchComments();
      }
    } catch { /* ignore */ }
    setSubmitting(false);
  }

  async function handleReply(parentId: string, body: string) {
    await fetch(`/api/documents/${documentId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, parentId }),
    });
    fetchComments();
  }

  async function handleResolve(commentId: string, isResolved: boolean) {
    await fetch(`/api/documents/${documentId}/comments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId, isResolved }),
    });
    fetchComments();
  }

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/4" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Comments ({total})
        </h3>
      </div>

      {/* New comment input */}
      <div className="flex gap-3 mb-6">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          rows={2}
          placeholder="Add a comment..."
          className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 resize-none"
        />
        <button
          onClick={handleAddComment}
          disabled={submitting || !newComment.trim()}
          className="self-end h-10 px-4 rounded-xl bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "..." : "Post"}
        </button>
      </div>

      {/* Comments list */}
      {comments.length === 0 ? (
        <div className="text-center py-8">
          <svg className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
          </svg>
          <p className="text-sm text-gray-400 dark:text-gray-500">No comments yet. Start a discussion.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              currentUserId={currentUserId}
              onReply={handleReply}
              onResolve={handleResolve}
            />
          ))}
        </div>
      )}
    </div>
  );
}
