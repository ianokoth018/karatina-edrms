"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

function EndNodeComponent({ selected }: NodeProps) {
  return (
    <div
      className={`flex items-center justify-center w-16 h-16 rounded-full border-2 transition-all duration-200 ${
        selected
          ? "border-karu-green shadow-[0_0_0_3px_rgba(2,119,59,0.2)] bg-red-50 dark:bg-red-950/40"
          : "border-red-500 bg-red-50 dark:bg-red-950/30"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-red-500 !border-2 !border-white dark:!border-gray-900"
      />
      <div className="flex flex-col items-center">
        <svg
          className="w-5 h-5 text-red-600 dark:text-red-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z"
          />
        </svg>
        <span className="text-[10px] font-bold text-red-700 dark:text-red-400 mt-0.5">
          END
        </span>
      </div>
    </div>
  );
}

export const EndNode = memo(EndNodeComponent);
