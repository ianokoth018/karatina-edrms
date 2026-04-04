"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle } from "@tiptap/extension-text-style";
import { FontFamily } from "@tiptap/extension-font-family";
import { FontSize } from "@/lib/font-size-extension";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { useEffect, useState, useRef, useCallback } from "react";

/* ---------- constants ---------- */

const FONT_SIZES = [
  { label: "8", value: "8pt" },
  { label: "9", value: "9pt" },
  { label: "10", value: "10pt" },
  { label: "11", value: "11pt" },
  { label: "12", value: "12pt" },
  { label: "14", value: "14pt" },
  { label: "16", value: "16pt" },
  { label: "18", value: "18pt" },
  { label: "20", value: "20pt" },
  { label: "24", value: "24pt" },
  { label: "28", value: "28pt" },
  { label: "36", value: "36pt" },
];

const DEFAULT_FONT = "Arial Narrow";
const DEFAULT_FONT_SIZE = "12pt";

const TEXT_COLORS = [
  { label: "Black", value: "#000000" },
  { label: "Dark Gray", value: "#4B5563" },
  { label: "Red", value: "#DC2626" },
  { label: "Orange", value: "#EA580C" },
  { label: "Green", value: "#16A34A" },
  { label: "Blue", value: "#2563EB" },
  { label: "Purple", value: "#9333EA" },
];

const HIGHLIGHT_COLORS = [
  { label: "Yellow", value: "#FEF08A" },
  { label: "Green", value: "#BBF7D0" },
  { label: "Blue", value: "#BFDBFE" },
  { label: "Pink", value: "#FBCFE8" },
];

const LINE_HEIGHTS = [
  { label: "1.0", value: "1" },
  { label: "1.15", value: "1.15" },
  { label: "1.5", value: "1.5" },
  { label: "2.0", value: "2" },
];

/* ---------- types ---------- */

interface RichTextEditorProps {
  content?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
}

/* ---------- toolbar button ---------- */

