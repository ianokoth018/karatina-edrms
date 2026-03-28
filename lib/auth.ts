import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "@/lib/db";

/** Access token lifetime: 15 minutes (in milliseconds). */
const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;

/** Refresh token lifetime: 7 days (in milliseconds). */
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        const user = await db.user.findUnique({
          where: { email },
          include: {
            roles: {
              include: {
                role: {
                  include: {
                    permissions: true,
                  },
                },
              },
            },
          },
        });

        if (!user) {
          throw new Error("Invalid email or password");
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
          throw new Error("Invalid email or password");
        }

        if (!user.isActive) {
          throw new Error("Your account has been deactivated. Contact the administrator.");
        }

        // Update last login timestamp
        await db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        // Collect all role names and permissions
        const roles = user.roles.map((ur) => ur.role.name);
        const permissions = user.roles.flatMap((ur) =>
          ur.role.permissions.map((p) => `${p.resource}:${p.action}`)
        );

        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          roles,
          permissions: [...new Set(permissions)],
          department: user.department ?? "",
          employeeId: user.employeeId ?? "",
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 15 * 60, // 15 minutes -- matches access token lifetime (in seconds)
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      // -------------------------------------------------------------------
      // 1. Initial sign-in -- populate token with user data + refresh token
      // -------------------------------------------------------------------
      if (user) {
        const u = user as unknown as {
          roles: string[];
          permissions: string[];
          department: string;
          employeeId: string;
        };
        token.id = user.id;
        token.roles = u.roles;
        token.permissions = u.permissions;
        token.department = u.department;
        token.employeeId = u.employeeId;

        // Token rotation fields
        token.accessTokenExpires = Date.now() + ACCESS_TOKEN_MAX_AGE_MS;
        token.refreshToken = crypto.randomUUID();
        token.refreshTokenExpires = Date.now() + REFRESH_TOKEN_MAX_AGE_MS;
        token.error = undefined;

        return token;
      }

      // -------------------------------------------------------------------
      // 2. Manual session refresh via `update()` -- always fetch fresh data
      // -------------------------------------------------------------------
      if (trigger === "update") {
        const freshUser = await db.user.findUnique({
          where: { id: token.id as string },
          include: {
            roles: {
              include: {
                role: {
                  include: { permissions: true },
                },
              },
            },
          },
        });
        if (freshUser) {
          token.roles = freshUser.roles.map((ur) => ur.role.name);
          token.permissions = [
            ...new Set(
              freshUser.roles.flatMap((ur) =>
                ur.role.permissions.map((p) => `${p.resource}:${p.action}`)
              )
            ),
          ];
          token.department = freshUser.department ?? "";
          token.employeeId = freshUser.employeeId ?? "";
          token.name = freshUser.displayName;
        }

        // Reset access token expiry on manual refresh
        token.accessTokenExpires = Date.now() + ACCESS_TOKEN_MAX_AGE_MS;
        token.error = undefined;

        return token;
      }

      // -------------------------------------------------------------------
      // 3. Access token still valid -- return as-is
      // -------------------------------------------------------------------
      if (
        typeof token.accessTokenExpires === "number" &&
        Date.now() < token.accessTokenExpires
      ) {
        return token;
      }

      // -------------------------------------------------------------------
      // 4. Access token expired, but refresh token still valid -- rotate
      // -------------------------------------------------------------------
      if (
        typeof token.refreshTokenExpires === "number" &&
        Date.now() < token.refreshTokenExpires
      ) {
        try {
          const freshUser = await db.user.findUnique({
            where: { id: token.id as string },
            include: {
              roles: {
                include: {
                  role: {
                    include: { permissions: true },
                  },
                },
              },
            },
          });

          if (!freshUser || !freshUser.isActive) {
            return { ...token, error: "RefreshTokenError" as const };
          }

          // Rotate tokens
          token.accessTokenExpires = Date.now() + ACCESS_TOKEN_MAX_AGE_MS;
          token.refreshToken = crypto.randomUUID();
          token.refreshTokenExpires = Date.now() + REFRESH_TOKEN_MAX_AGE_MS;
          token.error = undefined;

          // Refresh user data
          token.roles = freshUser.roles.map((ur) => ur.role.name);
          token.permissions = [
            ...new Set(
              freshUser.roles.flatMap((ur) =>
                ur.role.permissions.map((p) => `${p.resource}:${p.action}`)
              )
            ),
          ];
          token.department = freshUser.department ?? "";
          token.employeeId = freshUser.employeeId ?? "";
          token.name = freshUser.displayName;

          return token;
        } catch {
          return { ...token, error: "RefreshTokenError" as const };
        }
      }

      // -------------------------------------------------------------------
      // 5. Both tokens expired -- force re-login
      // -------------------------------------------------------------------
      return { ...token, error: "RefreshTokenError" as const };
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.roles = token.roles as string[];
        session.user.permissions = token.permissions as string[];
        session.user.department = token.department as string;
        session.user.employeeId = token.employeeId as string;
      }

      // Surface token-refresh errors to the client so it can redirect to login
      if (token.error) {
        session.error = token.error as string;
      }

      return session;
    },
  },
});
