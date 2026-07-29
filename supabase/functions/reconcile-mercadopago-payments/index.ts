import { config } from "../_shared/config.ts";
import { json, safeError } from "../_shared/http.ts";
import { assertPaymentEnvironment, mpRequest, paymentRpcPayload, sha256Hex } from "../_shared/mercado-pago.ts";
import { adminClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(request, { error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const cfg = config();
    const supplied = request.headers.get("x-reconciliation-secret") || "";
    if (!cfg.reconciliationSecret || supplied !== cfg.reconciliationSecret) throw new Error("RECONCILIATION_DENIED");
    const admin = adminClient();
    const { data: candidates, error } = await admin.rpc("list_mercadopago_reconciliation_v1", { candidate_limit: 50 });
    if (error) throw error;
    let processed = 0;
    for (const candidate of candidates || []) {
      if (!candidate.provider_payment_id || candidate.environment !== cfg.environment) continue;
      const payment = await mpRequest(`/v1/payments/${encodeURIComponent(candidate.provider_payment_id)}`);
      assertPaymentEnvironment(payment, cfg.environment);
      if (String(payment.collector_id || "") !== cfg.mpCollectorId) throw new Error("PAYMENT_COLLECTOR_MISMATCH");
      const canonical = JSON.stringify(payment);
      const { error: recordError } = await admin.rpc("record_mercadopago_payment_v1", {
        payment_event_key: `reconcile:${candidate.transaction_id}:${payment.date_last_updated || payment.status}`,
        payment_request_id: `reconcile:${candidate.transaction_id}`,
        payment_action: "payment.reconciled",
        payment_payload_hash: await sha256Hex(canonical),
        ...paymentRpcPayload(payment),
        payment_environment: cfg.environment,
        payment_signature_timestamp: null,
      });
      if (recordError) throw recordError;
      processed += 1;
    }
    return json(request, { processed });
  } catch (error) {
    const code = safeError(error);
    return json(request, { error: code }, code.includes("DENIED") ? 401 : 500);
  }
});
