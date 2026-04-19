"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Can } from "@/components/auth/can";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ClassificationNode {
  id: string;
  code: string;
  title: string;
  description: string | null;
  level: number;
  isActive: boolean;
  children: ClassificationNode[];
  _count: { documents: number; children: number };
}

interface ModalState {
  open: boolean;
  mode: "create" | "edit";
  parentId: string | null;
  level: number;
  node: ClassificationNode | null;
}

const LEVEL_LABELS: Record<number, string> = {
  1: "Function",
  2: "Activity",
  3: "Transaction",
};

const INITIAL_MODAL: ModalState = {
  open: false,
  mode: "create",
  parentId: null,
  level: 1,
  node: null,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function countByLevel(
  nodes: ClassificationNode[],
  level: number
): number {
  let count = 0;
  for (const n of nodes) {
    if (n.level === level) count++;
    if (n.children?.length) count += countByLevel(n.children, level);
  }
  return count;
}

function filterTree(
  nodes: ClassificationNode[],
  query: string
): ClassificationNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();
  return nodes.reduce<ClassificationNode[]>((acc, node) => {
    const matchesSelf =
      node.code.toLowerCase().includes(q) ||
      node.title.toLowerCase().includes(q);
    const filteredChildren = filterTree(node.children ?? [], query);
    if (matchesSelf || filteredChildren.length > 0) {
      acc.push({ ...node, children: filteredChildren });
    }
    return acc;
  }, []);
}

/* ------------------------------------------------------------------ */
/*  Spinner SVG (inline)                                               */
/* ------------------------------------------------------------------ */

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Tree Row                                                           */
/* ------------------------------------------------------------------ */

