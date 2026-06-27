import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { listProjects } from "@/lib/projects.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Bot, User as UserIcon, Sparkles } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import ReactMarkdown from "react-markdown";

const projectsQ = queryOptions({ queryKey: ["projects"], queryFn: () => listProjects() });

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
  const [token, setToken] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(deal ?? null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
  }, []);

  if (!token) return <div className="p-8 text-muted-foreground text-sm">Loading…</div>;
  const focused = projects.find((p: any) => p.id === dealId) ?? null;
  return <ChatUI token={token} projects={projects} focused={focused} setDealId={setDealId} />;
}

function ChatUI({
  token,
  projects,
  focused,
  setDealId,
}: {
  token: string;
  projects: any[];
  focused: any | null;
  setDealId: (id: string | null) => void;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (focused) headers["X-Agir-Deal"] = focused.id;
  const transport = new DefaultChatTransport({ api: "/api/chat", headers });
  const { messages, sendMessage, status } = useChat({ transport });
  const loading = status === "submitted" || status === "streaming";
  const SUGGESTIONS = focused ? DEAL_SUGGESTIONS(focused.name) : PORTFOLIO_SUGGESTIONS;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function send(text: string) {
    if (!text.trim() || loading) return;
    sendMessage({ text: text.trim() });
    setInput("");
  }

  return (
    <>
      <PageHeader
        eyebrow="Copilot"
        title="Investment Copilot"
        subtitle={
          focused
            ? `Focused on ${focused.name}: answers from its findings & drivers`
            : "Decision-aware analyst across your portfolio"
        }
        actions={
          <select
            value={focused?.id ?? ""}
            onChange={(e) => setDealId(e.target.value || null)}
            className="bg-background border border-border rounded-md px-3 py-1.5 text-sm"
          >
            <option value="">Whole portfolio</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        }
      />
      <div className="px-8 py-6 flex flex-col h-[calc(100vh-89px)]">
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pr-2">
          {messages.length === 0 && (
            <Card className="p-8 text-center elevated">
              <Bot className="size-10 mx-auto text-primary" />
              <h3 className="mt-3 display text-xl">
                {focused
                  ? `What should we do about ${focused.name}?`
                  : "What decision should we make?"}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {focused
                  ? "Grounded in this deal's findings, scores and recommendation."
                  : "Grounded in approved assumptions and deterministic outputs."}
              </p>
              <div className="grid sm:grid-cols-2 gap-2 mt-5 max-w-xl mx-auto">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
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
                  <div className="prose prose-sm prose-invert max-w-none text-sm">
                    <ReactMarkdown>{text}</ReactMarkdown>
                  </div>
                </Card>
              </div>
            );
          })}
          {loading && (
            <div className="flex gap-3">
              <div className="size-8 rounded-md bg-primary flex items-center justify-center">
                <Bot className="size-4 text-primary-foreground animate-pulse" />
              </div>
              <Card className="p-4 text-sm text-muted-foreground">Thinking…</Card>
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
          <Input
            placeholder="Ask anything about your projects…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            className="flex-1"
          />
          <Button type="submit" disabled={loading || !input.trim()}>
            <Send className="size-4" />
          </Button>
        </form>
      </div>
    </>
  );
}
