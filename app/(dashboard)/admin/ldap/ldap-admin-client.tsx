"use client";

import { useState } from "react";

/**
 * Client islands for the LDAP admin page. Two pieces:
 *   - TestButton  — POSTs to /api/admin/ldap/test and renders the result.
 *   - GroupMaps   — list + create + delete LdapGroupRoleMap rows.
 *
 * Bundled together so the server page imports a single module.
 */

interface RoleRef {
  id: string;
  name: string;
}

interface GroupMap {
  id: string;
  ldapGroup: string;
  autoApply: boolean;
  role: RoleRef;
}

function TestButton({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; userCount?: number }
    | { ok: false; error: string }
    | null
  >(null);

  async function runTest() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/ldap/test", { method: "POST" });
      const data = await res.json();
      if (data?.ok) {
        setResult({ ok: true, userCount: data.userCount });
      } else {
        setResult({ ok: false, error: data?.error || "Test failed" });
      }
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={runTest}
        disabled={disabled || busy}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {busy ? "Testing…" : "Test connection"}
      </button>
      {result && result.ok && (
        <p className="text-sm text-green-700">
          Connected.{" "}
          {typeof result.userCount === "number"
            ? `Found ${result.userCount} sample user entr${
                result.userCount === 1 ? "y" : "ies"
              } in the search base.`
            : ""}
        </p>
      )}
      {result && !result.ok && (
        <p className="text-sm text-red-700 break-all">Error: {result.error}</p>
      )}
    </div>
  );
}

function GroupMaps({
  initialMaps,
  roles,
}: {
  initialMaps: GroupMap[];
  roles: RoleRef[];
}) {
  const [maps, setMaps] = useState<GroupMap[]>(initialMaps);
  const [ldapGroup, setLdapGroup] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [autoApply, setAutoApply] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function addMap(e: React.FormEvent) {
    e.preventDefault();
    if (!ldapGroup.trim() || !roleId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ldap/group-maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ldapGroup: ldapGroup.trim(),
          roleId,
          autoApply,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Failed to add mapping");
        return;
      }
      setMaps((prev) => [...prev, data.map]);
      setLdapGroup("");
      setAutoApply(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function removeMap(id: string) {
    if (!confirm("Remove this LDAP group → role mapping?")) return;
    setDeleting(id);
    try {
      const res = await fetch("/api/admin/ldap/group-maps", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error || "Failed to delete mapping");
        return;
      }
      setMaps((prev) => prev.filter((m) => m.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="border-b border-gray-200 px-4 py-3">
        <h2 className="font-medium">Group-to-role mappings</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Match an AD group (CN or full DN) to a local role. Mappings with
          auto-apply on are re-evaluated on every LDAP sign-in.
        </p>
      </header>

      <form
        onSubmit={addMap}
        className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 items-end border-b border-gray-100"
      >
        <label className="md:col-span-5 text-sm">
          <span className="block text-gray-700 mb-1">LDAP group</span>
          <input
            type="text"
            value={ldapGroup}
            onChange={(e) => setLdapGroup(e.target.value)}
            placeholder='e.g. "Domain Admins" or "CN=Records Officers,OU=Groups,DC=karu,DC=ac,DC=ke"'
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <label className="md:col-span-4 text-sm">
          <span className="block text-gray-700 mb-1">Role</span>
          <select
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm bg-white"
          >
            {roles.length === 0 && <option value="">(no roles)</option>}
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="md:col-span-2 text-sm flex items-center gap-2 mt-5">
          <input
            type="checkbox"
            checked={autoApply}
            onChange={(e) => setAutoApply(e.target.checked)}
          />
          <span>Auto-apply</span>
        </label>
        <button
          type="submit"
          disabled={busy || !ldapGroup.trim() || !roleId}
          className="md:col-span-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {busy ? "…" : "Add"}
        </button>
        {error && (
          <div className="md:col-span-12 text-sm text-red-700">{error}</div>
        )}
      </form>

      {maps.length === 0 ? (
        <p className="p-4 text-sm text-gray-500">No mappings yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left px-4 py-2 font-medium">LDAP group</th>
              <th className="text-left px-4 py-2 font-medium">Role</th>
              <th className="text-left px-4 py-2 font-medium">Auto-apply</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {maps.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2 font-mono text-xs break-all">
                  {m.ldapGroup}
                </td>
                <td className="px-4 py-2">{m.role.name}</td>
                <td className="px-4 py-2">
                  {m.autoApply ? (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
                      On
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      Off
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeMap(m.id)}
                    disabled={deleting === m.id}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    {deleting === m.id ? "Removing…" : "Remove"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export const LdapAdminClient = { TestButton, GroupMaps };
