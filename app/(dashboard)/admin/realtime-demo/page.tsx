import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import RealtimeDemoClient from "./demo-client";

/**
 * Admin → Realtime smoke test.
 *
 * Mounts a single Y.Text under room `admin:realtime-demo` and binds it to a
 * plain <textarea>. Open this page in two tabs to confirm the y-websocket
 * server is reachable, auth tokens are valid, and CRDT sync works.
 *
 * No DB writes — the ydoc lives only in the WS server's memory.
 */
export const dynamic = "force-dynamic";

export default async function RealtimeDemoPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.permissions?.includes("admin:manage")) {
    return <div className="p-6 text-red-600">Forbidden</div>;
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Realtime Co-Edit Smoke Test</h1>
        <p className="text-sm text-gray-600 mt-1">
          Open this page in two browser tabs and type in the textarea. Both
          tabs should stay in sync via the Yjs <code>WebsocketProvider</code>
          {" "}— if they don&apos;t, the realtime server isn&apos;t reachable
          or your token didn&apos;t verify. Document state lives in the WS
          server&apos;s memory only; nothing is persisted.
        </p>
      </div>

      <RealtimeDemoClient />
    </div>
  );
}
