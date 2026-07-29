import { assertPaymentEnvironment } from "../_shared/mercado-pago.ts";

Deno.test("mantem producao estrita e aceita live_mode das novas credenciais no QA", () => {
  assertPaymentEnvironment({ live_mode: true }, "test");
  assertPaymentEnvironment({ live_mode: false }, "test");
  assertPaymentEnvironment({ live_mode: true }, "production");

  let rejected = false;
  try {
    assertPaymentEnvironment({ live_mode: false }, "production");
  } catch (error) {
    rejected = String(error).includes("PAYMENT_ENVIRONMENT_MISMATCH");
  }
  if (!rejected) throw new Error("producao aceitou pagamento de teste");
});

Deno.test("rejeita metadata de ambiente divergente", () => {
  let rejected = false;
  try {
    assertPaymentEnvironment({
      live_mode: true,
      metadata: { triaxis_environment: "production" },
    }, "test");
  } catch (error) {
    rejected = String(error).includes("PAYMENT_ENVIRONMENT_MISMATCH");
  }
  if (!rejected) throw new Error("metadata de outro ambiente foi aceita");
});
