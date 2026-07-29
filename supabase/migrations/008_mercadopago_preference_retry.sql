-- Renova preferências expiradas sem criar uma segunda transação financeira.
-- A request_key continua representando a intenção idempotente do cliente;
-- provider_request_key representa cada tentativa idempotente no Mercado Pago.

alter table public.payment_transactions
  add column if not exists provider_request_key uuid;

update public.payment_transactions
set provider_request_key = request_key
where provider_request_key is null;

alter table public.payment_transactions
  alter column provider_request_key set default gen_random_uuid(),
  alter column provider_request_key set not null;

create unique index if not exists payment_transactions_provider_request_unique_idx
  on public.payment_transactions (provider, environment, provider_request_key);

do $$
begin
  if exists (
    select 1
    from public.payment_transactions
    where provider_preference_id is not null
    group by provider, environment, provider_preference_id
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_PROVIDER_PREFERENCE_ID';
  end if;
end;
$$;

create unique index if not exists payment_transactions_provider_preference_unique_idx
  on public.payment_transactions (provider, environment, provider_preference_id)
  where provider_preference_id is not null;

create or replace function public.begin_mercadopago_checkout_v1(
  target_order_id uuid,
  request_key uuid,
  actor_user_id uuid,
  target_environment text,
  provider_account_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.orders%rowtype;
  current_item public.order_items%rowtype;
  tx public.payment_transactions%rowtype;
  effective_status text;
begin
  if target_environment not in ('test', 'production') then
    raise exception 'PAYMENT_ENVIRONMENT_INVALID';
  end if;
  if request_key is null or actor_user_id is null
     or nullif(btrim(provider_account_id), '') is null then
    raise exception 'PAYMENT_INPUT_INVALID';
  end if;

  select * into current_order
  from public.orders
  where id = target_order_id
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if current_order.customer_id <> actor_user_id then raise exception 'ORDER_ACCESS_DENIED'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = actor_user_id and p.status = 'active'
  ) then raise exception 'ACTOR_INACTIVE'; end if;

  select * into tx
  from public.payment_transactions
  where provider = 'mercado_pago'
    and environment = target_environment
    and payment_transactions.request_key = begin_mercadopago_checkout_v1.request_key
  for update;

  if found then
    if tx.order_id <> target_order_id or tx.created_by <> actor_user_id then
      raise exception 'PAYMENT_IDEMPOTENCY_CONFLICT';
    end if;
  else
    select * into tx
    from public.payment_transactions
    where order_id = target_order_id
      and status in (
        'created', 'preference_pending', 'preference_unknown', 'pending', 'in_process',
        'approved', 'expired', 'in_mediation', 'charged_back', 'partially_refunded'
      )
    for update;

    if not found then
      if current_order.operational_status not in ('order_received', 'awaiting_payment') then
        raise exception 'ORDER_NOT_PAYABLE';
      end if;
      insert into public.payment_transactions (
        order_id, environment, request_key, provider_account_id, amount, currency,
        created_by, status
      ) values (
        target_order_id, target_environment, request_key, btrim(provider_account_id),
        current_order.total, current_order.currency, actor_user_id, 'preference_pending'
      )
      returning * into tx;
    end if;
  end if;

  if tx.environment <> target_environment
     or tx.provider_account_id <> btrim(provider_account_id) then
    raise exception 'PAYMENT_ACTIVE_CONFLICT';
  end if;

  effective_status := tx.status;

  if tx.status in ('failed', 'expired') then
    if tx.provider_payment_id is not null then raise exception 'PAYMENT_ALREADY_BOUND'; end if;
    update public.payment_transactions
    set status = 'preference_pending',
        status_detail = null,
        provider_preference_id = null,
        checkout_url = null,
        sandbox_checkout_url = null,
        expires_at = null,
        provider_request_key = gen_random_uuid()
    where id = tx.id
    returning * into tx;
    effective_status := tx.status;
  elsif tx.status = 'pending'
        and tx.expires_at is not null
        and tx.expires_at <= timezone('utc', now()) then
    if tx.provider_payment_id is not null then
      effective_status := 'payment_pending';
    elsif tx.expires_at > timezone('utc', now()) - interval '5 minutes' then
      effective_status := 'expiration_grace';
    else
      if current_order.operational_status not in ('order_received', 'awaiting_payment') then
        raise exception 'ORDER_NOT_PAYABLE';
      end if;
      update public.payment_transactions
      set status = 'preference_pending',
          status_detail = null,
          provider_preference_id = null,
          checkout_url = null,
          sandbox_checkout_url = null,
          expires_at = null,
          provider_request_key = gen_random_uuid()
      where id = tx.id
      returning * into tx;
      effective_status := tx.status;
    end if;
  elsif tx.status = 'pending' and tx.provider_payment_id is not null then
    effective_status := 'payment_pending';
  end if;

  if current_order.operational_status = 'order_received' then
    update public.orders
    set operational_status = 'awaiting_payment'
    where id = target_order_id;
    insert into public.order_operational_history (
      order_id, from_status, to_status, changed_by, actor_kind, reason, metadata
    ) values (
      target_order_id, 'order_received', 'awaiting_payment', actor_user_id, 'human',
      'Checkout seguro iniciado pelo cliente.',
      jsonb_build_object('provider', 'mercado_pago', 'transaction_id', tx.id)
    );
  end if;

  select * into current_item
  from public.order_items
  where order_id = target_order_id
  order by created_at, id
  limit 1;
  if not found then raise exception 'ORDER_ITEM_NOT_FOUND'; end if;

  return jsonb_build_object(
    'transactionId', tx.id,
    'externalReference', tx.external_reference,
    'providerRequestKey', tx.provider_request_key,
    'status', effective_status,
    'checkoutUrl', case
      when effective_status = 'pending' and target_environment = 'production' then tx.checkout_url
      when effective_status = 'pending' then tx.sandbox_checkout_url
      else null
    end,
    'orderId', current_order.id,
    'orderCode', current_order.order_code,
    'amount', tx.amount,
    'currency', tx.currency,
    'itemName', left(coalesce(current_item.product_snapshot ->> 'name', 'Artefato TriAxis'), 120),
    'quantity', current_item.quantity
  );
end;
$$;

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
declare
  tx public.payment_transactions%rowtype;
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

  select * into tx
  from public.payment_transactions
  where id = target_transaction_id
  for update;

  if not found or tx.provider_payment_id is not null then
    raise exception 'PAYMENT_TRANSACTION_NOT_COMPLETABLE';
  end if;

  if tx.status = 'pending' then
    if tx.provider_preference_id = btrim(preference_id)
       and tx.checkout_url is not distinct from complete_mercadopago_preference_v1.checkout_url
       and tx.sandbox_checkout_url is not distinct from complete_mercadopago_preference_v1.sandbox_checkout_url
       and tx.expires_at is not distinct from preference_expires_at then
      return;
    end if;
    raise exception 'PAYMENT_PREFERENCE_CONFLICT';
  end if;

  if tx.status <> 'preference_pending' then
    raise exception 'PAYMENT_TRANSACTION_NOT_COMPLETABLE';
  end if;

  update public.payment_transactions
  set provider_preference_id = btrim(preference_id),
      checkout_url = complete_mercadopago_preference_v1.checkout_url,
      sandbox_checkout_url = complete_mercadopago_preference_v1.sandbox_checkout_url,
      expires_at = preference_expires_at,
      status = 'pending',
      status_detail = null
  where id = target_transaction_id;
end;
$$;

revoke all on function public.begin_mercadopago_checkout_v1(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.complete_mercadopago_preference_v1(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.begin_mercadopago_checkout_v1(uuid, uuid, uuid, text, text)
  to service_role;
grant execute on function public.complete_mercadopago_preference_v1(uuid, text, text, text, timestamptz)
  to service_role;
