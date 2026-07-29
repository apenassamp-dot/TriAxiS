-- TriAxis Nexus V4 — Pagamentos por provedor (Mercado Pago)
-- Aplicar depois de 005_actor_separation_refund_evidence.sql.
--
-- Segurança:
--   * somente service_role chama os RPCs de integração;
--   * o navegador nunca confirma pagamento ou reembolso;
--   * preço/moeda são comparados com o pedido autoritativo;
--   * eventos são idempotentes e não armazenam payload bruto/PII;
--   * mudanças financeiras no pedido exigem contexto verificado.

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  environment text not null check (environment in ('test', 'production')),
  request_key uuid not null,
  external_reference uuid not null default gen_random_uuid(),
  provider_account_id text not null,
  provider_preference_id text,
  provider_payment_id text,
  status text not null default 'created' check (status in (
    'created', 'preference_pending', 'preference_unknown', 'pending', 'in_process',
    'approved', 'rejected', 'cancelled', 'expired', 'in_mediation',
    'charged_back', 'partially_refunded', 'refunded', 'failed'
  )),
  status_detail text,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  payment_method_id text,
  payment_type_id text,
  checkout_url text,
  sandbox_checkout_url text,
  expires_at timestamptz,
  paid_at timestamptz,
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (provider, environment, request_key),
  unique (provider, environment, external_reference)
);

create unique index if not exists payment_transactions_provider_payment_unique_idx
  on public.payment_transactions (provider, environment, provider_payment_id)
  where provider_payment_id is not null;

create unique index if not exists payment_transactions_active_order_unique_idx
  on public.payment_transactions (order_id)
  where status in (
    'created', 'preference_pending', 'preference_unknown', 'pending', 'in_process',
    'approved', 'in_mediation', 'charged_back', 'partially_refunded'
  );

create index if not exists payment_transactions_reconciliation_idx
  on public.payment_transactions (status, updated_at);

create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  event_key text not null unique check (char_length(event_key) between 16 and 240),
  transaction_id uuid references public.payment_transactions(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  resource_id text,
  action text,
  request_id text,
  signature_timestamp timestamptz,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  provider_status text,
  processing_status text not null check (processing_status in (
    'received', 'processed', 'duplicate', 'ignored', 'rejected', 'error'
  )),
  error_code text,
  attempts integer not null default 1 check (attempts between 1 and 1000),
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz
);

create index if not exists payment_events_transaction_idx
  on public.payment_events (transaction_id, received_at desc);

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.payment_transactions(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  request_key uuid not null unique,
  provider_refund_id text,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'created' check (status in (
    'created', 'pending', 'approved', 'rejected', 'failed'
  )),
  requested_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  error_code text,
  provider_created_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (requested_by <> approved_by)
);

create unique index if not exists payment_refunds_provider_unique_idx
  on public.payment_refunds (provider_refund_id)
  where provider_refund_id is not null;

drop trigger if exists payment_transactions_set_updated_at on public.payment_transactions;
create trigger payment_transactions_set_updated_at
before update on public.payment_transactions
for each row execute function public.set_updated_at();

drop trigger if exists payment_refunds_set_updated_at on public.payment_refunds;
create trigger payment_refunds_set_updated_at
before update on public.payment_refunds
for each row execute function public.set_updated_at();

alter table public.payment_transactions enable row level security;
alter table public.payment_events enable row level security;
alter table public.payment_refunds enable row level security;

drop policy if exists payment_transactions_customer_select on public.payment_transactions;
create policy payment_transactions_customer_select on public.payment_transactions
for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and o.customer_id = auth.uid()
  )
  or public.has_role('admin')
  or public.has_operational_role('finance')
);

drop policy if exists payment_refunds_customer_select on public.payment_refunds;
create policy payment_refunds_customer_select on public.payment_refunds
for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and o.customer_id = auth.uid()
  )
  or public.has_role('admin')
  or public.has_operational_role('finance')
);

