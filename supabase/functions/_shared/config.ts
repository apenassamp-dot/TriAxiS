export type PaymentEnvironment = "test" | "production";

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`CONFIG_MISSING:${name}`);
  return value;
}

function keyFromJson(name: string): string | null {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return String(parsed[0] || "").trim() || null;
    if (typeof parsed === "object" && parsed) {
      return String(Object.values(parsed)[0] || "").trim() || null;
    }
  } catch {
    throw new Error(`CONFIG_INVALID:${name}`);
  }
  return null;
}

export function config() {
  const environment = (Deno.env.get("PAYMENTS_ENVIRONMENT") || "test") as PaymentEnvironment;
  if (!["test", "production"].includes(environment)) throw new Error("CONFIG_INVALID:PAYMENTS_ENVIRONMENT");
  const productionEnabled = (Deno.env.get("PAYMENTS_PRODUCTION_ENABLED") || "false").toLowerCase() === "true";
  if (environment === "production" && !productionEnabled) throw new Error("PRODUCTION_PAYMENTS_LOCKED");
  return {
    environment,
    productionEnabled,
    supabaseUrl: required("SUPABASE_URL"),
    publicKey: Deno.env.get("SUPABASE_ANON_KEY")?.trim()
      || keyFromJson("SUPABASE_PUBLISHABLE_KEYS")
      || required("SUPABASE_ANON_KEY"),
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
      || keyFromJson("SUPABASE_SECRET_KEYS")
      || required("SUPABASE_SERVICE_ROLE_KEY"),
    mpAccessToken: required("MP_ACCESS_TOKEN"),
    mpWebhookSecret: Deno.env.get("MP_WEBHOOK_SECRET")?.trim() || "",
    mpCollectorId: required("MP_COLLECTOR_ID"),
    publicSiteUrl: required("PUBLIC_SITE_URL").replace(/\/+$/, ""),
    allowedOrigins: new Set(required("PAYMENTS_ALLOWED_ORIGINS").split(",").map((v) => v.trim()).filter(Boolean)),
    requireAal2: (Deno.env.get("PAYMENTS_REQUIRE_AAL2") || "true").toLowerCase() === "true",
    reconciliationSecret: Deno.env.get("PAYMENTS_RECONCILIATION_SECRET")?.trim() || "",
  };
}
