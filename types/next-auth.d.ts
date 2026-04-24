import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      roles: string[];
      permissions: string[];
      department: string;
      employeeId: string;
      jobTitle: string;
      designation: string;
      profilePhoto: string;
      mustChangePassword: boolean;
    };
    error?: string;
  }

  interface User {
    id: string;
    email: string;
    name: string;
    roles: string[];
    permissions: string[];
    department: string;
    employeeId: string;
    jobTitle: string;
    designation: string;
    profilePhoto: string;
    mustChangePassword: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    roles: string[];
    permissions: string[];
    department: string;
    employeeId: string;
    jobTitle: string;
    designation: string;
    profilePhoto: string;
    mustChangePassword: boolean;
    accessTokenExpires: number;
    refreshToken: string;
    refreshTokenExpires: number;
    /** UserSession row id — used to revoke this JWT server-side. */
    sessionId: string;
    error?: string;
  }
}
