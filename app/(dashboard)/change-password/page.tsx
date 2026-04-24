"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // If user lands here without an active session, send them to login.
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  const isForced = session?.user?.mustChangePassword === true;

  function pwStrength(pw: string): { label: string; color: string; pct: number } {
    if (!pw) return { label: "", color: "bg-gray-200", pct: 0 };
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;
    if (score <= 1) return { label: "Weak", color: "bg-red-500", pct: 25 };
    if (score === 2) return { label: "Fair", color: "bg-amber-500", pct: 50 };
    if (score === 3) return { label: "Good", color: "bg-blue-500", pct: 75 };
    return { label: "Strong", color: "bg-emerald-500", pct: 100 };
  }
  const strength = pwStrength(newPassword);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from the current one.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.ok) {
        setSuccess(true);
        // Refresh session so mustChangePassword=false is reflected
        await update();
        setTimeout(() => router.replace("/dashboard"), 1500);
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Password change failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 sm:p-8 shadow-sm space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
            {isForced ? "Set a new password" : "Change your password"}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5">
            {isForced ? (
              <>
                You signed in with a one-time password issued by an
                administrator. Please choose a permanent password before you
                can use the system.
              </>
            ) : (
              "Pick a strong password — at least 8 characters, with a mix of letters and digits."
            )}
          </p>
        </div>

        {success ? (
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
            Password updated. Redirecting to your dashboard…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
                {isForced ? "One-time password from email" : "Current password"}
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder={isForced ? "KU-XXXXXX" : ""}
                className="w-full h-11 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
                New password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full h-11 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
              />
              {newPassword && (
                <div className="mt-2">
                  <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                    <div
                      className={`h-full transition-all ${strength.color}`}
                      style={{ width: `${strength.pct}%` }}
                    />
                  </div>
                  <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">
                    Strength: <span className="font-medium">{strength.label}</span>
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
                Confirm new password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full h-11 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
              />
              {confirmPassword && confirmPassword !== newPassword && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  Passwords do not match.
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2">
              {!isForced && (
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="px-4 h-11 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="ml-auto px-6 h-11 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? "Updating…" : "Update password"}
              </button>
            </div>
          </form>
        )}

        {isForced && (
          <p className="text-xs text-gray-400 dark:text-gray-500 pt-3 border-t border-gray-100 dark:border-gray-800">
            Need help? Contact your records office. The EDRMS will never ask
            you for your password by phone or email.
          </p>
        )}
      </div>
    </div>
  );
}
