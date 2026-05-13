"use client";

import { useEffect, useMemo, useState } from "react";
import type { Node } from "reactflow";

interface FormTemplateLite {
  id: string;
  name: string;
  fields: { name: string; label: string; type: string }[];
}

interface FormDataDatasetLite {
  id: string;
  name: string;
  slug: string;
  fields: { name: string; label: string; type: string }[];
}

interface WorkflowVariable {
  /** The token to copy/insert, e.g. `formData.applicant_name`. Wrapped in
   *  `{{…}}` when inserted into a template field. */
  expr: string;
  /** Human-readable label. */
  label: string;
  /** Group heading. */
  group: string;
  /** Type hint shown to the right. */
  type?: string;
  /** Where this variable comes from (e.g. node id or "system"). */
  origin?: string;
}

interface VariablesPanelProps {
  nodes: Node[];
  /** Optional: passed in from the designer if it already loaded these. */
  formTemplates?: FormTemplateLite[];
  fdDatasets?: FormDataDatasetLite[];
}

/**
 * Workflow-wide variables explorer. Lists every variable the engine could
 * resolve at runtime: form fields from the start node's entry form, defaults,
 * lookup_form_data injections, task custom fields, and the workflow context.
 *
 * Designed to live alongside the node config panel so a user editing an
 * expression field can click any variable to copy its `{{expr}}` token to
 * the clipboard, then paste it into the field they're editing.
 */
