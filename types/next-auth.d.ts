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
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    roles: string[];
    permissions: string[];
    department: string;
    employeeId: string;
    accessTokenExpires: number;
    refreshToken: string;
    refreshTokenExpires: number;
    error?: string;
  }
}
