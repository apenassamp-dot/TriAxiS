import type { PaymentEnvironment } from "./config.ts";

export function mercadoPagoWebhookUrl(supabaseUrl: string): string {
  const base = new URL(supabaseUrl);
  if (base.protocol !== "https:") throw new Error("CONFIG_INVALID:SUPABASE_URL");
  const webhook = new URL("/functions/v1/mercadopago-webhook", base);
  webhook.searchParams.set("source_news", "webhooks");
  return webhook.toString();
}

export function payerForPreference(
  environment: PaymentEnvironment,
  authenticatedEmail: unknown,
): { email: string } | null {
  if (environment === "test") return null;
  const email = typeof authenticatedEmail === "string" ? authenticatedEmail.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("AUTH_EMAIL_INVALID");
  }
  return { email };
}
