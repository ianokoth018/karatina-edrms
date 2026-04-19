/**
 * Role hierarchy for Karatina University EDRMS.
 *
 * Assigns a numeric rank to each role so the system can determine
 * which party is more senior in a memo exchange.  Higher rank = more
 * senior.  When a user holds multiple roles the highest rank wins.
 */

const ROLE_RANK: Record<string, number> = {
  // ── Top Management ─────────────────────────────────────────
  ADMIN: 100,
  VICE_CHANCELLOR: 95,
  DVC_PFA: 90,
  DVC_ARSA: 90,

  // ── Registrars ─────────────────────────────────────────────
  REGISTRAR_PA: 80,
  REGISTRAR_ARSA: 80,

  // ── Academic / Directorate Leadership ──────────────────────
  DEAN: 70,
  DIRECTOR: 70,

  // ── Department Heads ───────────────────────────────────────
  HOD: 60,

  // ── Officers / Specialists ─────────────────────────────────
  FINANCE_OFFICER: 50,
  HR_OFFICER: 50,
  PROCUREMENT_OFFICER: 50,
  ICT_OFFICER: 50,
  INTERNAL_AUDITOR: 50,
  LEGAL_OFFICER: 50,
  LIBRARIAN: 50,
  MEDICAL_OFFICER: 50,
  ESTATES_OFFICER: 50,
  SECURITY_OFFICER: 50,
  RECORDS_MANAGER: 50,
  RECORDS_OFFICER: 45,

  // ── Support Staff ──────────────────────────────────────────
  ADMIN_ASSISTANT: 30,
  CLERK: 20,
  STAFF: 10,
  VIEWER: 5,
};

/** Default rank for unknown roles. */
const DEFAULT_RANK = 10;

/**
 * Get the effective seniority rank for a user given their role list.
 * Returns the highest rank among the user's roles.
 */
export function getUserRank(roles: string[]): number {
  if (!roles || roles.length === 0) return DEFAULT_RANK;
  return Math.max(...roles.map((r) => ROLE_RANK[r] ?? DEFAULT_RANK));
}

/**
 * Determine whether the sender is more senior than the recipient.
 *
 * @param senderRoles  - Role names of the memo initiator
 * @param recipientRoles - Role names of the memo recipient
 * @returns `true` when the sender outranks (or equals) the recipient
 */
export function isSenderMoreSenior(
  senderRoles: string[],
  recipientRoles: string[]
): boolean {
  return getUserRank(senderRoles) >= getUserRank(recipientRoles);
}
