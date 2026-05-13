import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { maskedPhoneNumberId, whatsappEnabled } from "@/lib/whatsapp";
import WhatsAppTestForm from "./test-form";

// ---------------------------------------------------------------------------
// Admin → WhatsApp.
//
// Shows the env-driven WhatsApp Cloud API config (with the Phone Number Id
// masked) and a "test send" form that POSTs to /api/admin/whatsapp/test.
//
// Configuration lives in env (matching the SMS pattern) — there's no DB
// settings table for WhatsApp because tokens rotate via Meta's system-user
// flow, not via the EDRMS UI.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function WhatsAppAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.permissions?.includes("admin:manage")) {
    return <div className="p-6 text-red-600">Forbidden</div>;
  }

  const enabled = whatsappEnabled();
  const masked = maskedPhoneNumberId();
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || null;
  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || "v20.0";
  const hasToken = !!process.env.WHATSAPP_ACCESS_TOKEN;

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">WhatsApp Notifications</h1>
        <p className="text-sm text-gray-600 mt-1">
          Workflow alerts (task assignment, SLA breach, escalation) can be
          delivered over WhatsApp via Meta&apos;s Cloud API in addition to SMS
          and email. Configure the env vars below and restart to enable.
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Configuration</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              enabled
                ? "bg-green-100 text-green-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                enabled ? "bg-green-600" : "bg-amber-600"
              }`}
            />
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </div>

        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Phone Number Id</dt>
            <dd className="font-mono">{masked ?? <em className="text-gray-400">not set</em>}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Access Token</dt>
            <dd>{hasToken ? "•••• (set)" : <em className="text-gray-400">not set</em>}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Business Account Id</dt>
            <dd className="font-mono">
              {businessAccountId ?? <em className="text-gray-400">not set (optional)</em>}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Graph API Version</dt>
            <dd className="font-mono">{graphVersion}</dd>
          </div>
        </dl>

        <p className="text-xs text-gray-500 border-t border-gray-100 pt-2">
          Required: <code>WHATSAPP_PHONE_NUMBER_ID</code>,{" "}
          <code>WHATSAPP_ACCESS_TOKEN</code>. Optional:{" "}
          <code>WHATSAPP_BUSINESS_ACCOUNT_ID</code>,{" "}
          <code>WHATSAPP_GRAPH_VERSION</code>.
        </p>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <h2 className="font-medium">Test send</h2>
        <p className="text-xs text-gray-500">
          Free-text messages only succeed inside an active 24-hour session
          window. For first-touch alerts use an approved template name (see
          Meta Business Manager → WhatsApp → Message templates).
        </p>
        <WhatsAppTestForm disabled={!enabled} />
      </section>
    </div>
  );
}
