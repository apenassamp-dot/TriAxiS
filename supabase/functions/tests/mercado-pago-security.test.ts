import { payerForPreference } from "../_shared/checkout.ts";
import { validCheckoutUrl, verifyWebhookSignature } from "../_shared/mercado-pago.ts";

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

async function sign(secret: string, manifest: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)));
}

Deno.test("aceita assinatura válida dentro da janela", async () => {
  const secret = "qa-secret";
  const requestId = "req-123";
  const dataId = "987654";
  const ts = "1785200000000";
  const v1 = await sign(secret, `id:${dataId};request-id:${requestId};ts:${ts};`);
  await verifyWebhookSignature(`ts=${ts},v1=${v1}`, requestId, dataId, secret, Number(ts));
});

Deno.test("rejeita assinatura adulterada", async () => {
  let rejected = false;
  try {
    await verifyWebhookSignature(`ts=1785200000000,v1=${"0".repeat(64)}`, "req-123", "987654", "qa-secret", 1785200000000);
  } catch (error) {
    rejected = String(error).includes("WEBHOOK_SIGNATURE_INVALID");
  }
  if (!rejected) throw new Error("assinatura adulterada foi aceita");
});

Deno.test("rejeita replay fora de cinco minutos", async () => {
  const secret = "qa-secret";
  const ts = "1785200000000";
  const v1 = await sign(secret, `id:987654;request-id:req-123;ts:${ts};`);
  let rejected = false;
  try {
    await verifyWebhookSignature(`ts=${ts},v1=${v1}`, "req-123", "987654", secret, Number(ts) + 301000);
  } catch (error) {
    rejected = String(error).includes("WEBHOOK_SIGNATURE_EXPIRED");
  }
  if (!rejected) throw new Error("replay expirado foi aceito");
});

Deno.test("aceita apenas checkout HTTPS em domínios oficiais do Mercado Pago", () => {
  const accepted = [
    "https://www.mercadopago.com.br/checkout/v1/redirect",
    "https://sandbox.mercadopago.com.br/checkout/v1/redirect",
    "https://www.mercadopago.com/checkout/v1/redirect",
  ];
  const rejected = [
    "http://www.mercadopago.com.br/checkout",
    "https://www.mercadopago.com.br:444/checkout",
    "https://mercadopago.com.br.example.com/checkout",
    "https://evilmercadopago.com.br/checkout",
  ];
  if (!accepted.every(validCheckoutUrl)) throw new Error("domínio oficial foi rejeitado");
  if (rejected.some(validCheckoutUrl)) throw new Error("domínio não oficial foi aceito");
});

Deno.test("omite payer no ambiente de teste", () => {
  if (payerForPreference("test", "cliente@example.com") !== null) {
    throw new Error("payer de produção vazou para o ambiente de teste");
  }
});

Deno.test("normaliza payer autenticado somente em produção", () => {
  const payer = payerForPreference("production", " Cliente@Example.COM ");
  if (payer?.email !== "cliente@example.com") throw new Error("payer de produção inválido");
});

Deno.test("rejeita email autenticado inválido em produção", () => {
  let rejected = false;
  try {
    payerForPreference("production", "email-invalido");
  } catch (error) {
    rejected = String(error).includes("AUTH_EMAIL_INVALID");
  }
  if (!rejected) throw new Error("email inválido foi aceito");
});