function ToolbarButton({
  onClick,
  isActive,
  disabled,
  title,
  children,
  className: extraClass,
}: {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        isActive
          ? "bg-[#02773b] text-white shadow-sm"
          : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200"
      } ${extraClass ?? ""}`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-0.5" />;
}

/* ---------- dropdown picker ---------- */

function ColorPicker({
  colors,
  onSelect,
  activeColor,
  title,
  icon,
}: {
  colors: { label: string; value: string }[];
  onSelect: (color: string) => void;
  activeColor?: string;
  title: string;
  icon: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={title}
        className="p-1.5 rounded-md transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200 flex items-center gap-0.5"
      >
        {icon}
        <svg className="w-2.5 h-2.5 opacity-60" viewBox="0 0 10 6" fill="currentColor">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute z-50 mt-1 left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-2 flex flex-wrap gap-1 min-w-[120px]">
          {colors.map((color) => (
            <button
              key={color.value}
              type="button"
              title={color.label}
              onClick={() => {
                onSelect(color.value);
                setIsOpen(false);
              }}
              className={`w-6 h-6 rounded border-2 transition-all hover:scale-110 ${
                activeColor === color.value
                  ? "border-[#02773b] ring-1 ring-[#02773b]/30"
                  : "border-gray-200 dark:border-gray-600"
              }`}
              style={{ backgroundColor: color.value }}
            />
          ))}
          {/* Remove color option */}
          <button
            type="button"
            title="Remove"
            onClick={() => {
              onSelect("");
              setIsOpen(false);
            }}
            className="w-6 h-6 rounded border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-300 transition-all hover:scale-110"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- line height picker ---------- */

function LineHeightPicker({
  onSelect,
  currentValue,
}: {
  onSelect: (value: string) => void;
  currentValue?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title="Line Spacing"
        className="p-1.5 rounded-md transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200 flex items-center gap-0.5"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h18M3 18h18" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 3v18" strokeWidth={1} strokeDasharray="2 2" />
        </svg>
        <svg className="w-2.5 h-2.5 opacity-60" viewBox="0 0 10 6" fill="currentColor">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute z-50 mt-1 left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[90px]">
          {LINE_HEIGHTS.map((lh) => (
            <button
              key={lh.value}
              type="button"
              onClick={() => {
                onSelect(lh.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                currentValue === lh.value
                  ? "bg-[#02773b]/10 text-[#02773b] font-semibold"
                  : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              {lh.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- main component ---------- */

export default function RichTextEditor({
  content = "",
  onChange,
  placeholder = "Type your memo content here...",
  editable = true,
}: RichTextEditorProps) {
  const [lineHeight, setLineHeight] = useState("1.5");

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
        strike: {},
        horizontalRule: {},
      }),
      Underline,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      Superscript,
      Subscript,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Placeholder.configure({
        placeholder,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: content || `<p style="font-family: ${DEFAULT_FONT}; font-size: ${DEFAULT_FONT_SIZE}"></p>`,
    editable,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none px-6 py-5 min-h-[280px] focus:outline-none text-gray-900 dark:text-gray-100",
        style: `font-family: '${DEFAULT_FONT}', Arial, sans-serif; font-size: ${DEFAULT_FONT_SIZE}; background: white;`,
      },
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
    // Only run when content prop changes externally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const handleIndent = useCallback(() => {
    if (!editor) return;
    // Use sinkListItem for lists, otherwise wrap in a blockquote-like padding via CSS
    if (editor.isActive("listItem")) {
      editor.chain().focus().sinkListItem("listItem").run();
    } else {
      // Apply padding-left via inline style on the current node
      const { from } = editor.state.selection;
      const node = editor.state.doc.resolve(from).parent;
      const currentPadding = parseInt(
        (node.attrs as Record<string, string>)?.style?.match(/padding-left:\s*(\d+)/)?.[1] || "0"
      );
      const newPadding = currentPadding + 40;
      editor.chain().focus().updateAttributes("paragraph", {
        style: `padding-left: ${newPadding}px`,
      }).run();
    }
  }, [editor]);

  const handleOutdent = useCallback(() => {
    if (!editor) return;
    if (editor.isActive("listItem")) {
      editor.chain().focus().liftListItem("listItem").run();
    } else {
      const { from } = editor.state.selection;
      const node = editor.state.doc.resolve(from).parent;
      const currentPadding = parseInt(
        (node.attrs as Record<string, string>)?.style?.match(/padding-left:\s*(\d+)/)?.[1] || "0"
      );
      const newPadding = Math.max(0, currentPadding - 40);
      editor.chain().focus().updateAttributes("paragraph", {
        style: newPadding > 0 ? `padding-left: ${newPadding}px` : "",
      }).run();
    }
  }, [editor]);

  const handleLineHeight = useCallback(
    (value: string) => {
      if (!editor) return;
      setLineHeight(value);
      // Apply line-height to the editor wrapper
      const editorEl = document.querySelector(".ProseMirror");
      if (editorEl) {
        (editorEl as HTMLElement).style.lineHeight = value;
      }
    },
    [editor]
  );

  if (!editor) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="h-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 animate-pulse" />
        <div className="h-[280px] animate-pulse" />
      </div>
    );
  }

  /* Determine the currently active font size */
  const currentFontSize =
    editor.getAttributes("textStyle").fontSize || DEFAULT_FONT_SIZE;
  const currentFontFamily =
    editor.getAttributes("textStyle").fontFamily || DEFAULT_FONT;
  const currentColor = editor.getAttributes("textStyle").color || "#000000";
  const currentHighlight = editor.getAttributes("highlight").color || "";

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 overflow-hidden shadow-sm transition-shadow focus-within:shadow-md focus-within:border-[#02773b]/40">
      {/* Toolbar */}
      {editable && (
        <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700">
          {/* Font family */}
          <select
            value={currentFontFamily}
            onChange={(e) => {
              if (e.target.value) {
                editor.chain().focus().setFontFamily(e.target.value).run();
              } else {
                editor.chain().focus().unsetFontFamily().run();
              }
            }}
            className="h-8 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#02773b]"
          >
            <option value="Arial Narrow" style={{ fontFamily: "Arial Narrow" }}>
              Arial Narrow
            </option>
            <option value="Arial" style={{ fontFamily: "Arial" }}>
              Arial
            </option>
            <option
              value="Times New Roman"
              style={{ fontFamily: "Times New Roman" }}
            >
              Times New Roman
            </option>
            <option value="Georgia" style={{ fontFamily: "Georgia" }}>
              Georgia
            </option>
            <option value="Verdana" style={{ fontFamily: "Verdana" }}>
              Verdana
            </option>
            <option value="Courier New" style={{ fontFamily: "Courier New" }}>
              Courier New
            </option>
            <option
              value="Trebuchet MS"
              style={{ fontFamily: "Trebuchet MS" }}
            >
              Trebuchet MS
            </option>
            <option value="Tahoma" style={{ fontFamily: "Tahoma" }}>
              Tahoma
            </option>
            <option value="Calibri" style={{ fontFamily: "Calibri" }}>
              Calibri
            </option>
          </select>

          {/* Font size */}
          <select
            value={currentFontSize}
            onChange={(e) => {
              const newSize = e.target.value;
              if (newSize) {
                editor.chain().focus().setFontSize(newSize).run();
              } else {
                editor.chain().focus().unsetFontSize().run();
              }
            }}
            className="h-8 w-16 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1.5 text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#02773b]"
          >
            {FONT_SIZES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}pt
              </option>
            ))}
          </select>

          <ToolbarDivider />

          {/* Text formatting: B I U S */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive("bold")}
            title="Bold (Ctrl+B)"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6V4zm0 8h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6v-8zm3-5v2h5a1 1 0 1 0 0-2H9zm0 8v2h6a1 1 0 1 0 0-2H9z" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive("italic")}
            title="Italic (Ctrl+I)"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 5h6v2h-2.21l-3.42 10H13v2H7v-2h2.21l3.42-10H10V5z" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            isActive={editor.isActive("underline")}
            title="Underline (Ctrl+U)"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5 21h14v-2H5v2zm7-4a6 6 0 0 0 6-6V3h-2.5v8a3.5 3.5 0 1 1-7 0V3H6v8a6 6 0 0 0 6 6z" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={editor.isActive("strike")}
            title="Strikethrough"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 12h18v2H3v-2zm3-6h12v2H6V6zm2 10h8v2H8v-2z" />
            </svg>
          </ToolbarButton>

          <ToolbarDivider />

          {/* Font color */}
          <ColorPicker
            colors={TEXT_COLORS}
            activeColor={currentColor}
            title="Font Color"
            onSelect={(color) => {
              if (color) {
                editor.chain().focus().setColor(color).run();
              } else {
                editor.chain().focus().unsetColor().run();
              }
            }}
            icon={
              <div className="flex flex-col items-center">
                <span className="text-xs font-bold leading-none" style={{ color: currentColor }}>A</span>
                <div
                  className="w-4 h-1 rounded-sm mt-0.5"
                  style={{ backgroundColor: currentColor }}
                />
              </div>
            }
          />

          {/* Highlight color */}
          <ColorPicker
            colors={HIGHLIGHT_COLORS}
            activeColor={currentHighlight}
            title="Highlight Color"
            onSelect={(color) => {
              if (color) {
                editor.chain().focus().toggleHighlight({ color }).run();
              } else {
                editor.chain().focus().unsetHighlight().run();
              }
            }}
            icon={
              <div className="flex flex-col items-center">
                <span className="text-xs font-bold leading-none">A</span>
                <div
                  className="w-4 h-1 rounded-sm mt-0.5"
                  style={{ backgroundColor: currentHighlight || "#FEF08A" }}
                />
              </div>
            }
          />

          <ToolbarDivider />

          {/* Alignment */}
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            isActive={editor.isActive({ textAlign: "left" })}
            title="Align Left"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3h18v2H3V3zm0 4h12v2H3V7zm0 4h18v2H3v-2zm0 4h12v2H3v-2zm0 4h18v2H3v-2z" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            isActive={editor.isActive({ textAlign: "center" })}
            title="Align Center"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3h18v2H3V3zm3 4h12v2H6V7zm-3 4h18v2H3v-2zm3 4h12v2H6v-2zm-3 4h18v2H3v-2z" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            isActive={editor.isActive({ textAlign: "right" })}
            title="Align Right"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3h18v2H3V3zm6 4h12v2H9V7zm-6 4h18v2H3v-2zm6 4h12v2H9v-2zm-6 4h18v2H3v-2z" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() =>
              editor.chain().focus().setTextAlign("justify").run()
            }
            isActive={editor.isActive({ textAlign: "justify" })}
            title="Justify"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3h18v2H3V3zm0 4h18v2H3V7zm0 4h18v2H3v-2zm0 4h18v2H3v-2zm0 4h18v2H3v-2z" />
            </svg>
          </ToolbarButton>

          <ToolbarDivider />

          {/* Indent / Outdent */}
          <ToolbarButton onClick={handleIndent} title="Increase Indent">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3h18v2H3V3zm6 4h12v2H9V7zm0 4h12v2H9v-2zm0 4h12v2H9v-2zm-6 4h18v2H3v-2zM3 8l4 3-4 3V8z" />
            </svg>
          </ToolbarButton>
          <ToolbarButton onClick={handleOutdent} title="Decrease Indent">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3h18v2H3V3zm6 4h12v2H9V7zm0 4h12v2H9v-2zm0 4h12v2H9v-2zm-6 4h18v2H3v-2zM7 8l-4 3 4 3V8z" />
            </svg>
          </ToolbarButton>

          {/* Line height */}
          <LineHeightPicker onSelect={handleLineHeight} currentValue={lineHeight} />

          <ToolbarDivider />

          {/* Lists */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive("bulletList")}
            title="Bullet List"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 7.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM4 21a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM8 5h13v2H8V5zm0 7h13v2H8v-2zm0 7h13v2H8v-2z" />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive("orderedList")}
            title="Numbered List"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 5V3.5h2V2h1.5v3.5H7V7H2V5zm0 10.5v-1h1.5v-.5H2v-1.5h3v1h-1.5v.5H5V16H2v-0.5zM3.25 19H2v1.5h3V22H2v-1.5h1.25v-.5H2V18.5h3v1h-1.75v-.5zM8 5h13v2H8V5zm0 7h13v2H8v-2zm0 7h13v2H8v-2z" />
            </svg>
          </ToolbarButton>

          <ToolbarDivider />

          {/* Horizontal rule */}
          <ToolbarButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal Rule"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 11h18v2H3z" />
            </svg>
          </ToolbarButton>

          {/* Superscript */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleSuperscript().run()}
            isActive={editor.isActive("superscript")}
            title="Superscript"
          >
            <span className="text-xs font-bold leading-none">
              T<sup className="text-[8px]">1</sup>
            </span>
          </ToolbarButton>

          {/* Subscript */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleSubscript().run()}
            isActive={editor.isActive("subscript")}
            title="Subscript"
          >
            <span className="text-xs font-bold leading-none">
              T<sub className="text-[8px]">1</sub>
            </span>
          </ToolbarButton>

          <ToolbarDivider />

          {/* Table */}
          <ToolbarButton
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
            title="Insert Table"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 4h16v16H4V4zm2 4v4h4V8H6zm6 0v4h4V8h-4zm-6 6v4h4v-4H6zm6 0v4h4v-4h-4z" />
            </svg>
          </ToolbarButton>

          <ToolbarDivider />

          {/* Headings */}
          <ToolbarButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
            isActive={editor.isActive("heading", { level: 1 })}
            title="Heading 1"
          >
            <span className="text-xs font-bold leading-none">H1</span>
          </ToolbarButton>
          <ToolbarButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
            isActive={editor.isActive("heading", { level: 2 })}
            title="Heading 2"
          >
            <span className="text-xs font-bold leading-none">H2</span>
          </ToolbarButton>
          <ToolbarButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
            isActive={editor.isActive("heading", { level: 3 })}
            title="Heading 3"
          >
            <span className="text-xs font-bold leading-none">H3</span>
          </ToolbarButton>

          <ToolbarDivider />

          {/* Undo / Redo */}
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo (Ctrl+Z)"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 10h10a5 5 0 0 1 0 10H9m-6-10 4-4m-4 4 4 4"
              />
            </svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo (Ctrl+Shift+Z)"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 10H11a5 5 0 0 0 0 10h4m6-10-4-4m4 4-4 4"
              />
            </svg>
          </ToolbarButton>
        </div>
      )}

      {/* Editor area — always white like a real document page */}
      <div className="bg-gray-100 dark:bg-gray-950 p-4">
        <div className="bg-white rounded shadow-sm max-w-[210mm] mx-auto text-black [&_.ProseMirror]:text-black [&_.ProseMirror]:caret-black [&_.ProseMirror_p]:text-black">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
