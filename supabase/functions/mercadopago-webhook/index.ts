import { config } from "../_shared/config.ts";
import { json, safeError } from "../_shared/http.ts";
import { assertPaymentEnvironment, mpRequest, paymentRpcPayload, sha256Hex, verifyWebhookSignature } from "../_shared/mercado-pago.ts";
import { adminClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(request, { error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const cfg = config();
    if (!cfg.mpWebhookSecret) throw new Error("CONFIG_MISSING:MP_WEBHOOK_SECRET");
    const url = new URL(request.url);
    const raw = await request.text();
    const body = raw ? JSON.parse(raw) : {};
    const dataId = String(url.searchParams.get("data.id") || body?.data?.id || "").trim();
    const requestId = String(request.headers.get("x-request-id") || "").trim();
    const signature = String(request.headers.get("x-signature") || "").trim();
    if (!dataId || !requestId || !signature) throw new Error("WEBHOOK_HEADERS_MISSING");
    const verified = await verifyWebhookSignature(signature, requestId, dataId, cfg.mpWebhookSecret);
    if (String(body?.type || "").trim().toLowerCase() !== "payment") {
      return json(request, { accepted: false, ignored: true }, 200);
    }

    const payment = await mpRequest(`/v1/payments/${encodeURIComponent(dataId)}`);
    if (String(payment.id || "") !== dataId) throw new Error("PAYMENT_RESOURCE_MISMATCH");
    assertPaymentEnvironment(payment, cfg.environment);
    if (String(payment.collector_id || "") !== cfg.mpCollectorId) throw new Error("PAYMENT_COLLECTOR_MISMATCH");
    const payloadHash = await sha256Hex(raw);
    const admin = adminClient();
    const { data, error } = await admin.rpc("record_mercadopago_payment_v1", {
      payment_event_key: `mercadopago:${requestId}:${dataId}`,
      payment_request_id: requestId,
      payment_action: String(body?.action || body?.type || "payment.updated"),
      payment_payload_hash: payloadHash,
      ...paymentRpcPayload(payment),
      payment_environment: cfg.environment,
      payment_signature_timestamp: verified.timestamp.toISOString(),
    });
    if (error) throw error;
    // 200 também para duplicata/ignorado; o ledger já reteve a decisão.
    return json(request, { accepted: Boolean(data?.accepted) }, 200);
  } catch (error) {
    const code = safeError(error);
    console.error(JSON.stringify({
      event: "mercadopago_webhook_rejected",
      code,
      hasRequestId: Boolean(request.headers.get("x-request-id")),
      hasSignature: Boolean(request.headers.get("x-signature")),
    }));
    const status = code.startsWith("WEBHOOK_") ? 401 : 500;
    return json(request, { error: code }, status);
  }
});
