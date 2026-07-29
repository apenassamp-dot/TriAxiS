import { config } from "./config.ts";

export class MercadoPagoError extends Error {
  status: number;
  code: string;
  outcomeUnknown: boolean;

  constructor(status: number, code: string, outcomeUnknown = false) {
    super(code);
    this.status = status;
    this.code = code;
    this.outcomeUnknown = outcomeUnknown;
  }
}

export async function mpRequest(path: string, init: RequestInit = {}) {
  const cfg = config();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`https://api.mercadopago.com${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "authorization": `Bearer ${cfg.mpAccessToken}`,
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new MercadoPagoError(0, "MP_NETWORK_ERROR", true);
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    const unknown = response.status >= 500 || response.status === 408 || response.status === 429;
    throw new MercadoPagoError(response.status, `MP_HTTP_${response.status}`, unknown);
  }
  return body;
}

export function validCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const officialHost = hostname === "mercadopago.com"
      || hostname.endsWith(".mercadopago.com")
      || hostname === "mercadopago.com.br"
      || hostname.endsWith(".mercadopago.com.br");
    return url.protocol === "https:" && url.port === "" && officialHost;
  } catch {
    return false;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhookSignature(
  signature: string,
  requestId: string,
  dataId: string,
  secret: string,
  nowMs = Date.now(),
): Promise<{ timestamp: Date }> {
  const parts = Object.fromEntries(signature.split(",").map((part) => part.trim().split("=", 2)));
  const ts = parts.ts;
  const received = parts.v1?.toLowerCase();
  if (!ts || !received || !/^\d+$/.test(ts) || !/^[0-9a-f]{64}$/.test(received)) {
    throw new Error("WEBHOOK_SIGNATURE_INVALID");
  }
  const rawTimestamp = Number(ts);
  const timestampMs = rawTimestamp < 1_000_000_000_000 ? rawTimestamp * 1000 : rawTimestamp;
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > 5 * 60 * 1000) {
    throw new Error("WEBHOOK_SIGNATURE_EXPIRED");
  }
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)));
  if (!timingSafeEqual(expected, received)) throw new Error("WEBHOOK_SIGNATURE_INVALID");
  return { timestamp: new Date(timestampMs) };
}

export function assertPaymentEnvironment(
  payment: Record<string, any>,
  environment: "test" | "production",
): void {
  const declaredEnvironment = String(payment?.metadata?.triaxis_environment || "").trim();
  if (declaredEnvironment && declaredEnvironment !== environment) {
    throw new Error("PAYMENT_ENVIRONMENT_MISMATCH");
  }
  // Produção nunca aceita recursos de teste. No QA, credenciais de teste novas
  // podem retornar live_mode=true; collector, referência, valor e moeda ainda
  // são validados antes de qualquer transição financeira.
  if (environment === "production" && payment.live_mode !== true) {
    throw new Error("PAYMENT_ENVIRONMENT_MISMATCH");
  }
}

export function paymentRpcPayload(payment: Record<string, any>) {
  return {
    payment_resource_id: String(payment.id || ""),
    payment_external_reference: String(payment.external_reference || ""),
    payment_account_id: String(payment.collector_id || payment.marketplace_owner || ""),
    payment_status: String(payment.status || ""),
    payment_status_detail: String(payment.status_detail || ""),
    payment_amount: Number(payment.transaction_amount),
    payment_currency: String(payment.currency_id || ""),
    payment_method_id: String(payment.payment_method_id || ""),
    payment_type_id: String(payment.payment_type_id || ""),
    payment_created_at: payment.date_created || null,
    payment_updated_at: payment.date_last_updated || null,
    payment_paid_at: payment.date_approved || null,
  };
}