function TreeRow({
  node,
  expanded,
  onToggle,
  onEdit,
  onAddChild,
  onDeactivate,
  searchQuery,
  expandedIds,
  onToggleId,
  onEditNode,
  onAddChildNode,
  onDeactivateNode,
}: {
  node: ClassificationNode;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAddChild: () => void;
  onDeactivate: () => void;
  searchQuery: string;
  expandedIds: Set<string>;
  onToggleId: (id: string) => void;
  onEditNode: (node: ClassificationNode) => void;
  onAddChildNode: (parentId: string, level: number) => void;
  onDeactivateNode: (node: ClassificationNode) => void;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isInactive = !node.isActive;

  /* indent + border styles per level */
  const levelStyles: Record<number, { indent: string; border: string; bg: string }> = {
    1: {
      indent: "pl-3",
      border: "border-l-4 border-l-[#02773b]",
      bg: "hover:bg-[#02773b]/5 dark:hover:bg-[#02773b]/10",
    },
    2: {
      indent: "pl-10",
      border: "border-l-4 border-l-[#dd9f42]",
      bg: "hover:bg-[#dd9f42]/5 dark:hover:bg-[#dd9f42]/10",
    },
    3: {
      indent: "pl-16",
      border: "border-l-4 border-l-gray-300 dark:border-l-gray-600",
      bg: "hover:bg-gray-50 dark:hover:bg-gray-800/50",
    },
  };

  const style = levelStyles[node.level] ?? levelStyles[3];

  return (
    <>
      <div
        className={`group flex items-center gap-3 pr-4 py-2.5 transition-colors ${style.indent} ${style.border} ${style.bg} ${
          isInactive ? "opacity-50" : ""
        }`}
      >
        {/* Expand / collapse chevron */}
        <button
          onClick={onToggle}
          className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-colors ${
            hasChildren
              ? "text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              : "text-transparent cursor-default"
          }`}
          disabled={!hasChildren}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${
              expanded ? "rotate-90" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m8.25 4.5 7.5 7.5-7.5 7.5"
            />
          </svg>
        </button>

        {/* Code badge */}
        <span
          className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-semibold ${
            node.level === 1
              ? "bg-[#02773b]/10 text-[#02773b] dark:bg-[#02773b]/20 dark:text-emerald-400"
              : node.level === 2
              ? "bg-[#dd9f42]/10 text-[#dd9f42] dark:bg-[#dd9f42]/20 dark:text-amber-400"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
          }`}
        >
          {node.code}
        </span>

        {/* Title */}
        <span
          className={`flex-1 truncate ${
            node.level === 1
              ? "text-sm font-bold text-gray-900 dark:text-gray-100"
              : node.level === 2
              ? "text-sm font-medium text-gray-800 dark:text-gray-200"
              : "text-xs font-normal text-gray-700 dark:text-gray-300"
          }`}
        >
          {node.title}
        </span>

        {/* Inactive badge */}
        {isInactive && (
          <span className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400">
            Inactive
          </span>
        )}

        {/* Doc count (level 1 only) */}
        {node.level === 1 && node._count.documents > 0 && (
          <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
              />
            </svg>
            {node._count.documents}
          </span>
        )}

        {/* Children count badge */}
        {node._count.children > 0 && (
          <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
              />
            </svg>
            {node._count.children}
          </span>
        )}

        {/* Action buttons — visible on hover */}
        <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Edit */}
          <Can anyOf={["records:update", "records:manage"]}>
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg text-gray-400 hover:text-[#02773b] hover:bg-[#02773b]/10 dark:hover:bg-[#02773b]/20 transition-colors"
              title="Edit"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                />
              </svg>
            </button>
          </Can>

          {/* Add child (only level 1 and 2) */}
          {node.level < 3 && (
            <Can anyOf={["records:create", "records:manage"]}>
              <button
                onClick={onAddChild}
                className="p-1.5 rounded-lg text-gray-400 hover:text-[#dd9f42] hover:bg-[#dd9f42]/10 dark:hover:bg-[#dd9f42]/20 transition-colors"
                title={`Add ${LEVEL_LABELS[node.level + 1]}`}
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
              </button>
            </Can>
          )}

          {/* Deactivate / Reactivate */}
          <Can anyOf={["records:delete", "records:manage"]}>
            <button
              onClick={onDeactivate}
              className={`p-1.5 rounded-lg transition-colors ${
                node.isActive
                  ? "text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  : "text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"
              }`}
              title={node.isActive ? "Deactivate" : "Reactivate"}
            >
              {node.isActive ? (
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
              ) : (
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                  />
                </svg>
              )}
            </button>
          </Can>
        </div>
      </div>

      {/* Render children when expanded */}
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <TreeRow
            key={child.id}
            node={child}
            expanded={expandedIds.has(child.id)}
            onToggle={() => onToggleId(child.id)}
            onEdit={() => onEditNode(child)}
            onAddChild={() => onAddChildNode(child.id, child.level + 1)}
            onDeactivate={() => onDeactivateNode(child)}
            searchQuery={searchQuery}
            expandedIds={expandedIds}
            onToggleId={onToggleId}
            onEditNode={onEditNode}
            onAddChildNode={onAddChildNode}
            onDeactivateNode={onDeactivateNode}
          />
        ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page Component                                                */
/* ------------------------------------------------------------------ */

export default function ClassificationPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "loading") return;
    const p = session?.user?.permissions ?? [];
    if (!p.includes("admin:manage") && !p.includes("records_classification:read")) router.replace("/records/casefolders");
  }, [session, status, router]);
  /* ---- data state ---- */
  const [tree, setTree] = useState<ClassificationNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---- UI state ---- */
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalState>(INITIAL_MODAL);

  /* ---- form state ---- */
  const [formCode, setFormCode] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* ---- fetch tree ---- */
  const fetchTree = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/records/classification");
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to load classification scheme");
      }
      const data = await res.json();
      setTree(data.tree ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  /* ---- filtered tree ---- */
  const filteredTree = useMemo(() => filterTree(tree, search), [tree, search]);

  /* ---- stats ---- */
  const stats = useMemo(
    () => ({
      functions: countByLevel(tree, 1),
      activities: countByLevel(tree, 2),
      transactions: countByLevel(tree, 3),
    }),
    [tree]
  );

  /* ---- expand / collapse helpers ---- */
  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    const ids = new Set<string>();
    function walk(nodes: ClassificationNode[]) {
      for (const n of nodes) {
        if (n.children?.length) {
          ids.add(n.id);
          walk(n.children);
        }
      }
    }
    walk(filteredTree);
    setExpandedIds(ids);
  }

  function collapseAll() {
    setExpandedIds(new Set());
  }

  /* ---- auto-expand when searching ---- */
  useEffect(() => {
    if (search.trim()) {
      expandAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, tree]);

  /* ---- modal openers ---- */
  function openCreateModal(parentId: string | null, level: number) {
    setFormCode("");
    setFormTitle("");
    setFormDescription("");
    setFormError(null);
    setModal({ open: true, mode: "create", parentId, level, node: null });
  }

  function openEditModal(node: ClassificationNode) {
    setFormCode(node.code);
    setFormTitle(node.title);
    setFormDescription(node.description ?? "");
    setFormError(null);
    setModal({
      open: true,
      mode: "edit",
      parentId: null,
      level: node.level,
      node,
    });
  }

  function closeModal() {
    setModal(INITIAL_MODAL);
  }

  /* ---- form submit ---- */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    try {
      if (modal.mode === "create") {
        const body: Record<string, unknown> = {
          code: formCode,
          title: formTitle,
          level: modal.level,
        };
        if (formDescription.trim()) body.description = formDescription;
        if (modal.parentId) body.parentId = modal.parentId;

        const res = await fetch("/api/records/classification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Failed to create classification");
        }
      } else if (modal.mode === "edit" && modal.node) {
        const body: Record<string, unknown> = {
          code: formCode,
          title: formTitle,
          description: formDescription.trim() || null,
        };
        const res = await fetch(
          `/api/records/classification/${modal.node.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Failed to update classification");
        }
      }
      closeModal();
      await fetchTree();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  }

  /* ---- deactivate / reactivate ---- */
  async function handleDeactivate(node: ClassificationNode) {
    try {
      if (node.isActive) {
        const res = await fetch(`/api/records/classification/${node.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Failed to deactivate");
        }
      } else {
        const res = await fetch(`/api/records/classification/${node.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: true }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Failed to reactivate");
        }
      }
      await fetchTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* ---------- Header ---------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            File Classification Scheme
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage the hierarchical classification of records &mdash; Functions,
            Activities, and Transactions
          </p>
        </div>

        <Can anyOf={["records:create", "records:manage"]}>
          <button
            onClick={() => openCreateModal(null, 1)}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-[#02773b] text-white font-medium text-sm transition-all hover:bg-[#025f2f] focus:ring-2 focus:ring-[#02773b]/30 focus:ring-offset-2 whitespace-nowrap"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
            New Function
          </button>
        </Can>
      </div>

      {/* ---------- Stats ---------- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            label: "Functions",
            value: stats.functions,
            color: "bg-[#02773b]",
            light: "bg-[#02773b]/10 dark:bg-[#02773b]/20",
            text: "text-[#02773b] dark:text-emerald-400",
          },
          {
            label: "Activities",
            value: stats.activities,
            color: "bg-[#dd9f42]",
            light: "bg-[#dd9f42]/10 dark:bg-[#dd9f42]/20",
            text: "text-[#dd9f42] dark:text-amber-400",
          },
          {
            label: "Transactions",
            value: stats.transactions,
            color: "bg-gray-500",
            light: "bg-gray-100 dark:bg-gray-800",
            text: "text-gray-600 dark:text-gray-400",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 flex items-center gap-4"
          >
            <div
              className={`w-11 h-11 rounded-xl ${s.light} flex items-center justify-center`}
            >
              <div className={`w-3 h-3 rounded-full ${s.color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {isLoading ? (
                  <span className="inline-block w-8 h-6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                ) : (
                  s.value
                )}
              </p>
              <p className={`text-xs font-medium ${s.text}`}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ---------- Search & controls ---------- */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Search input */}
          <div className="relative flex-1">
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                />
              </svg>
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by code or title..."
              className="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 pl-9 pr-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
            />
          </div>

          {/* Expand / Collapse buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={expandAll}
              className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Collapse All
            </button>
          </div>
        </div>
      </div>

      {/* ---------- Error ---------- */}
      {error && (
        <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-red-500 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
            <p className="text-sm text-red-700 dark:text-red-400 flex-1">
              {error}
            </p>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-600 transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ---------- Tree ---------- */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        {/* Column header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <span className="w-6" />
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Code
          </span>
          <span className="flex-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Title
          </span>
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider pr-4">
            Actions
          </span>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="w-6 h-6 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                <div
                  className="h-5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse"
                  style={{ width: `${60 + (i % 3) * 20}px` }}
                />
                <div
                  className="h-4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse flex-1"
                  style={{ maxWidth: `${120 + Math.random() * 200}px` }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filteredTree.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <svg
              className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={0.75}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776"
              />
            </svg>
            <p className="text-gray-500 dark:text-gray-400 font-medium">
              {search
                ? "No classifications match your search"
                : "No classification scheme yet"}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {search
                ? "Try a different search term"
                : 'Click "New Function" to create the first level'}
            </p>
          </div>
        )}

        {/* Tree rows */}
        {!isLoading && filteredTree.length > 0 && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
            {filteredTree.map((node) => (
              <TreeRow
                key={node.id}
                node={node}
                expanded={expandedIds.has(node.id)}
                onToggle={() => toggleExpanded(node.id)}
                onEdit={() => openEditModal(node)}
                onAddChild={() => openCreateModal(node.id, node.level + 1)}
                onDeactivate={() => handleDeactivate(node)}
                searchQuery={search}
                expandedIds={expandedIds}
                onToggleId={toggleExpanded}
                onEditNode={openEditModal}
                onAddChildNode={openCreateModal}
                onDeactivateNode={handleDeactivate}
              />
            ))}
          </div>
        )}
      </div>

      {/* ---------- Create / Edit Modal ---------- */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeModal}
          />

          {/* Panel */}
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {modal.mode === "create"
                    ? `New ${LEVEL_LABELS[modal.level] ?? "Item"}`
                    : `Edit ${LEVEL_LABELS[modal.level] ?? "Item"}`}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Level {modal.level} &mdash;{" "}
                  {LEVEL_LABELS[modal.level] ?? "Unknown"}
                </p>
              </div>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
                  <p className="text-sm text-red-700 dark:text-red-400">
                    {formError}
                  </p>
                </div>
              )}

              {/* Code */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Code
                </label>
                <input
                  type="text"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  required
                  placeholder="e.g. FN-001 or FN-001-ACT-01"
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm font-mono text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
                />
              </div>

              {/* Title */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Title
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  required
                  placeholder={`${LEVEL_LABELS[modal.level] ?? "Item"} title`}
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Description{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={3}
                  placeholder="Brief description of this classification node..."
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none resize-none"
                />
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-[#02773b] text-white text-sm font-medium hover:bg-[#025f2f] transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {saving && <Spinner />}
                  {modal.mode === "create"
                    ? `Create ${LEVEL_LABELS[modal.level] ?? "Item"}`
                    : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
