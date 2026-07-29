-- Harness estrutural/adversarial da migration 006.
-- Execute em projeto Supabase QA isolado depois das migrations 001..006.
-- Termina com ROLLBACK e não cria pagamentos no Mercado Pago.

begin;

do $$
declare
  forbidden_execute integer;
  service_execute integer;
begin
  if to_regclass('public.payment_transactions') is null
     or to_regclass('public.payment_events') is null
     or to_regclass('public.payment_refunds') is null then
    raise exception 'FAIL: ledger financeiro ausente';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.orders'::regclass
      and tgname = 'orders_guard_provider_financial_fields_v1'
      and not tgisinternal
  ) then raise exception 'FAIL: trigger financeiro ausente'; end if;

  if has_table_privilege('authenticated', 'public.orders', 'SELECT') then
    raise exception 'FAIL: authenticated ainda possui SELECT amplo em orders';
  end if;
  if has_column_privilege('authenticated', 'public.orders', 'payment_reference', 'SELECT')
     or has_column_privilege('authenticated', 'public.orders', 'payment_payer', 'SELECT')
     or has_column_privilege('authenticated', 'public.orders', 'refund_reference', 'SELECT')
     or has_column_privilege('authenticated', 'public.orders', 'refund_recipient', 'SELECT') then
    raise exception 'FAIL: evidência financeira/PII legada ainda exposta';
  end if;
  if not has_column_privilege('authenticated', 'public.orders', 'operational_status', 'SELECT') then
    raise exception 'FAIL: coluna operacional mínima não concedida';
  end if;

  select count(*) into forbidden_execute
  from (
    values
      ('begin_mercadopago_checkout_v1(uuid,uuid,uuid,text,text)'::regprocedure),
      ('complete_mercadopago_preference_v1(uuid,text,text,text,timestamp with time zone)'::regprocedure),
      ('fail_mercadopago_preference_v1(uuid,text,boolean)'::regprocedure),
      ('begin_mercadopago_refund_v1(uuid,uuid,uuid,text)'::regprocedure),
      ('complete_mercadopago_refund_v1(uuid,text,text,numeric,timestamp with time zone,text)'::regprocedure),
      ('list_mercadopago_reconciliation_v1(integer)'::regprocedure)
  ) as functions(proc)
  where has_function_privilege('authenticated', proc, 'EXECUTE')
     or has_function_privilege('anon', proc, 'EXECUTE');
  if forbidden_execute <> 0 then
    raise exception 'FAIL: RPC financeiro executável por cliente';
  end if;

  select count(*) into service_execute
  from (
    values
      ('begin_mercadopago_checkout_v1(uuid,uuid,uuid,text,text)'::regprocedure),
      ('complete_mercadopago_preference_v1(uuid,text,text,text,timestamp with time zone)'::regprocedure),
      ('fail_mercadopago_preference_v1(uuid,text,boolean)'::regprocedure),
      ('begin_mercadopago_refund_v1(uuid,uuid,uuid,text)'::regprocedure),
      ('complete_mercadopago_refund_v1(uuid,text,text,numeric,timestamp with time zone,text)'::regprocedure),
      ('list_mercadopago_reconciliation_v1(integer)'::regprocedure)
  ) as functions(proc)
  where has_function_privilege('service_role', proc, 'EXECUTE');
  if service_execute <> 6 then
    raise exception 'FAIL: service_role sem todos os RPCs financeiros';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'payment_transactions_active_order_unique_idx'
  ) then raise exception 'FAIL: proteção contra checkout ativo duplicado ausente'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_refunds'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%requested_by <> approved_by%'
  ) then raise exception 'FAIL: maker-checker de reembolso ausente'; end if;

  raise notice 'PASS: superfície financeira restrita, idempotência e maker-checker presentes';
end;
$$;

rollback;
