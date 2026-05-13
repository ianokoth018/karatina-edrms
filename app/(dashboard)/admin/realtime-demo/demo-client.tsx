"use client";

import { useEffect, useRef } from "react";
import { useRealtimeDoc } from "@/lib/use-realtime-doc";

/**
 * Tiny CRDT-bound <textarea>. We listen for ytext changes and reflect them
 * into the DOM, and on every user input we rewrite the ytext to match. This
 * is intentionally naive — for ProseMirror / Tiptap we'd swap in
 * `y-prosemirror` so cursors and incremental ops are preserved. It's good
 * enough as a smoke test that two tabs converge.
 */
export default function RealtimeDemoClient() {
  const { ydoc, status } = useRealtimeDoc("admin:realtime-demo");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Guard against feedback loops: don't push DOM updates back into ytext
  // while we're in the middle of applying a remote change.
  const applyingRemoteRef = useRef(false);

  useEffect(() => {
    if (!ydoc) return;
    const ytext = ydoc.getText("demo");

    const ta = textareaRef.current;
    if (ta) {
      applyingRemoteRef.current = true;
      ta.value = ytext.toString();
      applyingRemoteRef.current = false;
    }

    const observer = () => {
      const el = textareaRef.current;
      if (!el) return;
      const next = ytext.toString();
      if (el.value === next) return;
      // Preserve the user's caret as best we can.
      const { selectionStart, selectionEnd } = el;
      applyingRemoteRef.current = true;
      el.value = next;
      try {
        el.setSelectionRange(selectionStart, selectionEnd);
      } catch {
        /* ignore — happens if selection is past end */
      }
      applyingRemoteRef.current = false;
    };

    ytext.observe(observer);
    return () => {
      ytext.unobserve(observer);
    };
  }, [ydoc]);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (applyingRemoteRef.current) return;
    if (!ydoc) return;
    const ytext = ydoc.getText("demo");
    const next = e.target.value;
    // Naive whole-document replace. Good enough for a smoke test; real
    // bindings (y-prosemirror, y-textarea) compute diffs.
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, next);
    });
  }

  const statusColor =
    status === "connected"
      ? "bg-green-100 text-green-800"
      : status === "connecting"
        ? "bg-amber-100 text-amber-800"
        : status === "error"
          ? "bg-red-100 text-red-800"
          : "bg-gray-100 text-gray-700";

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Shared textarea</h2>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusColor}`}
        >
          {status}
        </span>
      </div>
      <textarea
        ref={textareaRef}
        onChange={onChange}
        rows={10}
        disabled={!ydoc}
        placeholder={ydoc ? "Type here…" : "Connecting…"}
        className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm font-mono focus:border-[#02773b] focus:outline-none disabled:bg-gray-50"
      />
      <p className="text-xs text-gray-500">
        Room: <code>admin:realtime-demo</code> — state lives in-memory on the
        WS server (<code>scripts/realtime-server.ts</code>) only.
      </p>
    </section>
  );
}
