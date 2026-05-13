import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ldapEnabled } from "@/lib/ldap";
import { LdapAdminClient } from "./ldap-admin-client";

/**
 * Admin → LDAP / Active Directory.
 *
 * Server component that gates on the admin:manage permission, gathers
 * env-derived configuration + DB state, and hands it off to the client
 * island for interactive bits (Test connection button, mapping CRUD).
 *
 * Like the SSO page, configuration itself lives in env vars (12-factor):
 * the page shows what's wired up, but doesn't let admins edit secrets
 * through the UI.
 */
export const dynamic = "force-dynamic";

export default async function LdapAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.permissions?.includes("admin:manage")) {
    return <div className="p-6 text-red-600">Forbidden</div>;
  }

  const enabled = ldapEnabled();
  const url = process.env.LDAP_URL ?? "";
  const bindDn = process.env.LDAP_BIND_DN ?? "";
  const bindPasswordSet = !!process.env.LDAP_BIND_PASSWORD;
  const userSearchBase = process.env.LDAP_USER_SEARCH_BASE ?? "";
  const userSearchFilter =
    process.env.LDAP_USER_SEARCH_FILTER ||
    "(&(objectClass=user)(sAMAccountName={username}))";
  const groupSearchBase = process.env.LDAP_GROUP_SEARCH_BASE || userSearchBase;
  const groupSearchFilter =
    process.env.LDAP_GROUP_SEARCH_FILTER || "(&(objectClass=group)(member={dn}))";
  const userDomain = process.env.LDAP_USER_DOMAIN ?? "";

  const [roles, maps, recentlySynced] = await Promise.all([
    db.role.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.ldapGroupRoleMap.findMany({
      orderBy: { createdAt: "asc" },
      include: { role: { select: { id: true, name: true } } },
    }),
    db.user.findMany({
      where: { ldapDn: { not: null } },
      orderBy: { ldapSyncedAt: "desc" },
      take: 20,
      select: {
        id: true,
        email: true,
        displayName: true,
        ldapDn: true,
        ldapSyncedAt: true,
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">LDAP / Active Directory</h1>
        <p className="text-sm text-gray-600 mt-1">
          Bind EDRMS authentication to your organisation&apos;s directory
          service. Configuration is supplied through environment variables
          and read at startup. Group-to-role mappings (below) are managed
          live and applied on every LDAP sign-in.
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white">
        <header className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <h2 className="font-medium">Connection</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              enabled ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                enabled ? "bg-green-600" : "bg-amber-600"
              }`}
            />
            {enabled ? "Configured" : "Not configured"}
          </span>
        </header>
        <dl className="divide-y divide-gray-100 text-sm">
          <Row label="LDAP URL" value={url || unset()} mono />
          <Row label="Bind DN (service account)" value={bindDn || unset()} mono />
          <Row
            label="Bind password"
            value={
              bindPasswordSet ? (
                <span className="text-gray-600">●●●●●●●● (set)</span>
              ) : (
                unset()
              )
            }
          />
          <Row label="User search base" value={userSearchBase || unset()} mono />
          <Row label="User search filter" value={userSearchFilter} mono />
          <Row label="Group search base" value={groupSearchBase || unset()} mono />
          <Row label="Group search filter" value={groupSearchFilter} mono />
          <Row
            label="Email fallback domain"
            value={userDomain || <span className="text-gray-400 italic">(unset — entries without mail will be rejected)</span>}
            mono
          />
        </dl>
        <div className="border-t border-gray-100 p-4">
          <LdapAdminClient.TestButton disabled={!enabled} />
        </div>
      </section>

      <LdapAdminClient.GroupMaps initialMaps={maps} roles={roles} />

      <section className="rounded-lg border border-gray-200 bg-white">
        <header className="border-b border-gray-200 px-4 py-3">
          <h2 className="font-medium">Recently synced users</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            The last 20 users to authenticate via LDAP, with the DN
            captured on their most recent sign-in.
          </p>
        </header>
        {recentlySynced.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No LDAP sign-ins yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">User</th>
                <th className="text-left px-4 py-2 font-medium">LDAP DN</th>
                <th className="text-left px-4 py-2 font-medium">Last synced</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentlySynced.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{u.displayName}</div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs break-all text-gray-700">
                    {u.ldapDn}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {u.ldapSyncedAt
                      ? new Date(u.ldapSyncedAt).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h2 className="font-medium mb-2">Environment variables</h2>
        <p className="text-sm text-gray-600 mb-3">
          Set these in your <code className="bg-white px-1 rounded border">.env</code>{" "}
          (or deployment platform&apos;s secret store) and restart the app.
        </p>
        <pre className="bg-white border border-gray-200 rounded p-3 text-xs overflow-x-auto">
{`LDAP_URL="ldaps://dc.karu.ac.ke:636"
LDAP_BIND_DN="CN=edrms-svc,CN=Users,DC=karu,DC=ac,DC=ke"
LDAP_BIND_PASSWORD="..."
LDAP_USER_SEARCH_BASE="DC=karu,DC=ac,DC=ke"
LDAP_USER_SEARCH_FILTER="(&(objectClass=user)(sAMAccountName={username}))"   # optional
LDAP_GROUP_SEARCH_BASE="DC=karu,DC=ac,DC=ke"                                  # optional
LDAP_GROUP_SEARCH_FILTER="(&(objectClass=group)(member={dn}))"               # optional
LDAP_USER_DOMAIN="karu.ac.ke"   # optional: fallback email when AD has no mail attr`}
        </pre>
        <ul className="mt-3 text-xs text-gray-600 space-y-1 list-disc list-inside">
          <li>
            <strong>LDAP_URL / LDAP_BIND_DN / LDAP_BIND_PASSWORD</strong> —
            required. Without all three the LDAP sign-in option is hidden
            from the login page.
          </li>
          <li>
            User filter token <code>{`{username}`}</code> and group filter
            token <code>{`{dn}`}</code> are LDAP-escaped before
            substitution.
          </li>
          <li>
            On each LDAP sign-in the user&apos;s roles are rebuilt from the
            mappings below (rows with auto-apply on). Roles that aren&apos;t
            referenced by any mapping are left alone, so admin-granted
            local-only roles aren&apos;t wiped.
          </li>
        </ul>
      </section>
    </div>
  );
}

function unset() {
  return <span className="text-gray-400 italic">(unset)</span>;
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-4 px-4 py-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className={`col-span-2 break-all ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
