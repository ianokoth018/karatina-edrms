"use client";

import React from "react";
import { useSession } from "next-auth/react";
import { usePresence, type PresenceUser } from "@/lib/use-presence";

interface PresenceStripProps {
  resourceType: "document" | "memo" | "workflow" | "form";
  resourceId: string;
  /** Maximum bubbles to render before collapsing to "+N more". */
  max?: number;
}

const BUBBLE_COLOURS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
];

function colourFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return BUBBLE_COLOURS[Math.abs(hash) % BUBBLE_COLOURS.length];
}

/**
 * `<PresenceStrip />` — overlapping avatar bubbles showing other users
 * currently viewing the same resource. The signed-in user is excluded
 * from the rendered list (they don't need to see their own bubble).
 *
 * Polls every ~10s via `usePresence`.
 */
export function PresenceStrip({
  resourceType,
  resourceId,
  max = 4,
}: PresenceStripProps) {
  const { data: session } = useSession();
  const { viewers, loading } = usePresence(resourceType, resourceId);

  const others = viewers.filter((v: PresenceUser) => v.id !== session?.user?.id);

  if (loading || others.length === 0) return null;

  const visible = others.slice(0, max);
  const overflow = others.length - visible.length;

  return (
    <div
      className="inline-flex items-center gap-2"
      aria-label={`${others.length} other ${
        others.length === 1 ? "viewer" : "viewers"
      }`}
    >
      <div className="flex -space-x-2">
        {visible.map((v) => (
          <div
            key={v.id}
            title={v.displayName}
            className={`relative inline-flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-white dark:ring-gray-900 text-[11px] font-semibold text-white ${colourFor(
              v.id,
            )}`}
          >
            {v.initials}
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-gray-900" />
          </div>
        ))}
        {overflow > 0 && (
          <div
            title={others
              .slice(max)
              .map((v) => v.displayName)
              .join(", ")}
            className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 px-1.5 text-[11px] font-semibold text-gray-700 dark:text-gray-200 ring-2 ring-white dark:ring-gray-900"
          >
            +{overflow}
          </div>
        )}
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {others.length === 1 ? "1 viewer" : `${others.length} viewers`}
      </span>
    </div>
  );
}

export default PresenceStrip;