export default function VariablesPanel({
  nodes,
  formTemplates: providedFormTemplates,
  fdDatasets: providedFdDatasets,
}: VariablesPanelProps) {
  const [formTemplates, setFormTemplates] = useState<FormTemplateLite[]>(
    providedFormTemplates ?? []
  );
  const [fdDatasets, setFdDatasets] = useState<FormDataDatasetLite[]>(
    providedFdDatasets ?? []
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // If the parent didn't provide the registries, fetch them ourselves so
  // this panel works standalone.
  useEffect(() => {
    if (providedFormTemplates) return;
    let cancelled = false;
    fetch("/api/forms?fields=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list = (data.templates ?? data.items ?? data ?? []) as FormTemplateLite[];
        setFormTemplates(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [providedFormTemplates]);

  useEffect(() => {
    if (providedFdDatasets) return;
    let cancelled = false;
    fetch("/api/form-data")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list = (data.schemas ?? data.items ?? data ?? []) as FormDataDatasetLite[];
        setFdDatasets(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [providedFdDatasets]);

  const variables = useMemo<WorkflowVariable[]>(() => {
    const vars: WorkflowVariable[] = [];

    // 1. Form fields from the start node's entry form template.
    const startNode = nodes.find((n) => n.type === "start");
    const entryTplId = (startNode?.data as { entryFormTemplateId?: string })
      ?.entryFormTemplateId;
    if (entryTplId) {
      const tpl = formTemplates.find((t) => t.id === entryTplId);
      if (tpl) {
        for (const f of tpl.fields) {
          vars.push({
            expr: `formData.${f.name}`,
            label: f.label || f.name,
            group: `Entry form: ${tpl.name}`,
            type: f.type,
            origin: "start",
          });
        }
      }
    }

    // 2. Variable defaults declared on the start node.
    const defaults =
      (startNode?.data as {
        variableDefaults?: { name: string; value: string }[];
      })?.variableDefaults ?? [];
    for (const d of defaults) {
      if (!d.name) continue;
      vars.push({
        expr: d.name,
        label: d.name,
        group: "Initial variables",
        type: "any",
        origin: "start",
      });
    }

    // 3. lookup_form_data injections from system nodes.
    for (const n of nodes) {
      const actions = (n.data as {
        systemActions?: { type?: string; config?: Record<string, unknown> }[];
      })?.systemActions;
      if (!Array.isArray(actions)) continue;
      for (const a of actions) {
        if (a.type !== "lookup_form_data") continue;
        const prefix = (a.config?.resultPrefix as string) ?? "";
        const slug = (a.config?.slug as string) ?? "";
        const ds = fdDatasets.find((d) => d.slug === slug);
        const dsName = ds?.name ?? slug;
        for (const f of ds?.fields ?? []) {
          vars.push({
            expr: `_lookup_${prefix}.${f.name}`,
            label: `${prefix} · ${f.label || f.name}`,
            group: `Lookup: ${dsName}`,
            type: f.type,
            origin: n.id,
          });
        }
      }
    }
    // Legacy single-action format on system nodes (actionType / actionConfig).
    for (const n of nodes) {
      const data = n.data as {
        actionType?: string;
        actionConfig?: Record<string, unknown>;
      };
      if (data?.actionType !== "lookup_form_data") continue;
      const cfg = data.actionConfig ?? {};
      const slug = (cfg.slug as string) ?? "";
      const injectAs =
        (cfg.injectAs as string) ?? (slug ? `_lookup_${slug}` : "");
      const ds = fdDatasets.find((d) => d.slug === slug);
      const dsName = ds?.name ?? slug;
      for (const f of ds?.fields ?? []) {
        vars.push({
          expr: `${injectAs}.${f.name}`,
          label: f.label || f.name,
          group: `Lookup: ${dsName}`,
          type: f.type,
          origin: n.id,
        });
      }
    }

    // 4. Task node custom fields — these are written back into formData when
    //    the task completes, so downstream nodes can read them.
    for (const n of nodes) {
      if (n.type !== "task") continue;
      const customFields = (n.data as {
        customFields?: { name: string; label: string; type: string }[];
      })?.customFields;
      if (!Array.isArray(customFields)) continue;
      const taskLabel = (n.data as { label?: string })?.label ?? n.id;
      for (const f of customFields) {
        if (!f.name) continue;
        vars.push({
          expr: `formData.${f.name}`,
          label: f.label || f.name,
          group: `Task: ${taskLabel}`,
          type: f.type,
          origin: n.id,
        });
      }
    }

    // 5. Engine-provided context.
    vars.push(
      {
        expr: "_actor",
        label: "Last actor (user id)",
        group: "Context",
        type: "string",
      },
      {
        expr: "_action",
        label: "Last action (APPROVED / REJECTED / RETURNED)",
        group: "Context",
        type: "string",
      },
      {
        expr: "instance.status",
        label: "Workflow status",
        group: "Context",
        type: "string",
      }
    );

    return vars;
  }, [nodes, formTemplates, fdDatasets]);

  const filtered = useMemo(() => {
    if (!query.trim()) return variables;
    const q = query.trim().toLowerCase();
    return variables.filter(
      (v) =>
        v.expr.toLowerCase().includes(q) ||
        v.label.toLowerCase().includes(q) ||
        v.group.toLowerCase().includes(q)
    );
  }, [variables, query]);

  const grouped = useMemo(() => {
    const out = new Map<string, WorkflowVariable[]>();
    for (const v of filtered) {
      if (!out.has(v.group)) out.set(v.group, []);
      out.get(v.group)!.push(v);
    }
    return out;
  }, [filtered]);

  async function copyExpr(expr: string) {
    const wrapped = `{{${expr}}}`;
    try {
      await navigator.clipboard.writeText(wrapped);
      setCopied(expr);
      setTimeout(() => setCopied((s) => (s === expr ? null : s)), 1400);
    } catch {
      // ignore — older browsers / clipboard denied
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Available Variables
        </h4>
        <span className="text-[10px] text-gray-400">
          {filtered.length}
          {filtered.length !== variables.length && ` / ${variables.length}`}
        </span>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search variables…"
        className="w-full h-7 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green"
      />

      {variables.length === 0 && (
        <p className="text-[11px] italic text-gray-400">
          Bind an entry form on the start node or add a lookup_form_data
          action to populate this list.
        </p>
      )}

      <div className="max-h-72 space-y-2 overflow-auto pr-1">
        {Array.from(grouped.entries()).map(([group, items]) => (
          <div key={group}>
            <div className="mb-0.5 text-[10px] font-semibold uppercase text-gray-400">
              {group}
            </div>
            <ul className="space-y-0.5">
              {items.map((v) => (
                <li key={`${group}:${v.expr}`}>
                  <button
                    type="button"
                    onClick={() => copyExpr(v.expr)}
                    title={`Click to copy {{${v.expr}}}`}
                    className="group flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left hover:bg-karu-green/5"
                  >
                    <span className="flex-1 truncate">
                      <code className="font-mono text-[11px] text-karu-green">
                        {v.expr}
                      </code>
                      <span className="ml-1 text-[10px] text-gray-500 dark:text-gray-400">
                        {v.label}
                      </span>
                    </span>
                    {copied === v.expr ? (
                      <span className="text-[10px] font-semibold text-karu-green">
                        Copied!
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-300 opacity-0 group-hover:opacity-100">
                        Copy
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
