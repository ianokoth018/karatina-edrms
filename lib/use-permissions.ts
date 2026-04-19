"use client";

import { useSession } from "next-auth/react";
import { useMemo } from "react";

/**
 * Centralized permission hook. Admins (`admin:manage`) bypass all checks.
 *
 * Usage:
 *   const { can, canAny, canAll, isAdmin, ready } = usePermissions();
 *   if (can("memos:create")) { ... }
 */
export function usePermissions() {
  const { data: session, status } = useSession();

  return useMemo(() => {
    const permissions: string[] = session?.user?.permissions ?? [];
    const roles: string[] = session?.user?.roles ?? [];
    const isAdmin = permissions.includes("admin:manage");
    const ready = status !== "loading";

    const can = (permission?: string | null) => {
      if (!permission) return true;
      return isAdmin || permissions.includes(permission);
    };

    const canAny = (needed: readonly string[]) => {
      if (!needed.length) return true;
      return isAdmin || needed.some((p) => permissions.includes(p));
    };

    const canAll = (needed: readonly string[]) => {
      if (!needed.length) return true;
      return isAdmin || needed.every((p) => permissions.includes(p));
    };

    return { can, canAny, canAll, isAdmin, ready, permissions, roles, status };
  }, [session, status]);
}
