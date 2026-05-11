"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

export type EndOutcome = "approved" | "rejected" | "withdrawn" | "cancelled" | "error";

export interface EndNodeData {
  label?: string;
  outcome?: EndOutcome;
}

const outcomeConfig: Record<EndOutcome, {
  border: string;
  bg: string;
  selectedBg: string;
  ring: string;
  iconColor: string;
  labelColor: string;
  handleColor: string;
}> = {
  approved: {
    border:     "border-green-500",
    bg:         "bg-green-50 dark:bg-green-950/30",
    selectedBg: "bg-green-50 dark:bg-green-950/40",
    ring:       "shadow-[0_0_0_3px_rgba(34,197,94,0.2)]",
    iconColor:  "text-green-600 dark:text-green-400",
    labelColor: "text-green-700 dark:text-green-400",
    handleColor:"!bg-green-500",
  },
  rejected: {
    border:     "border-red-500",
    bg:         "bg-red-50 dark:bg-red-950/30",
    selectedBg: "bg-red-50 dark:bg-red-950/40",
    ring:       "shadow-[0_0_0_3px_rgba(239,68,68,0.2)]",
    iconColor:  "text-red-600 dark:text-red-400",
    labelColor: "text-red-700 dark:text-red-400",
    handleColor:"!bg-red-500",
  },
  withdrawn: {
    border:     "border-gray-400 dark:border-gray-500",
    bg:         "bg-gray-100 dark:bg-gray-800/60",
    selectedBg: "bg-gray-100 dark:bg-gray-800/70",
    ring:       "shadow-[0_0_0_3px_rgba(156,163,175,0.2)]",
    iconColor:  "text-gray-500 dark:text-gray-400",
    labelColor: "text-gray-600 dark:text-gray-400",
    handleColor:"!bg-gray-400",
  },
  cancelled: {
    border:     "border-gray-400 dark:border-gray-500",
    bg:         "bg-gray-100 dark:bg-gray-800/60",
    selectedBg: "bg-gray-100 dark:bg-gray-800/70",
    ring:       "shadow-[0_0_0_3px_rgba(156,163,175,0.2)]",
    iconColor:  "text-gray-500 dark:text-gray-400",
    labelColor: "text-gray-600 dark:text-gray-400",
    handleColor:"!bg-gray-400",
  },
  error: {
    border:     "border-orange-500",
    bg:         "bg-orange-50 dark:bg-orange-950/30",
    selectedBg: "bg-orange-50 dark:bg-orange-950/40",
    ring:       "shadow-[0_0_0_3px_rgba(249,115,22,0.2)]",
    iconColor:  "text-orange-600 dark:text-orange-400",
    labelColor: "text-orange-700 dark:text-orange-400",
    handleColor:"!bg-orange-500",
  },
};

function OutcomeIcon({ outcome, className }: { outcome: EndOutcome; className: string }) {
  if (outcome === "approved") {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    );
  }
  if (outcome === "withdrawn" || outcome === "cancelled") {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
      </svg>
    );
  }
  if (outcome === "error") {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    );
  }
  // rejected (default)
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function EndNodeComponent({ data, selected }: NodeProps<EndNodeData>) {
  const outcome: EndOutcome = (data?.outcome as EndOutcome) ?? "rejected";
  const label = data?.label?.trim() || "END";
  const cfg = outcomeConfig[outcome] ?? outcomeConfig.rejected;

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <div
        className={`flex items-center justify-center w-14 h-14 rounded-full border-2 transition-all duration-200 ${cfg.border} ${
          selected ? `${cfg.selectedBg} ${cfg.ring}` : cfg.bg
        }`}
      >
        <Handle
          type="target"
          position={Position.Top}
          className={`!w-3 !h-3 ${cfg.handleColor} !border-2 !border-white dark:!border-gray-900`}
        />
        <OutcomeIcon outcome={outcome} className={`w-5 h-5 ${cfg.iconColor}`} />
      </div>
      <span
        className={`text-[10px] font-semibold text-center leading-tight max-w-[100px] ${cfg.labelColor}`}
      >
        {label}
      </span>
    </div>
  );
}

export const EndNode = memo(EndNodeComponent);
