"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

export interface WaitSignalNodeData {
  label: string;
  signalName: string;
  description?: string;
  timeoutHours?: number;
}

function WaitSignalNodeComponent({ data, selected }: NodeProps<WaitSignalNodeData>) {
  return (
    <div
      className={`min-w-[180px] max-w-[240px] rounded-xl border-2 bg-white dark:bg-gray-900 shadow-sm transition-all duration-200 ${
        selected
          ? "border-karu-green shadow-[0_0_0_3px_rgba(2,119,59,0.15)]"
          : "border-orange-400 dark:border-orange-600 hover:shadow-md"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-orange-500 !border-2 !border-white dark:!border-gray-900"
      />

      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
              />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {data.label || "Wait for Signal"}
          </h3>
        </div>
      </div>

      <div className="px-3 pb-3 space-y-1.5">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
          Awaiting Signal
        </span>

        {data.signalName && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed font-mono truncate">
            {data.signalName}
          </p>
        )}

        {data.timeoutHours && (
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            Timeout: {data.timeoutHours}h
          </p>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-orange-500 !border-2 !border-white dark:!border-gray-900"
      />
    </div>
  );
}

export const WaitSignalNode = memo(WaitSignalNodeComponent);
