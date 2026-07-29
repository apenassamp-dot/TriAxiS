import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { config } from "./config.ts";

export function adminClient() {
  const cfg = config();
  return createClient(cfg.supabaseUrl, cfg.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(request: Request, requireAal2 = false) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) throw new Error("AUTH_REQUIRED");
  const cfg = config();
  const client = createClient(cfg.supabaseUrl, cfg.publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("AUTH_INVALID");

  if (requireAal2) {
    const token = authorization.slice(7);
    const encoded = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") || "";
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
    if (payload.aal !== "aal2") throw new Error("AAL2_REQUIRED");
  }
  return data.user;
}
