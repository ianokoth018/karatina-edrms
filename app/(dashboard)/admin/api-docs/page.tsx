"use client";

import { useEffect, useState } from "react";
import { usePermissions } from "@/lib/use-permissions";

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: { type?: string };
}

interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: unknown;
}

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

interface OpenApiPathItem extends Partial<Record<HttpMethod, OpenApiOperation>> {
  parameters?: OpenApiParameter[];
}

interface OpenApiTag {
  name: string;
  description?: string;
}

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  tags?: OpenApiTag[];
  paths: Record<string, OpenApiPathItem>;
  components?: {
    securitySchemes?: Record<string, { type: string; in?: string; name?: string; description?: string }>;
  };
}

const METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete"];

const METHOD_STYLES: Record<HttpMethod, string> = {
  get: "bg-blue-100 text-blue-800 ring-blue-200",
  post: "bg-green-100 text-green-800 ring-green-200",
  put: "bg-amber-100 text-amber-800 ring-amber-200",
  patch: "bg-amber-100 text-amber-800 ring-amber-200",
  delete: "bg-red-100 text-red-800 ring-red-200",
};

interface Row {
  method: HttpMethod;
  path: string;
  op: OpenApiOperation;
  pathParams: OpenApiParameter[];
}

export default function ApiDocsPage() {
  const { can, ready } = usePermissions();
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/openapi");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as OpenApiSpec;
        if (!cancelled) setSpec(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return <div className="p-6 text-gray-500">Loading…</div>;
  }
  if (!can("admin:manage")) {
    return <div className="p-6 text-red-600">Forbidden</div>;
  }
  if (loading) {
    return <div className="p-6 text-gray-500">Loading spec…</div>;
  }
  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          Failed to load OpenAPI spec: {error}
        </div>
      </div>
    );
  }
  if (!spec) {
    return <div className="p-6 text-gray-500">No spec available.</div>;
  }

  const grouped = groupByTag(spec);
  const tagOrder: string[] = spec.tags?.length
    ? spec.tags.map((t) => t.name)
    : Object.keys(grouped).sort();
  const tagInfo = new Map<string, OpenApiTag>();
  for (const t of spec.tags ?? []) tagInfo.set(t.name, t);

  const apiKeyScheme = spec.components?.securitySchemes?.apiKey;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold mb-1">{spec.info.title}</h1>
      <p className="text-sm text-gray-500 mb-1">
        OpenAPI {spec.openapi} · version {spec.info.version}
      </p>
      {spec.info.description && (
        <p className="text-sm text-gray-700 mb-4">{spec.info.description}</p>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <a
          href="/api/openapi"
          className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
        >
          Download JSON
        </a>
        {apiKeyScheme && (
          <span className="text-gray-600">
            Auth:{" "}
            <code className="rounded bg-gray-100 px-1 py-0.5">
              {apiKeyScheme.in}: {apiKeyScheme.name}
            </code>
          </span>
        )}
      </div>

      {tagOrder.map((tag) => {
        const rows = grouped[tag];
        if (!rows || rows.length === 0) return null;
        const info = tagInfo.get(tag);
        return (
          <section key={tag} className="mb-8">
            <h2 className="text-lg font-semibold mb-1">{tag}</h2>
            {info?.description && (
              <p className="text-sm text-gray-600 mb-3">{info.description}</p>
            )}
            <div className="overflow-hidden rounded-md border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2 w-20">Method</th>
                    <th className="px-3 py-2">Path</th>
                    <th className="px-3 py-2">Summary</th>
                    <th className="px-3 py-2">Params</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => (
                    <tr key={`${r.method}-${r.path}`} className="align-top">
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-xs font-mono font-semibold ring-1 ring-inset ${METHOD_STYLES[r.method]}`}
                        >
                          {r.method.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs break-all">
                        {r.path}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {r.op.summary ?? r.op.description ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        <ParamList
                          params={[...(r.pathParams ?? []), ...(r.op.parameters ?? [])]}
                          hasBody={Boolean(r.op.requestBody)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ParamList({
  params,
  hasBody,
}: {
  params: OpenApiParameter[];
  hasBody: boolean;
}) {
  if (params.length === 0 && !hasBody) {
    return <span className="text-gray-400">none</span>;
  }
  return (
    <ul className="space-y-0.5">
      {params.map((p) => (
        <li key={`${p.in}-${p.name}`}>
          <code className="rounded bg-gray-100 px-1 py-0.5">{p.name}</code>{" "}
          <span className="text-gray-500">
            ({p.in}
            {p.required ? ", required" : ""})
          </span>
        </li>
      ))}
      {hasBody && (
        <li>
          <span className="text-gray-500">JSON body</span>
        </li>
      )}
    </ul>
  );
}

function groupByTag(spec: OpenApiSpec): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const [path, item] of Object.entries(spec.paths)) {
    const pathParams = item.parameters ?? [];
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const tags = op.tags?.length ? op.tags : ["Other"];
      for (const tag of tags) {
        if (!out[tag]) out[tag] = [];
        out[tag].push({ method, path, op, pathParams });
      }
    }
  }
  for (const tag of Object.keys(out)) {
    out[tag].sort((a, b) => {
      if (a.path === b.path) return a.method.localeCompare(b.method);
      return a.path.localeCompare(b.path);
    });
  }
  return out;
}
