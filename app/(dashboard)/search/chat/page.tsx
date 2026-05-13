"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFeatures } from "@/lib/use-features";

interface Citation {
  documentId: string;
  referenceNumber: string;
  title: string;
  snippet: string;
  score: number;
}

interface QaAnswerPayload {
  answer: string;
  citations: Citation[];
  usedProvider: string | null;
}

interface UserTurn {
  role: "user";
  id: string;
  text: string;
}

interface AssistantTurn {
  role: "assistant";
  id: string;
  text: string;
  citations: Citation[];
  usedProvider: string | null;
  error?: boolean;
}

type Turn = UserTurn | AssistantTurn;

function nextId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Render assistant text with [1] [2, 3] markers preserved and rendered
 * as small badges. We don't try to linkify them — the Sources list
 * below already does that and ambiguous numbers would mis-link.
 */
function AnswerText({ text }: { text: string }) {
  // Split on bracketed citation groups but keep the markers in the output.
  const parts = text.split(/(\[[0-9, ]+\])/g);
  return (
    <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-100 leading-relaxed">
      {parts.map((part, i) => {
        if (/^\[[0-9, ]+\]$/.test(part)) {
          return (
            <span
              key={i}
              className="mx-0.5 inline-flex items-center justify-center text-[10px] font-semibold text-karu-green bg-karu-green-light dark:bg-karu-green/10 rounded px-1.5 py-0.5 align-baseline"
            >
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}

export default function ChatPage() {
  const { features, loading: featuresLoading } = useFeatures();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the scroll pinned to the latest exchange when a new turn lands.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || pending) return;
    const userTurn: UserTurn = { role: "user", id: nextId(), text: question };
    setTurns((prev) => [...prev, userTurn]);
    setInput("");
    setPending(true);
    try {
      const res = await fetch("/api/ai/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}) as { error?: string });
        const message =
          (typeof errBody?.error === "string" && errBody.error) ||
          `Request failed (${res.status})`;
        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            id: nextId(),
            text: message,
            citations: [],
            usedProvider: null,
            error: true,
          },
        ]);
        return;
      }
      const data = (await res.json()) as QaAnswerPayload;
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          id: nextId(),
          text: data.answer,
          citations: data.citations,
          usedProvider: data.usedProvider,
        },
      ]);
    } catch (err) {
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          id: nextId(),
          text:
            err instanceof Error
              ? err.message
              : "Couldn't reach the server. Please try again.",
          citations: [],
          usedProvider: null,
          error: true,
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  const aiOff = !featuresLoading && !features.aiEnabled;

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Chat with your documents
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Ask questions about the document corpus. Answers cite the source
            documents you have access to.
          </p>
        </div>
        <Link
          href="/search"
          className="text-sm text-karu-green hover:underline flex-shrink-0"
        >
          ← Back to search
        </Link>
      </div>

      {aiOff && (
        <div className="mb-4 p-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-sm text-amber-800 dark:text-amber-200 flex-shrink-0">
          AI is not configured on this server. Set an{" "}
          <code className="font-mono">ANTHROPIC_API_KEY</code>,{" "}
          <code className="font-mono">OPENAI_API_KEY</code>, or{" "}
          <code className="font-mono">GEMINI_API_KEY</code> to enable chat.
        </div>
      )}

      {/* Thread */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-5"
      >
        {turns.length === 0 && !pending && (
          <div className="text-center text-sm text-gray-400 dark:text-gray-500 py-16">
            <p className="font-medium text-gray-500 dark:text-gray-400 mb-2">
              No questions yet
            </p>
            <p>
              Try: <em>&ldquo;What contracts mention Acme signed last year?&rdquo;</em>
            </p>
          </div>
        )}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl bg-karu-green text-white px-4 py-2.5 text-sm shadow-sm">
                {t.text}
              </div>
            </div>
          ) : (
            <div key={t.id} className="flex justify-start">
              <div
                className={`max-w-[90%] rounded-2xl px-4 py-3 shadow-sm border ${
                  t.error
                    ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-200"
                    : "bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700"
                }`}
              >
                <AnswerText text={t.text} />
                {t.citations.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                      Sources
                    </p>
                    <ol className="space-y-2">
                      {t.citations.map((c, i) => (
                        <li
                          key={c.documentId}
                          className="text-xs text-gray-700 dark:text-gray-300"
                        >
                          <div className="flex items-baseline gap-1.5">
                            <span className="font-mono text-[10px] font-semibold text-karu-green flex-shrink-0">
                              [{i + 1}]
                            </span>
                            <Link
                              href={`/documents/${c.documentId}`}
                              className="font-medium text-karu-green hover:underline break-all"
                            >
                              {c.referenceNumber} — {c.title}
                            </Link>
                          </div>
                          {c.snippet && (
                            <p className="mt-1 ml-6 text-gray-500 dark:text-gray-400 line-clamp-3">
                              {c.snippet}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {t.usedProvider && !t.error && (
                  <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">
                    via {t.usedProvider}
                  </p>
                )}
              </div>
            </div>
          )
        )}
        {pending && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-karu-green animate-pulse" />
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-karu-green animate-pulse"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-karu-green animate-pulse"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
                <span>Searching documents…</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={send} className="mt-4 flex-shrink-0">
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              aiOff
                ? "AI is not configured"
                : "Ask a question about the document corpus…"
            }
            disabled={aiOff || pending}
            className="w-full h-12 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-4 pr-28 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none focus:border-karu-green focus:ring-4 focus:ring-karu-green/10 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm"
            autoFocus
          />
          <button
            type="submit"
            disabled={!input.trim() || aiOff || pending}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? "Asking…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
