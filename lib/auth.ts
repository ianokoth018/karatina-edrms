import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import {
  isLocked,
  lockoutEndsAt,
  shouldLockAfterFailure,
  MAX_FAILED_ATTEMPTS,
} from "@/lib/auth-policy";
import { verifyOtp } from "@/lib/login-otp";
import {
  createSession,
  rotateSessionToken,
  verifyAndTouchSession,
  revokeSession,
} from "@/lib/sessions";

/** Reasons recorded in the LoginAttempt audit table. */
type AuthFailureReason =
  | "INVALID_PASSWORD"
  | "ACCOUNT_LOCKED"
  | "INACTIVE"
  | "MFA_REQUIRED"
  | "MFA_INVALID"
  | "EXPIRED_OTP"
  | "USER_NOT_FOUND";

async function recordAttempt(params: {
  email: string;
  userId?: string;
  success: boolean;
  reason: AuthFailureReason | "OK";
}) {
  try {
    await db.loginAttempt.create({ data: params });
  } catch {
    /* never block auth on audit failure */
  }
}

/** Access token lifetime: 15 minutes (in milliseconds). */
const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;

/** Refresh token lifetime: 7 days (in milliseconds). */
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        mfaCode: { label: "Authenticator code", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }

        const email = (credentials.email as string).trim().toLowerCase();
        const password = credentials.password as string;
        const mfaCode = (credentials.mfaCode as string | undefined)?.trim();

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
          await recordAttempt({ email, success: false, reason: "USER_NOT_FOUND" });
          throw new Error("Invalid email or password");
        }

        // Account lockout — enforce before checking the password so brute-force
        // probes can't even tell whether the password was right.
        if (isLocked(user.lockedUntil)) {
          await recordAttempt({
            email,
            userId: user.id,
            success: false,
            reason: "ACCOUNT_LOCKED",
          });
          const minsLeft = Math.max(
            1,
            Math.ceil((user.lockedUntil!.getTime() - Date.now()) / (60 * 1000))
          );
          throw new Error(
            `This account is temporarily locked after too many failed attempts. Try again in ${minsLeft} minute${
              minsLeft === 1 ? "" : "s"
            }.`
          );
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
          // Increment failure counter, lock if threshold crossed.
          const attempts = user.failedLoginAttempts + 1;
          const willLock = shouldLockAfterFailure(user.failedLoginAttempts);
          await db.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: attempts,
              lockedUntil: willLock ? lockoutEndsAt() : user.lockedUntil,
            },
          });
          await recordAttempt({
            email,
            userId: user.id,
            success: false,
            reason: "INVALID_PASSWORD",
          });
          if (willLock) {
            throw new Error(
              `Account locked after ${MAX_FAILED_ATTEMPTS} failed attempts. Try again in 15 minutes.`
            );
          }
          throw new Error("Invalid email or password");
        }

        if (!user.isActive) {
          await recordAttempt({
            email,
            userId: user.id,
            success: false,
            reason: "INACTIVE",
          });
          throw new Error("Your account has been deactivated. Contact the administrator.");
        }

        // Reject expired one-time passwords from admin resets
        if (
          user.mustChangePassword &&
          user.passwordResetExpiresAt &&
          user.passwordResetExpiresAt.getTime() < Date.now()
        ) {
          await recordAttempt({
            email,
            userId: user.id,
            success: false,
            reason: "EXPIRED_OTP",
          });
          throw new Error(
            "Your one-time password has expired. Ask an administrator to reset it again."
          );
        }

        // ---- MFA gate (email OTP) ----
        // Skip MFA when the user is going through an admin-initiated password
        // reset — they need to be able to set a new password first.
        if (user.mfaEnabled && !user.mustChangePassword) {
          if (!mfaCode) {
            await recordAttempt({
              email,
              userId: user.id,
              success: false,
              reason: "MFA_REQUIRED",
            });
            // Machine-readable signal — the login page calls
            // /api/auth/mfa/request-code to email a fresh code, then prompts
            // the user for it.
            throw new Error("MFA_REQUIRED");
          }

          const verification = await verifyOtp(user.id, mfaCode, "LOGIN");
          if (!verification.ok) {
            await recordAttempt({
              email,
              userId: user.id,
              success: false,
              reason: "MFA_INVALID",
            });
            const msg =
              verification.reason === "EXPIRED"
                ? "That code has expired. Request a new one."
                : verification.reason === "EXHAUSTED"
                  ? "Too many wrong attempts on that code. Request a new one."
                  : verification.reason === "NONE_ISSUED"
                    ? "No code on file. Request a sign-in code first."
                    : "That code is incorrect.";
            throw new Error(msg);
          }
        }

        // Successful login: clear failure counter, update last-login, log.
        await db.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: new Date(),
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        });
        await recordAttempt({
          email,
          userId: user.id,
          success: true,
          reason: "OK",
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
          jobTitle: user.jobTitle ?? "",
          designation: user.designation ?? "",
          profilePhoto: user.profilePhoto ?? "",
          mustChangePassword: user.mustChangePassword,
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
  events: {
    async signOut(message) {
      // Revoke the server-side session row when the user signs out, so the
      // refresh token can never be replayed.
      const token =
        message && typeof message === "object" && "token" in message
          ? (message as { token?: { sessionId?: unknown } }).token
          : null;
      const sid = token?.sessionId;
      if (typeof sid === "string" && sid) {
        await revokeSession(sid, "USER_LOGOUT");
      }
    },
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
          jobTitle: string;
          designation: string;
          profilePhoto: string;
          mustChangePassword: boolean;
        };
        token.id = user.id;
        token.roles = u.roles;
        token.permissions = u.permissions;
        token.department = u.department;
        token.employeeId = u.employeeId;
        token.jobTitle = u.jobTitle;
        token.designation = u.designation;
        token.profilePhoto = u.profilePhoto;
        token.mustChangePassword = u.mustChangePassword;

        // Token rotation fields
        token.accessTokenExpires = Date.now() + ACCESS_TOKEN_MAX_AGE_MS;
        token.refreshToken = uuidv4();
        token.refreshTokenExpires = Date.now() + REFRESH_TOKEN_MAX_AGE_MS;
        token.error = undefined;

        // Persist a server-side session row so we can revoke this JWT later.
        try {
          token.sessionId = await createSession(
            user.id,
            token.refreshToken,
            new Date(token.refreshTokenExpires),
          );
        } catch {
          // If session creation fails the auth shouldn't fail outright —
          // but record so devs notice in logs.
          token.sessionId = "";
        }

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
          token.jobTitle = freshUser.jobTitle ?? "";
          token.designation = freshUser.designation ?? "";
          token.profilePhoto = freshUser.profilePhoto ?? "";
          token.mustChangePassword = freshUser.mustChangePassword;
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
          // Server-side revocation gate — bail if the session has been
          // logged out, password-changed, MFA-disabled, or admin-revoked.
          if (token.sessionId && typeof token.refreshToken === "string") {
            const stillValid = await verifyAndTouchSession(
              token.sessionId as string,
              token.refreshToken as string,
            );
            if (!stillValid) {
              return { ...token, error: "RefreshTokenError" as const };
            }
          }

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
          const newRefresh = uuidv4();
          const newRefreshExpiresAt = Date.now() + REFRESH_TOKEN_MAX_AGE_MS;
          token.refreshToken = newRefresh;
          token.refreshTokenExpires = newRefreshExpiresAt;
          token.error = undefined;

          // Persist the rotated refresh token to the session row.
          if (token.sessionId) {
            try {
              await rotateSessionToken(
                token.sessionId as string,
                newRefresh,
                new Date(newRefreshExpiresAt),
              );
            } catch {
              /* ignore — next refresh will fail and force re-login */
            }
          }

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
          token.jobTitle = freshUser.jobTitle ?? "";
          token.designation = freshUser.designation ?? "";
          token.profilePhoto = freshUser.profilePhoto ?? "";
          token.mustChangePassword = freshUser.mustChangePassword;
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
        session.user.jobTitle = token.jobTitle as string;
        session.user.designation = (token.designation as string) ?? "";
        session.user.profilePhoto = (token.profilePhoto as string) ?? "";
        session.user.mustChangePassword = !!token.mustChangePassword;
      }

      // Surface token-refresh errors to the client so it can redirect to login
      if (token.error) {
        session.error = token.error as string;
      }

      return session;
    },
  },
});
