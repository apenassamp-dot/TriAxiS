-- O Checkout Pro brasileiro retorna init_point em mercadopago.com.br.
-- Mantemos HTTPS obrigatório e aceitamos somente o domínio oficial ou subdomínios.
create or replace function public.complete_mercadopago_preference_v1(
  target_transaction_id uuid,
  preference_id text,
  checkout_url text,
  sandbox_checkout_url text,
  preference_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(btrim(preference_id), '') is null
     or (
       checkout_url is not null
       and checkout_url !~ '^https://([a-z0-9-]+\.)*mercadopago\.(com|com\.br)/'
     )
     or (
       sandbox_checkout_url is not null
       and sandbox_checkout_url !~ '^https://([a-z0-9-]+\.)*mercadopago\.(com|com\.br)/'
     ) then
    raise exception 'PAYMENT_PREFERENCE_RESPONSE_INVALID';
  end if;

  update public.payment_transactions
  set provider_preference_id = btrim(preference_id),
      checkout_url = complete_mercadopago_preference_v1.checkout_url,
      sandbox_checkout_url = complete_mercadopago_preference_v1.sandbox_checkout_url,
      expires_at = preference_expires_at,
      status = 'pending',
      status_detail = null
  where id = target_transaction_id
    and status in ('preference_pending', 'pending');

  if not found then
    raise exception 'PAYMENT_TRANSACTION_NOT_COMPLETABLE';
  end if;
end;
$$;
