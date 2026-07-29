import { config } from "../_shared/config.ts";
import { assertOrigin, isUuid, json, safeError } from "../_shared/http.ts";
import { MercadoPagoError, mpRequest } from "../_shared/mercado-pago.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return json(request, {}, 204);
  try {
    if (request.method !== "POST") return json(request, { error: "METHOD_NOT_ALLOWED" }, 405);
    assertOrigin(request);
    const cfg = config();
    const user = await requireUser(request, cfg.requireAal2);
    const body = await request.json();
    if (!isUuid(body.orderId) || !isUuid(body.requestKey) || String(body.reason || "").trim().length < 3) {
      return json(request, { error: "INPUT_INVALID" }, 400);
    }
    const admin = adminClient();
    const { data: refund, error } = await admin.rpc("begin_mercadopago_refund_v1", {
      target_order_id: body.orderId,
      request_key: body.requestKey,
      actor_user_id: user.id,
      refund_reason: String(body.reason).trim().slice(0, 1000),
    });
    if (error) throw error;
    if (refund.status === "approved") return json(request, { status: "approved" });
    if (["failed", "rejected"].includes(refund.status)) return json(request, { error: "REFUND_RETRY_WITH_NEW_REQUEST" }, 409);

    let result;
    try {
      result = await mpRequest(`/v1/payments/${encodeURIComponent(refund.paymentId)}/refunds`, {
        method: "POST",
        headers: { "x-idempotency-key": body.requestKey },
        body: JSON.stringify({ amount: Number(refund.amount) }),
      });
    } catch (refundError) {
      if (refundError instanceof MercadoPagoError && !refundError.outcomeUnknown) {
        await admin.rpc("complete_mercadopago_refund_v1", {
          target_refund_id: refund.refundId,
          provider_refund_id: null,
          provider_refund_status: "failed",
          provider_refund_amount: Number(refund.amount),
          provider_refund_created_at: null,
          safe_error_code: safeError(refundError),
        });
      }
      throw refundError;
    }
    const status = String(result.status || "pending");
    const { error: completeError } = await admin.rpc("complete_mercadopago_refund_v1", {
      target_refund_id: refund.refundId,
      provider_refund_id: String(result.id || ""),
      provider_refund_status: ["approved", "pending", "rejected"].includes(status) ? status : "failed",
      provider_refund_amount: Number(result.amount),
      provider_refund_created_at: result.date_created || null,
      safe_error_code: null,
    });
    if (completeError) throw completeError;
    return json(request, { status });
  } catch (error) {
    const code = safeError(error);
    const status = code.includes("AUTH_") ? 401 : code.includes("AAL2_") ? 403 : 400;
    return json(request, { error: code }, status);
  }
});
