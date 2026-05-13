import type { SecurityClassification } from "@prisma/client";

const STYLES: Record<SecurityClassification, { label: string; cls: string }> = {
  OPEN: { label: "Open", cls: "bg-gray-100 text-gray-700 border-gray-300" },
  CONFIDENTIAL: {
    label: "Confidential",
    cls: "bg-blue-50 text-blue-800 border-blue-300",
  },
  RESTRICTED: {
    label: "Restricted",
    cls: "bg-yellow-50 text-yellow-800 border-yellow-400",
  },
  SECRET: {
    label: "Secret",
    cls: "bg-orange-50 text-orange-800 border-orange-400",
  },
  TOP_SECRET: {
    label: "Top Secret",
    cls: "bg-red-50 text-red-800 border-red-400",
  },
};

export function ClassificationBadge({
  level,
  size = "md",
}: {
  level: SecurityClassification;
  size?: "sm" | "md";
}) {
  const s = STYLES[level] ?? STYLES.OPEN;
  const sizeCls =
    size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center rounded border font-semibold uppercase tracking-wide ${sizeCls} ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

export const ALL_CLASSIFICATIONS: SecurityClassification[] = [
  "OPEN",
  "CONFIDENTIAL",
  "RESTRICTED",
  "SECRET",
  "TOP_SECRET",
];
