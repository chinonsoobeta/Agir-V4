import { createStart, createMiddleware, createCsrfMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { captureServerError, createRequestId } from "@/lib/observability.server";

function wantsHtmlDocument(request?: Request | null) {
  const accept = request?.headers.get("accept") ?? "";
  const destination = request?.headers.get("sec-fetch-dest") ?? "";
  const mode = request?.headers.get("sec-fetch-mode") ?? "";
  return accept.includes("text/html") && (destination === "document" || mode === "navigate");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

function errorStatus(message: string) {
  return message.startsWith("Unauthorized:") ? 401 : 500;
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    const request = getRequest();
    const requestId = createRequestId(request);
    captureServerError(error, {
      requestId,
      path: request ? new URL(request.url).pathname : "unknown",
      handler: "start.errorMiddleware",
    });
    const message = errorMessage(error);
    const status = errorStatus(message);
    if (!wantsHtmlDocument(request)) {
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", "x-request-id": requestId },
      });
    }
    return new Response(renderErrorPage(), {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "x-request-id": requestId },
    });
  }
});

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [csrfMiddleware, errorMiddleware],
}));
