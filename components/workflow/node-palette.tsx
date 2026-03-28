"use client";

import { type DragEvent } from "react";

interface PaletteItem {
  type: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}

const paletteItems: PaletteItem[] = [
  {
    type: "start",
    label: "Start",
    description: "Workflow entry point",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
        />
      </svg>
    ),
    color: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
  },
  {
    type: "task",
    label: "Task",
    description: "Approval or review step",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      </svg>
    ),
    color: "text-karu-green bg-karu-green-light border-karu-green/20",
  },
  {
    type: "decision",
    label: "Decision",
    description: "Conditional branching",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
        />
      </svg>
    ),
    color: "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800",
  },
  {
    type: "end",
    label: "End",
    description: "Workflow completion",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z"
        />
      </svg>
    ),
    color: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",
  },
];

function onDragStart(event: DragEvent, nodeType: string) {
  event.dataTransfer.setData("application/reactflow", nodeType);
  event.dataTransfer.effectAllowed = "move";
}

export default function NodePalette() {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1">
        Node Palette
      </h3>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 px-1 leading-relaxed">
        Drag a node onto the canvas to add it to your workflow.
      </p>
      <div className="space-y-1.5 mt-3">
        {paletteItems.map((item) => (
          <div
            key={item.type}
            draggable
            onDragStart={(e) => onDragStart(e, item.type)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-grab active:cursor-grabbing transition-all hover:shadow-sm ${item.color}`}
          >
            <div className="flex-shrink-0">{item.icon}</div>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">{item.label}</p>
              <p className="text-[10px] opacity-70 leading-tight mt-0.5">{item.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
