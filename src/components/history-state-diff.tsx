import { historyChangeRows, historyContextRows } from "@/lib/history-presentation";

export function HistoryStateDiff({
  before,
  after,
  metadata,
}: {
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}) {
  const changes = historyChangeRows(before, after);
  const context = historyContextRows(metadata);
  if (!changes.length && !context.length) return null;

  return (
    <div className="mt-3 space-y-3 text-xs" aria-label="Structured change details">
      {changes.length > 0 && (
        <dl className="divide-y divide-border rounded-md border border-border">
          {changes.map((change) => (
            <div key={change.key} className="grid gap-1 px-3 py-2 sm:grid-cols-[9rem_1fr]">
              <dt className="font-medium text-foreground">{change.label}</dt>
              <dd className="min-w-0 break-words text-muted-foreground">
                <span>{change.before}</span>
                <span aria-hidden="true" className="px-1.5">
                  →
                </span>
                <span className="text-foreground">{change.after}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {context.length > 0 && (
        <details className="rounded-md border border-border px-3 py-2">
          <summary className="cursor-pointer font-medium text-foreground">
            Provenance and context
          </summary>
          <dl className="mt-2 space-y-1.5">
            {context.map((item) => (
              <div key={item.key} className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd className="break-words text-foreground">{item.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
