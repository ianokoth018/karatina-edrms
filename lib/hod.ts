import { db } from "@/lib/db";

export interface HodInfo {
  id: string;
  name: string;
  displayName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
}

/**
 * Look up the Head of Department (HOD) for a given department.
 * Returns the first user who has the `HOD` role and whose `department` matches.
 * Returns null if no HOD exists for that department.
 */
export async function findHodForDepartment(
  department: string | null | undefined
): Promise<HodInfo | null> {
  if (!department) return null;

  const hod = await db.user.findFirst({
    where: {
      department,
      isActive: true,
      roles: { some: { role: { name: "HOD" } } },
    },
    select: {
      id: true,
      name: true,
      displayName: true,
      email: true,
      department: true,
      jobTitle: true,
    },
  });

  return hod;
}

/**
 * True if the given user's roles include HOD.
 */
export function userIsHod(roles: readonly string[] | null | undefined): boolean {
  if (!roles) return false;
  return roles.includes("HOD");
}