revoke all on public.payment_transactions from anon, authenticated;
revoke all on public.payment_events from anon, authenticated;
revoke all on public.payment_refunds from anon, authenticated;

grant select (
  id, order_id, provider, environment, status, status_detail, amount, currency,
  expires_at, paid_at, created_at, updated_at
) on public.payment_transactions to authenticated;

grant select (
  id, transaction_id, order_id, amount, status, provider_created_at, created_at, updated_at
) on public.payment_refunds to authenticated;

-- Remove leitura direta dos campos financeiros/PII legados do pedido. O frontend
-- usa somente o conjunto operacional mínimo; evidência do provedor fica no ledger.
revoke select on public.orders from authenticated;
grant select (
  id, order_code, customer_id, status, currency, subtotal, total, customer_notes,
  submitted_at, created_at, updated_at, idempotency_key, operational_status,
  discount, shipping_fee, payment_received_at, payment_validated_at, approved_at,
  capacity_confirmed_at, production_due_at, delivery_method, delivery_details,
  tracking_code, delivered_at, cancellation_reason, exception_reason,
  specification_revision, refund_amount, refund_requested_at, refund_processed_at
) on public.orders to authenticated;

alter table public.order_operational_history
  alter column changed_by drop not null,
  add column if not exists actor_kind text not null default 'human',
  add column if not exists provider_event_id bigint references public.payment_events(id) on delete set null;

do $$ begin
  alter table public.order_operational_history
    add constraint order_operational_history_actor_kind_check
    check (
      actor_kind in ('human', 'provider', 'system')
      and (actor_kind <> 'human' or changed_by is not null)
    );
exception when duplicate_object then null;
end $$;

create or replace function public.guard_provider_financial_fields_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  verified boolean := coalesce(current_setting('app.payment_provider_context', true), '') = 'verified';
begin
  if verified then return new; end if;

  if new.payment_method is distinct from old.payment_method
     or new.payment_reference is distinct from old.payment_reference
     or new.payment_payer is distinct from old.payment_payer
     or new.payment_amount is distinct from old.payment_amount
     or new.payment_received_at is distinct from old.payment_received_at
     or new.payment_received_by is distinct from old.payment_received_by
     or new.refund_reference is distinct from old.refund_reference
     or new.refund_processed_at is distinct from old.refund_processed_at
     or new.refund_processed_by is distinct from old.refund_processed_by
     or new.operational_status in ('payment_received', 'refunded')
        and new.operational_status is distinct from old.operational_status then
    raise exception 'PROVIDER_CONFIRMATION_REQUIRED';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_guard_provider_financial_fields_v1 on public.orders;
