"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

/* ---------- types ---------- */

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

/* ---------- constants ---------- */

const PAGE_SIZE = 20;

const TABS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
] as const;

/* ---------- helpers ---------- */

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffWeek < 4) return `${diffWeek}w ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function typeIcon(type: string): React.ReactNode {
  switch (type) {
    case "MEMO_ACTION_REQUIRED":
      return (
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center">
          <svg className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
      );
    case "MEMO_APPROVED":
      return (
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
          <svg className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>
      );
    case "MEMO_REJECTED":
      return (
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center">
          <svg className="w-4.5 h-4.5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>
      );
    case "MEMO_RETURNED":
      return (
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-orange-100 dark:bg-orange-950/40 flex items-center justify-center">
          <svg className="w-4.5 h-4.5 text-orange-600 dark:text-orange-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
          </svg>
        </div>
      );
    case "MEMO_RECEIVED":
      return (
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
          <svg className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 0 1-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 0 0 1.183 1.981l6.478 3.488m8.839 2.51-4.66-2.51m0 0-1.023-.55a2.25 2.25 0 0 0-2.134 0l-1.022.55m0 0-4.661 2.51m16.5 1.615a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V8.844a2.25 2.25 0 0 1 1.183-1.981l7.5-4.039a2.25 2.25 0 0 1 2.134 0l7.5 4.039a2.25 2.25 0 0 1 1.183 1.98V19.5Z" />
          </svg>
        </div>
      );
    case "MEMO_CIRCULATED":
      return (
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-950/40 flex items-center justify-center">
          <svg className="w-4.5 h-4.5 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
        </div>
      );
    case "MEMO_CLARIFICATION_REQUESTED":
      return (
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-yellow-100 dark:bg-yellow-950/40 flex items-center justify-center">
          <svg className="w-4.5 h-4.5 text-yellow-600 dark:text-yellow-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
          </svg>
        </div>
      );
    case "MEMO_CLARIFICATION_PROVIDED":
      return (
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-teal-100 dark:bg-teal-950/40 flex items-center justify-center">
          <svg className="w-4.5 h-4.5 text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
          </svg>
        </div>
      );
    case "WORKFLOW_TASK":
      return (
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-950/40 flex items-center justify-center">
          <svg className="w-4.5 h-4.5 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3" />
          </svg>
        </div>
      );
    default:
      return (
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
          <svg className="w-4.5 h-4.5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
          </svg>
        </div>
      );
  }
}

/* ---------- component ---------- */

export default function NotificationsPage() {
  const router = useRouter();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "unread">("all");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchNotifications = useCallback(
    async (limit = PAGE_SIZE, append = false) => {
      if (!append) setIsLoading(true);
      else setLoadingMore(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (activeTab === "unread") params.set("unreadOnly", "true");
        params.set("limit", String(limit));

        const res = await fetch(`/api/notifications?${params.toString()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to fetch notifications");
        }

        const data = await res.json();
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
        setHasMore(data.notifications.length === limit);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setIsLoading(false);
        setLoadingMore(false);
      }
    },
    [activeTab]
  );

  useEffect(() => {
    fetchNotifications(PAGE_SIZE);
  }, [fetchNotifications]);

  async function handleLoadMore() {
    const nextLimit = notifications.length + PAGE_SIZE;
    await fetchNotifications(nextLimit, true);
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      if (!res.ok) throw new Error("Failed to mark all as read");

      const data = await res.json();
      setUnreadCount(data.unreadCount);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true }))
      );
    } catch {
      // Silently fail -- the user can retry
    } finally {
      setMarkingAll(false);
    }
  }

  async function handleClickNotification(notification: Notification) {
    // Mark as read if unread
    if (!notification.isRead) {
      try {
        const res = await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationIds: [notification.id] }),
        });
        if (res.ok) {
          const data = await res.json();
          setUnreadCount(data.unreadCount);
          setNotifications((prev) =>
            prev.map((n) =>
              n.id === notification.id ? { ...n, isRead: true } : n
            )
          );
        }
      } catch {
        // Navigate anyway
      }
    }

    // Navigate
    if (notification.linkUrl) {
      router.push(notification.linkUrl);
    }
  }

  return (
    <div className="p-6 max-w-[900px] mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Notifications
            </h1>
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full bg-karu-green text-white text-xs font-semibold">
                {unreadCount}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Stay up to date with memos, approvals, and tasks
          </p>
        </div>

        <button
          onClick={handleMarkAllRead}
          disabled={markingAll || unreadCount === 0}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-karu-green text-white font-medium text-sm transition-all hover:bg-karu-green-dark focus:ring-2 focus:ring-karu-green/20 focus:ring-offset-2 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {markingAll ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          )}
          Mark all as read
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-800">
        <nav className="-mb-px flex gap-1" aria-label="Tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as "all" | "unread")}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "border-karu-green text-karu-green"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              {tab.label}
              {tab.key === "unread" && unreadCount > 0 && (
                <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-5 px-1.5 rounded-full bg-karu-green/10 text-karu-green text-xs font-semibold">
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-red-500 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Notification list */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden animate-slide-up delay-200">
        {isLoading ? (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 p-4">
                <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-1/2" />
                </div>
                <div className="h-3 w-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 px-4">
            <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <svg
                className="w-7 h-7 text-gray-300 dark:text-gray-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
                />
              </svg>
            </div>
            <p className="text-gray-500 dark:text-gray-400 font-medium">
              {activeTab === "unread"
                ? "No unread notifications"
                : "No notifications yet"}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {activeTab === "unread"
                ? "You're all caught up!"
                : "Notifications about memos and tasks will appear here"}
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  onClick={() => handleClickNotification(notification)}
                  className={`w-full flex items-start gap-3 p-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                    !notification.isRead
                      ? "bg-karu-green-light dark:bg-karu-green/5"
                      : ""
                  }`}
                >
                  {typeIcon(notification.type)}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-sm truncate ${
                          !notification.isRead
                            ? "font-semibold text-gray-900 dark:text-gray-100"
                            : "font-medium text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {notification.title}
                      </p>
                      <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap flex-shrink-0">
                        {relativeTime(notification.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                      {notification.body}
                    </p>
                  </div>

                  {!notification.isRead && (
                    <div className="flex-shrink-0 mt-1.5">
                      <span className="block w-2 h-2 rounded-full bg-karu-green" />
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center border-t border-gray-200 dark:border-gray-800 py-3">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Loading...
                    </>
                  ) : (
                    "Load more"
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
