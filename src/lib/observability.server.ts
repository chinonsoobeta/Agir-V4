// Production error capture (server-side). Every server error is emitted as a
// single STRUCTURED JSON line to stderr, prefixed `[agir-error]`, so the host
// (Vercel) captures it and a log drain / alert (Sentry, Logflare, Axiom,
// Datadog, ...) can parse and fire on it with ZERO additional code. When an
// error sink is configured via ERROR_WEBHOOK_URL, the same event is also POSTed
// to it, fire-and-forget. Reporting must never throw and never block the
// request path (a failure to report is swallowed, since the stderr line is the
// durable record).

type ErrorContext = Record<string, unknown>;
type MetricContext = Record<string, unknown>;

export type CapturedEvent = {
  level: "error";
  service: "agir";
  timestamp: string;
  error: { name?: string; message: string; stack?: string };
} & ErrorContext;

export type OperationalMetric = {
  level: "metric";
  service: "agir";
  timestamp: string;
  name: string;
  value: number;
} & MetricContext;

function serializeError(error: unknown): CapturedEvent["error"] {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (error != null && typeof error === "object") {
    try {
      return { message: JSON.stringify(error) };
    } catch {
      return { message: String(error) };
    }
  }
  return { message: String(error) };
}

function errorSinkUrl(): string | null {
  const url = process.env.ERROR_WEBHOOK_URL?.trim();
  return url ? url : null;
}

async function forwardToSink(url: string, event: CapturedEvent): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch {
    // Never surface a reporting failure: the structured stderr line already
    // recorded the original error durably.
  }
}

// Build the structured event without emitting it. Exposed for tests and callers
// that want to enrich/inspect the event.
export function buildErrorEvent(error: unknown, context: ErrorContext = {}): CapturedEvent {
  return {
    level: "error",
    service: "agir",
    timestamp: new Date().toISOString(),
    ...context,
    error: serializeError(error),
  };
}

// Capture a server-side error: structured stderr line always, optional webhook
// push when configured. Synchronous and non-throwing; the webhook POST is
// fire-and-forget.
export function captureServerError(error: unknown, context: ErrorContext = {}): void {
  const event = buildErrorEvent(error, context);
  try {
    console.error(`[agir-error] ${JSON.stringify(event)}`);
  } catch {
    // Last resort if the event itself cannot be serialized.
    console.error("[agir-error] (unserializable event)", error);
  }
  const sink = errorSinkUrl();
  if (sink) void forwardToSink(sink, event);
}

function metricSinkUrl(): string | null {
  const url = process.env.METRICS_WEBHOOK_URL?.trim() || process.env.ERROR_WEBHOOK_URL?.trim();
  return url ? url : null;
}

async function forwardMetricToSink(url: string, metric: OperationalMetric): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(metric),
    });
  } catch {
    // Metrics must never break request or worker paths.
  }
}

export function buildMetricEvent(
  name: string,
  value = 1,
  context: MetricContext = {},
): OperationalMetric {
  return {
    level: "metric",
    service: "agir",
    timestamp: new Date().toISOString(),
    name,
    value,
    ...context,
  };
}

export function emitOperationalMetric(name: string, value = 1, context: MetricContext = {}): void {
  const metric = buildMetricEvent(name, value, context);
  try {
    console.info(`[agir-metric] ${JSON.stringify(metric)}`);
  } catch {
    console.info("[agir-metric] (unserializable metric)", name, value);
  }
  const sink = metricSinkUrl();
  if (sink) void forwardMetricToSink(sink, metric);
}
