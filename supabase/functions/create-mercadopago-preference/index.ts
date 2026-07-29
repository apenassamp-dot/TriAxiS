import { config } from "../_shared/config.ts";
import { mercadoPagoWebhookUrl, payerForPreference } from "../_shared/checkout.ts";
import { assertOrigin, isUuid, json, safeError } from "../_shared/http.ts";
import { MercadoPagoError, mpRequest, validCheckoutUrl } from "../_shared/mercado-pago.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

function checkoutHostname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return json(request, {}, 204);
  try {
    if (request.method !== "POST") return json(request, { error: "METHOD_NOT_ALLOWED" }, 405);
    assertOrigin(request);
    const user = await requireUser(request);
    const body = await request.json();
    if (!isUuid(body.orderId) || !isUuid(body.requestKey)) return json(request, { error: "INPUT_INVALID" }, 400);
    const cfg = config();
    const admin = adminClient();
    const { data: checkout, error } = await admin.rpc("begin_mercadopago_checkout_v1", {
      target_order_id: body.orderId,
      request_key: body.requestKey,
      actor_user_id: user.id,
      target_environment: cfg.environment,
      provider_account_id: cfg.mpCollectorId,
    });
    if (error) throw error;
    if (checkout.checkoutUrl && validCheckoutUrl(checkout.checkoutUrl)) {
      return json(request, { checkoutUrl: checkout.checkoutUrl, status: checkout.status });
    }
    if (checkout.status === "preference_unknown") {
      return json(request, { error: "PAYMENT_RECONCILIATION_PENDING" }, 409);
    }
    if (checkout.status === "expiration_grace") {
      return json(request, { error: "PAYMENT_EXPIRATION_RECONCILIATION_PENDING" }, 409);
    }
    if (["payment_pending", "in_process"].includes(checkout.status)) {
      return json(request, { error: "PAYMENT_CONFIRMATION_PENDING" }, 409);
    }
    if (["approved", "partially_refunded", "refunded"].includes(checkout.status)) {
      return json(request, { error: "PAYMENT_ALREADY_COMPLETED" }, 409);
    }
    if (checkout.status !== "preference_pending" || !isUuid(checkout.providerRequestKey)) {
      return json(request, { error: "PAYMENT_CHECKOUT_STATE_INVALID" }, 409);
    }

    try {
      const payer = payerForPreference(cfg.environment, user.email);
      const preference = await mpRequest("/checkout/preferences", {
        method: "POST",
        headers: { "x-idempotency-key": checkout.providerRequestKey },
        body: JSON.stringify({
          external_reference: checkout.externalReference,
          items: [{
            id: checkout.orderId,
            title: checkout.itemName,
            quantity: 1,
            currency_id: checkout.currency,
            unit_price: Number(checkout.amount),
          }],
          ...(payer ? { payer } : {}),
          metadata: {
            triaxis_environment: cfg.environment,
          },
          notification_url: mercadoPagoWebhookUrl(cfg.supabaseUrl),
          back_urls: {
            success: `${cfg.publicSiteUrl}/?payment=success`,
            pending: `${cfg.publicSiteUrl}/?payment=pending`,
            failure: `${cfg.publicSiteUrl}/?payment=failure`,
          },
          auto_return: "approved",
          expires: true,
          expiration_date_from: new Date().toISOString(),
          expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          statement_descriptor: "TRIAXIS",
        }),
      });
      if (preference.collector_id != null && String(preference.collector_id) !== cfg.mpCollectorId) {
        throw new Error("PAYMENT_COLLECTOR_MISMATCH");
      }
      const initPoint = validCheckoutUrl(preference.init_point) ? preference.init_point : null;
      const sandboxInitPoint = validCheckoutUrl(preference.sandbox_init_point) ? preference.sandbox_init_point : null;
      const checkoutUrl = cfg.environment === "production" ? initPoint : (sandboxInitPoint || initPoint);
      if (!validCheckoutUrl(checkoutUrl)) {
        console.error("PAYMENT_CHECKOUT_URL_INVALID", {
          initPointHostname: checkoutHostname(preference.init_point),
          sandboxInitPointHostname: checkoutHostname(preference.sandbox_init_point),
        });
        throw new Error("PAYMENT_CHECKOUT_URL_INVALID");
      }
      const { error: completeError } = await admin.rpc("complete_mercadopago_preference_v1", {
        target_transaction_id: checkout.transactionId,
        preference_id: String(preference.id || ""),
        checkout_url: initPoint,
        sandbox_checkout_url: sandboxInitPoint,
        preference_expires_at: preference.expiration_date_to || null,
      });
      if (completeError) throw completeError;
      return json(request, { checkoutUrl, status: "pending" });
    } catch (error) {
      const outcomeUnknown = error instanceof MercadoPagoError ? error.outcomeUnknown : false;
      await admin.rpc("fail_mercadopago_preference_v1", {
        target_transaction_id: checkout.transactionId,
        safe_error_code: safeError(error),
        outcome_unknown: outcomeUnknown,
      });
      throw error;
    }
  } catch (error) {
    const code = safeError(error);
    console.error("CREATE_MP_PREFERENCE_FAILED", code);
    const status = code.includes("AUTH_") ? 401 : code.includes("ORIGIN_") ? 403 : 400;
    return json(request, { error: code }, status);
  }
});
