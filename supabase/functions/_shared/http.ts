import { config } from "./config.ts";

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  const allowed = config().allowedOrigins;
  return {
    "access-control-allow-origin": allowed.has(origin) ? origin : "null",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
}

export function json(request: Request, body: unknown, status = 200): Response {
  const responseBody = [204, 205, 304].includes(status) ? null : JSON.stringify(body);
  return new Response(responseBody, {
    status,
    headers: { ...corsHeaders(request), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function assertOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || !config().allowedOrigins.has(origin)) throw new Error("ORIGIN_DENIED");
}

export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return message.replace(/[^A-Z0-9_:.-]/gi, "_").slice(0, 160);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
