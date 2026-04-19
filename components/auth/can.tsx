"use client";

import type { ReactNode } from "react";
import { usePermissions } from "@/lib/use-permissions";

interface CanProps {
  /** Single permission required (e.g. "memos:create"). */
  permission?: string;
  /** User must have at least one of these. */
  anyOf?: readonly string[];
  /** User must have all of these. */
  allOf?: readonly string[];
  /** Render children only while the session is still loading (avoid flicker). Defaults to false — hide until ready. */
  showWhileLoading?: boolean;
  /** Optional fallback rendered when access is denied. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Declarative permission gate. Admins (`admin:manage`) always see children.
 *
 *   <Can permission="memos:create"><NewMemoButton /></Can>
 *   <Can anyOf={["records:manage","admin:manage"]}>...</Can>
 *   <Can allOf={["workflows:read","workflows:approve"]}>...</Can>
 */
export function Can({
  permission,
  anyOf,
  allOf,
  showWhileLoading = false,
  fallback = null,
  children,
}: CanProps) {
  const { can, canAny, canAll, ready } = usePermissions();

  if (!ready) return showWhileLoading ? <>{children}</> : <>{fallback}</>;

  const ok =
    (permission ? can(permission) : true) &&
    (anyOf ? canAny(anyOf) : true) &&
    (allOf ? canAll(allOf) : true);

  return <>{ok ? children : fallback}</>;
}
