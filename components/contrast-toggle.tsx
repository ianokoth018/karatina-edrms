"use client";

import { useContrastMode } from "@/lib/contrast";

export default function ContrastToggle() {
  const { mode, setMode } = useContrastMode();
  const isHigh = mode === "high";

  return (
    <button
      type="button"
      onClick={() => setMode(isHigh ? "normal" : "high")}
      aria-pressed={isHigh}
      title={isHigh ? "Normal contrast" : "High-contrast mode"}
      aria-label={isHigh ? "Switch to normal contrast" : "Switch to high-contrast mode"}
      className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
    >
      {/* Heroicons-style "eye" / accessibility glyph. Split halves so the
          button still reads as an accessibility affordance in HC mode where
          gradients/fills are flattened. */}
      <svg
        className="w-5 h-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        {/* Outer eye outline */}
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
        />
        {/* Left half filled to indicate "contrast" */}
        <path
          d="M12 4.5v15"
          strokeLinecap="round"
        />
        <path
          d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5v15c-4.638 0-8.573-3.007-9.963-7.178Z"
          fill="currentColor"
          stroke="none"
        />
        {/* Pupil */}
        <circle cx="12" cy="12" r="2.25" />
      </svg>
    </button>
  );
}
