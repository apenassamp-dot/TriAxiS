import { mercadoPagoWebhookUrl } from "../_shared/checkout.ts";

Deno.test("solicita exclusivamente Webhooks assinados na preferencia", () => {
  const url = new URL(mercadoPagoWebhookUrl("https://project-ref.supabase.co/rest/v1/"));
  if (url.origin !== "https://project-ref.supabase.co") throw new Error("origem do webhook foi alterada");
  if (url.pathname !== "/functions/v1/mercadopago-webhook") throw new Error("endpoint do webhook invalido");
  if (url.searchParams.get("source_news") !== "webhooks") throw new Error("preferencia ainda aceita IPN legado");
});

Deno.test("rejeita base HTTP para o webhook", () => {
  let rejected = false;
  try {
    mercadoPagoWebhookUrl("http://project-ref.supabase.co");
  } catch (error) {
    rejected = String(error).includes("CONFIG_INVALID:SUPABASE_URL");
  }
  if (!rejected) throw new Error("webhook sem HTTPS foi aceito");
});
