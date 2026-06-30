import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Users, CheckCircle2, XCircle } from "lucide-react";
import { acceptInvitation } from "@/lib/workspaces.functions";

export const Route = createFileRoute("/_authenticated/accept-invite")({
  head: () => ({ meta: [{ title: "Join workspace | Agir" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === "string" ? s.token : undefined,
  }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const acceptFn = useServerFn(acceptInvitation);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [manualToken, setManualToken] = useState("");
  const attempted = useRef(false);

  async function accept(t: string) {
    if (!t) return;
    setStatus("working");
    try {
      await acceptFn({ data: { token: t } });
      await qc.invalidateQueries({ queryKey: ["workspaces"] });
      setStatus("done");
      setMessage("You've joined the workspace.");
      setTimeout(() => navigate({ to: "/dashboard" }), 1200);
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Could not accept this invitation.");
    }
  }

  useEffect(() => {
    if (token && !attempted.current) {
      attempted.current = true;
      accept(token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <Card className="p-8 max-w-md w-full text-center elevated">
        <div className="size-12 rounded-full bg-primary/15 text-primary flex items-center justify-center mx-auto mb-4">
          {status === "working" ? (
            <Loader2 className="size-6 animate-spin" />
          ) : status === "done" ? (
            <CheckCircle2 className="size-6 text-success" />
          ) : status === "error" ? (
            <XCircle className="size-6 text-destructive" />
          ) : (
            <Users className="size-6" />
          )}
        </div>
        <h1 className="display text-xl font-semibold">Join workspace</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {status === "done"
            ? message
            : status === "error"
              ? message
              : status === "working"
                ? "Accepting your invitation…"
                : "Paste your invitation code to join a workspace."}
        </p>

        {(status === "idle" || status === "error") && (
          <div className="mt-5 flex gap-2">
            <Input
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              placeholder="Invitation code"
            />
            <Button onClick={() => accept(manualToken.trim())} disabled={!manualToken.trim()}>
              Join
            </Button>
          </div>
        )}

        {status === "error" && (
          <Button variant="ghost" className="mt-3" onClick={() => navigate({ to: "/dashboard" })}>
            Back to dashboard
          </Button>
        )}
      </Card>
    </div>
  );
}
