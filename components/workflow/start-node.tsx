"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

function StartNodeComponent({ selected }: NodeProps) {
  return (
    <div
      className={`flex items-center justify-center w-16 h-16 rounded-full border-2 transition-all duration-200 ${
        selected
          ? "border-karu-green shadow-[0_0_0_3px_rgba(2,119,59,0.2)] bg-green-50 dark:bg-green-950/40"
          : "border-green-500 bg-green-50 dark:bg-green-950/30"
      }`}
    >
      <div className="flex flex-col items-center">
        <svg
          className="w-5 h-5 text-green-600 dark:text-green-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
          />
        </svg>
        <span className="text-[10px] font-bold text-green-700 dark:text-green-400 mt-0.5">
          START
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-green-500 !border-2 !border-white dark:!border-gray-900"
      />
    </div>
  );
}

export const StartNode = memo(StartNodeComponent);
