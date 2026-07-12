import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useSuspenseQuery, useQuery, queryOptions } from "@tanstack/react-query";
import { listProjects } from "@/lib/projects.functions";
import { getAiReadiness, type AiReadiness } from "@/lib/ai-readiness.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Send,
  Bot,
  User as UserIcon,
  Sparkles,
  Square,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import type React from "react";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import ReactMarkdown from "react-markdown";

type ProjectRow = Tables<"projects">;

const projectsQ = queryOptions({ queryKey: ["projects"], queryFn: () => listProjects() });
const aiReadinessQ = queryOptions({
  queryKey: ["ai-readiness"],
  queryFn: () => getAiReadiness(),
});

export const Route = createFileRoute("/_authenticated/copilot")({
  head: () => ({ meta: [{ title: "Copilot | Agir" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    deal: typeof s.deal === "string" ? s.deal : undefined,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(projectsQ),
  component: CopilotPage,
});

const PORTFOLIO_SUGGESTIONS = [
  "Which deals should the committee prioritise?",
  "Which deals are highest risk right now?",
  "What is blocking my pipeline?",
  "Which deal has the strongest investment thesis?",
];
const DEAL_SUGGESTIONS = (name: string) => [
  `Why did ${name} get this recommendation?`,
  `How could ${name} pass committee?`,
  `What assumption matters most for ${name}?`,
  `What is the top risk on ${name}?`,
];

function CopilotPage() {
  const { deal } = Route.useSearch();
  const { data: projects } = useSuspenseQuery(projectsQ);
  const { data: aiReadiness } = useQuery(aiReadinessQ);
  const [token, setToken] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(deal ?? null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
  }, []);

  const focused = projects.find((p) => p.id === dealId) ?? null;

  const header = (
    <PageHeader
      eyebrow="Copilot"
      title="Investment Copilot"
      subtitle={
        focused
          ? `Focused on ${focused.name}: answers from its findings & drivers`
          : "Decision-aware analyst across your portfolio"
      }
      actions={
        <Select
          value={focused?.id ?? "__all__"}
          onValueChange={(v) => setDealId(v === "__all__" ? null : v)}
        >
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="Whole portfolio" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Whole portfolio</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );

  if (!token) {
    return (
      <>
        {header}
        <div className="px-5 sm:px-8 py-6 text-muted-foreground text-sm" role="status">
          Loading…
        </div>
      </>
    );
  }
  return <ChatUI token={token} focused={focused} header={header} aiReadiness={aiReadiness} />;
}

function ChatUI({
  token,
  focused,
  header,
  aiReadiness,
}: {
  token: string;
  focused: ProjectRow | null;
  header: React.ReactNode;
  aiReadiness?: AiReadiness;
}) {
  const [input, setInput] = useState("");
  const [keyNotice, setKeyNotice] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (focused) headers["X-Agir-Deal"] = focused.id;
  const transport = new DefaultChatTransport({ api: "/api/chat", headers });
  const { messages, sendMessage, regenerate, stop, status, error } = useChat({ transport });
  const loading = status === "submitted" || status === "streaming";
  const errored = status === "error";
  const SUGGESTIONS = focused ? DEAL_SUGGESTIONS(focused.name) : PORTFOLIO_SUGGESTIONS;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function send(text: string) {
    if (!text.trim() || loading) return;
    if (!aiReadiness?.configured) {
      setKeyNotice(true);
      return;
    }
    setKeyNotice(false);
    sendMessage({ text: text.trim() });
    setInput("");
  }

  return (
    <>
      {header}
      <div className="px-5 sm:px-8 py-6 flex flex-col h-[calc(100dvh-5.5rem)]">
        <div
          ref={scrollRef}
          aria-live="polite"
          aria-atomic="false"
          className={`flex-1 overflow-y-auto pr-2 ${messages.length === 0 ? "flex flex-col items-center justify-center" : "space-y-4"}`}
        >
          {messages.length === 0 && (
            <Card className="surface-editorial w-full max-w-xl p-8 text-center">
              <Bot className="size-10 mx-auto text-primary" />
              <div className="mt-3 flex justify-center">
                <Badge
                  variant="outline"
                  className={
                    aiReadiness?.configured
                      ? "border-primary/40 text-primary"
                      : "border-warning/40 text-warning"
                  }
                >
                  {aiReadiness?.configured ? "AI key configured" : "AI ready · key pending"}
                </Badge>
              </div>
              <h3 className="mt-3 display text-xl">
                {!aiReadiness?.configured
                  ? "AI workflows are ready"
                  : focused
                    ? `What should we do about ${focused.name}?`
                    : "What decision should we make?"}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {!aiReadiness?.configured
                  ? `Set ${aiReadiness?.keyEnv ?? "API_KEY or ANTHROPIC_API_KEY"} on the server to activate chat. Extraction, underwriting and memo controls remain visible and fall back safely.`
                  : focused
                    ? "Grounded in this deal's findings, scores and recommendation."
                    : "Grounded in approved assumptions and deterministic outputs."}
              </p>
              {!aiReadiness?.configured && (
                <Button asChild variant="outline" size="sm" className="mt-4">
                  <a href="/settings?section=ai">View AI settings</a>
                </Button>
              )}
              <div className="grid sm:grid-cols-2 gap-2 mt-5 max-w-xl mx-auto">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="text-left text-xs border border-border rounded-md p-3 hover:border-primary hover:bg-accent/30 transition-colors"
                  >
                    <Sparkles className="size-3 inline mr-1 text-primary" />
                    {s}
                  </button>
                ))}
              </div>
            </Card>
          )}
          {messages.map((m) => {
            const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
            const isUser = m.role === "user";
            return (
              <div key={m.id} className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
                <div
                  className={`size-8 rounded-md flex items-center justify-center shrink-0 ${isUser ? "bg-accent" : "bg-primary"}`}
                >
                  {isUser ? (
                    <UserIcon className="size-4" />
                  ) : (
                    <Bot className="size-4 text-primary-foreground" />
                  )}
                </div>
                <Card className={`p-4 max-w-3xl ${isUser ? "bg-accent border-accent" : ""}`}>
                  <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                    <ReactMarkdown>{text}</ReactMarkdown>
                  </div>
                </Card>
              </div>
            );
          })}
          {loading && (
            <div className="flex gap-3" role="status">
              <div className="size-8 rounded-md bg-primary flex items-center justify-center">
                <Bot className="size-4 text-primary-foreground animate-pulse" />
              </div>
              <Card className="p-4 text-sm text-muted-foreground">Thinking…</Card>
            </div>
          )}
          {errored && (
            <div className="flex gap-3" role="alert">
              <div className="size-8 rounded-md bg-destructive/15 flex items-center justify-center shrink-0">
                <AlertCircle className="size-4 text-destructive" />
              </div>
              <Card className="p-4 max-w-3xl border-destructive/40">
                <p className="text-sm font-medium text-destructive">Something went wrong</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {error?.message || "The copilot could not complete that response."}
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => regenerate()}>
                  <RefreshCw className="size-3.5 mr-1.5" />
                  Retry
                </Button>
              </Card>
            </div>
          )}
          {keyNotice && (
            <div className="flex gap-3" role="status">
              <div className="size-8 rounded-md bg-warning/15 flex items-center justify-center shrink-0">
                <AlertCircle className="size-4 text-warning" />
              </div>
              <Card className="p-4 max-w-3xl border-warning/40">
                <p className="text-sm font-medium">AI key pending</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Copilot is wired, but chat needs a server-side{" "}
                  {aiReadiness?.keyEnv ?? "API_KEY or ANTHROPIC_API_KEY"}. Add the key later and
                  this control will run without code changes.
                </p>
              </Card>
            </div>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="mt-4 flex gap-2"
        >
          <label htmlFor="copilot-input" className="sr-only">
            Ask the copilot
          </label>
          <Input
            id="copilot-input"
            aria-label="Ask the copilot"
            placeholder="Ask anything about your projects…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            className="flex-1"
          />
          {loading ? (
            <Button
              type="button"
              variant="outline"
              aria-label="Stop generating"
              onClick={() => stop()}
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <Button type="submit" aria-label="Send message" disabled={!input.trim()}>
              <Send className="size-4" />
            </Button>
          )}
        </form>
      </div>
    </>
  );
}