create trigger orders_guard_provider_financial_fields_v1
before update on public.orders
for each row execute function public.guard_provider_financial_fields_v1();

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
begin
  if target_environment not in ('test', 'production') then
    raise exception 'PAYMENT_ENVIRONMENT_INVALID';
  end if;
  if request_key is null or actor_user_id is null
     or nullif(btrim(provider_account_id), '') is null then
    raise exception 'PAYMENT_INPUT_INVALID';
  end if;

  select * into current_order from public.orders
  where id = target_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if current_order.customer_id <> actor_user_id then raise exception 'ORDER_ACCESS_DENIED'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = actor_user_id and p.status = 'active'
  ) then raise exception 'ACTOR_INACTIVE'; end if;

  select * into tx from public.payment_transactions
  where provider = 'mercado_pago'
    and environment = target_environment
    and payment_transactions.request_key = begin_mercadopago_checkout_v1.request_key;
  if found then
    if tx.order_id <> target_order_id or tx.created_by <> actor_user_id then
      raise exception 'PAYMENT_IDEMPOTENCY_CONFLICT';
    end if;
    if tx.status = 'failed' then
      update public.payment_transactions
      set status = 'preference_pending', status_detail = null
      where id = tx.id
      returning * into tx;
    end if;
  else
    select * into tx from public.payment_transactions
    where order_id = target_order_id
      and status in (
        'created', 'preference_pending', 'preference_unknown', 'pending', 'in_process',
        'approved', 'in_mediation', 'charged_back', 'partially_refunded'
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
      ) returning * into tx;
    elsif tx.environment <> target_environment or tx.provider_account_id <> btrim(provider_account_id) then
      raise exception 'PAYMENT_ACTIVE_CONFLICT';
    end if;
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

  select * into current_item from public.order_items
  where order_id = target_order_id order by created_at, id limit 1;
  if not found then raise exception 'ORDER_ITEM_NOT_FOUND'; end if;

  return jsonb_build_object(
    'transactionId', tx.id,
    'externalReference', tx.external_reference,
    'status', tx.status,
    'checkoutUrl', case when target_environment = 'production' then tx.checkout_url else tx.sandbox_checkout_url end,
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
begin
  if nullif(btrim(preference_id), '') is null
     or (checkout_url is not null and checkout_url !~ '^https://([a-z0-9-]+\.)*mercadopago\.com/')
     or (sandbox_checkout_url is not null and sandbox_checkout_url !~ '^https://([a-z0-9-]+\.)*mercadopago\.com/') then
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
  if not found then raise exception 'PAYMENT_TRANSACTION_NOT_COMPLETABLE'; end if;
end;
$$;

create or replace function public.fail_mercadopago_preference_v1(
  target_transaction_id uuid,
  safe_error_code text,
  outcome_unknown boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.payment_transactions
  set status = case when outcome_unknown then 'preference_unknown' else 'failed' end,
      status_detail = left(coalesce(nullif(btrim(safe_error_code), ''), 'preference_error'), 160)
  where id = target_transaction_id and status = 'preference_pending';
end;
$$;

create or replace function public.record_mercadopago_payment_v1(
  payment_event_key text,
  payment_request_id text,
  payment_action text,
  payment_payload_hash text,
  payment_resource_id text,
  payment_external_reference uuid,
  payment_account_id text,
  payment_environment text,
  payment_status text,
  payment_status_detail text,
  payment_amount numeric,
  payment_currency text,
  payment_method_id text,
  payment_type_id text,
  payment_created_at timestamptz,
  payment_updated_at timestamptz,
  payment_paid_at timestamptz,
  payment_signature_timestamp timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tx public.payment_transactions%rowtype;
  current_order public.orders%rowtype;
  event_id bigint;
  next_status text;
begin
  if payment_payload_hash !~ '^[0-9a-f]{64}$'
     or nullif(btrim(payment_resource_id), '') is null then
    raise exception 'PAYMENT_EVENT_INPUT_INVALID';
  end if;

  select * into tx from public.payment_transactions
  where provider = 'mercado_pago'
    and environment = payment_environment
    and external_reference = payment_external_reference
  for update;

  insert into public.payment_events (
    event_key, transaction_id, order_id, resource_id, action, request_id,
    signature_timestamp, payload_hash, provider_status, processing_status
  ) values (
    left(payment_event_key, 240), tx.id, tx.order_id, left(payment_resource_id, 160),
    left(payment_action, 160), left(payment_request_id, 160),
    payment_signature_timestamp, payment_payload_hash, left(payment_status, 80), 'received'
  )
  on conflict (event_key) do nothing
  returning id into event_id;

  if event_id is null then
    return jsonb_build_object('accepted', true, 'duplicate', true);
  end if;

  if tx.id is null then
    update public.payment_events set processing_status = 'rejected',
      error_code = 'transaction_not_found', processed_at = timezone('utc', now())
    where id = event_id;
    return jsonb_build_object('accepted', false, 'error', 'transaction_not_found');
  end if;

  if tx.provider_account_id <> btrim(payment_account_id)
     or payment_currency <> tx.currency
     or payment_amount <> tx.amount
     or nullif(btrim(payment_resource_id), '') is null then
    update public.payment_events set processing_status = 'rejected',
      error_code = 'provider_evidence_mismatch', processed_at = timezone('utc', now())
    where id = event_id;
    return jsonb_build_object('accepted', false, 'error', 'provider_evidence_mismatch');
  end if;

  if tx.provider_payment_id is not null and tx.provider_payment_id <> payment_resource_id then
    update public.payment_events set processing_status = 'rejected',
      error_code = 'payment_id_mismatch', processed_at = timezone('utc', now())
    where id = event_id;
    return jsonb_build_object('accepted', false, 'error', 'payment_id_mismatch');
  end if;

  next_status := case payment_status
    when 'approved' then 'approved'
    when 'pending' then 'pending'
    when 'in_process' then 'in_process'
    when 'in_mediation' then 'in_mediation'
    when 'charged_back' then 'charged_back'
    when 'refunded' then 'refunded'
    when 'cancelled' then 'cancelled'
    when 'rejected' then 'rejected'
    else null
  end;

  if next_status is null then
    update public.payment_events set processing_status = 'ignored',
      error_code = 'unsupported_status', processed_at = timezone('utc', now())
    where id = event_id;
    return jsonb_build_object('accepted', true, 'ignored', true);
  end if;

  -- Não regride evidência financeira concluída por evento atrasado.
  if tx.status in ('approved', 'partially_refunded', 'refunded')
     and next_status in ('pending', 'in_process', 'rejected', 'cancelled') then
    update public.payment_events set processing_status = 'ignored',
      error_code = 'stale_state', processed_at = timezone('utc', now())
    where id = event_id;
    return jsonb_build_object('accepted', true, 'ignored', true);
  end if;

  update public.payment_transactions
  set provider_payment_id = payment_resource_id,
      status = next_status,
      status_detail = left(payment_status_detail, 160),
      payment_method_id = left(record_mercadopago_payment_v1.payment_method_id, 80),
      payment_type_id = left(record_mercadopago_payment_v1.payment_type_id, 80),
      provider_created_at = payment_created_at,
      provider_updated_at = payment_updated_at,
      paid_at = payment_paid_at
  where id = tx.id;

  select * into current_order from public.orders where id = tx.order_id for update;

  if next_status = 'approved'
     and current_order.operational_status in ('order_received', 'awaiting_payment', 'blocked') then
    perform set_config('app.payment_provider_context', 'verified', true);
    update public.orders
    set payment_method = 'mercado_pago',
        payment_reference = 'mercadopago:' || payment_resource_id,
        payment_payer = 'Mercado Pago',
        payment_amount = record_mercadopago_payment_v1.payment_amount,
        payment_received_at = coalesce(payment_paid_at, timezone('utc', now())),
        payment_received_by = null,
        operational_status = 'payment_received',
        status = 'submitted'
    where id = tx.order_id;
    insert into public.order_operational_history (
      order_id, from_status, to_status, changed_by, actor_kind, provider_event_id,
      reason, metadata
    ) values (
      tx.order_id, current_order.operational_status, 'payment_received', null, 'provider', event_id,
      'Pagamento confirmado diretamente pelo Mercado Pago.',
      jsonb_build_object('provider', 'mercado_pago', 'transaction_id', tx.id)
    );
    insert into public.audit_events (actor_id, action, entity_type, entity_id, metadata)
    values (null, 'payment.provider_confirmed', 'order', tx.order_id,
      jsonb_build_object('provider', 'mercado_pago', 'transaction_id', tx.id, 'event_id', event_id));
  elsif next_status in ('in_mediation', 'charged_back')
        and current_order.operational_status not in ('refunded', 'cancelled') then
    update public.orders
    set exception_reason = 'Ocorrência financeira informada pelo provedor.',
        operational_metadata = operational_metadata || jsonb_build_object(
          'financial_exception', next_status, 'payment_transaction_id', tx.id
        ),
        operational_status = 'blocked'
    where id = tx.order_id;
    insert into public.order_operational_history (
      order_id, from_status, to_status, changed_by, actor_kind, provider_event_id,
      reason, metadata
    ) values (
      tx.order_id, current_order.operational_status, 'blocked', null, 'provider', event_id,
      'Pedido bloqueado por ocorrência financeira do provedor.',
      jsonb_build_object('provider_status', next_status, 'transaction_id', tx.id)
    );
  end if;

  update public.payment_events set processing_status = 'processed',
    processed_at = timezone('utc', now()) where id = event_id;
  return jsonb_build_object('accepted', true, 'duplicate', false, 'status', next_status);
exception when others then
  if event_id is not null then
    update public.payment_events set processing_status = 'error',
      error_code = left(sqlstate || ':' || sqlerrm, 240), processed_at = timezone('utc', now())
    where id = event_id;
  end if;
  raise;
end;
$$;

create or replace function public.begin_mercadopago_refund_v1(
  target_order_id uuid,
  request_key uuid,
  actor_user_id uuid,
  refund_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.orders%rowtype;
  tx public.payment_transactions%rowtype;
  refund public.payment_refunds%rowtype;
  approved_total numeric;
begin
  if char_length(btrim(coalesce(refund_reason, ''))) not between 3 and 1000 then
    raise exception 'REFUND_REASON_INVALID';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = actor_user_id and p.status = 'active'
  ) or not (
    exists (select 1 from public.user_roles r where r.user_id = actor_user_id and r.role = 'admin')
    or exists (select 1 from public.operational_user_roles r where r.user_id = actor_user_id and r.role = 'finance')
  ) then raise exception 'REFUND_ACTOR_DENIED'; end if;

  select * into current_order from public.orders where id = target_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if current_order.operational_status <> 'refund_pending'
     or current_order.refund_requested_by is null
     or current_order.refund_requested_by = actor_user_id
     or current_order.refund_amount is null then
    raise exception 'REFUND_MAKER_CHECKER_REQUIRED';
  end if;

  select * into tx from public.payment_transactions
  where order_id = target_order_id
    and status in ('approved', 'partially_refunded')
  order by paid_at desc nulls last, created_at desc limit 1 for update;
  if not found or tx.provider_payment_id is null then raise exception 'REFUND_PAYMENT_NOT_FOUND'; end if;

  select coalesce(sum(amount), 0) into approved_total
  from public.payment_refunds
  where transaction_id = tx.id and status in ('created', 'pending', 'approved');
  if current_order.refund_amount > tx.amount - approved_total then
    raise exception 'REFUND_AMOUNT_EXCEEDS_AVAILABLE';
  end if;

  insert into public.payment_refunds (
    transaction_id, order_id, request_key, amount, requested_by, approved_by, reason
  ) values (
    tx.id, target_order_id, request_key, current_order.refund_amount,
    current_order.refund_requested_by, actor_user_id, btrim(refund_reason)
  )
  on conflict (request_key) do nothing;

  select * into refund from public.payment_refunds where payment_refunds.request_key = begin_mercadopago_refund_v1.request_key;
  if refund.order_id <> target_order_id or refund.approved_by <> actor_user_id then
    raise exception 'REFUND_IDEMPOTENCY_CONFLICT';
  end if;

  return jsonb_build_object(
    'refundId', refund.id, 'paymentId', tx.provider_payment_id,
    'amount', refund.amount, 'status', refund.status
  );
end;
$$;

create or replace function public.complete_mercadopago_refund_v1(
  target_refund_id uuid,
  provider_refund_id text,
  provider_refund_status text,
  provider_refund_amount numeric,
  provider_refund_created_at timestamptz,
  safe_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  refund public.payment_refunds%rowtype;
  tx public.payment_transactions%rowtype;
  current_order public.orders%rowtype;
  refunded_total numeric;
begin
  select * into refund from public.payment_refunds where id = target_refund_id for update;
  if not found then raise exception 'REFUND_NOT_FOUND'; end if;
  if refund.status = 'approved' then
    if provider_refund_status = 'approved'
       and refund.provider_refund_id = nullif(btrim(complete_mercadopago_refund_v1.provider_refund_id), '')
       and provider_refund_amount = refund.amount then
      return;
    end if;
    raise exception 'REFUND_FINAL_STATE_CONFLICT';
  end if;
  if provider_refund_amount is distinct from refund.amount then raise exception 'REFUND_AMOUNT_MISMATCH'; end if;
  if provider_refund_status not in ('pending', 'approved', 'rejected', 'failed') then
    raise exception 'REFUND_STATUS_INVALID';
  end if;

  update public.payment_refunds
  set provider_refund_id = nullif(btrim(complete_mercadopago_refund_v1.provider_refund_id), ''),
      status = provider_refund_status,
      provider_created_at = provider_refund_created_at,
      error_code = left(safe_error_code, 160)
  where id = target_refund_id;

  if provider_refund_status <> 'approved' then return; end if;

  select * into tx from public.payment_transactions where id = refund.transaction_id for update;
  select coalesce(sum(amount), 0) into refunded_total
  from public.payment_refunds where transaction_id = tx.id and status = 'approved';
  update public.payment_transactions
  set status = case when refunded_total >= amount then 'refunded' else 'partially_refunded' end
  where id = tx.id;

  select * into current_order from public.orders where id = refund.order_id for update;
  perform set_config('app.payment_provider_context', 'verified', true);
  update public.orders
  set refund_reference = 'mercadopago-refund:' || provider_refund_id,
      refund_processed_by = refund.approved_by,
      refund_processed_at = coalesce(provider_refund_created_at, timezone('utc', now())),
      operational_status = case when refunded_total >= tx.amount then 'refunded' else operational_status end,
      status = case when refunded_total >= tx.amount then 'cancelled'::public.order_status else status end
  where id = refund.order_id;

  if refunded_total >= tx.amount then
    insert into public.order_operational_history (
      order_id, from_status, to_status, changed_by, actor_kind, reason, metadata
    ) values (
      refund.order_id, current_order.operational_status, 'refunded', null, 'provider',
      'Reembolso confirmado diretamente pelo Mercado Pago.',
      jsonb_build_object('provider', 'mercado_pago', 'refund_id', refund.id)
    );
  end if;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  values (refund.approved_by, 'refund.provider_confirmed', 'order', refund.order_id,
    jsonb_build_object('provider', 'mercado_pago', 'refund_id', refund.id));
end;
$$;

create or replace function public.list_mercadopago_reconciliation_v1(candidate_limit integer default 50)
returns table (
  transaction_id uuid,
  provider_payment_id text,
  environment text,
  updated_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.provider_payment_id, p.environment, p.updated_at
  from public.payment_transactions p
  where p.provider_payment_id is not null
    and p.status in ('pending', 'in_process', 'approved', 'in_mediation')
  order by p.updated_at
  limit least(greatest(candidate_limit, 1), 200);
$$;

revoke all on function public.begin_mercadopago_checkout_v1(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_mercadopago_preference_v1(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_mercadopago_preference_v1(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.record_mercadopago_payment_v1(text, text, text, text, text, uuid, text, text, text, text, numeric, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.begin_mercadopago_refund_v1(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_mercadopago_refund_v1(uuid, text, text, numeric, timestamptz, text) from public, anon, authenticated;
revoke all on function public.list_mercadopago_reconciliation_v1(integer) from public, anon, authenticated;

grant execute on function public.begin_mercadopago_checkout_v1(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.complete_mercadopago_preference_v1(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.fail_mercadopago_preference_v1(uuid, text, boolean) to service_role;
grant execute on function public.record_mercadopago_payment_v1(text, text, text, text, text, uuid, text, text, text, text, numeric, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz) to service_role;
grant execute on function public.begin_mercadopago_refund_v1(uuid, uuid, uuid, text) to service_role;
grant execute on function public.complete_mercadopago_refund_v1(uuid, text, text, numeric, timestamptz, text) to service_role;
grant execute on function public.list_mercadopago_reconciliation_v1(integer) to service_role;
