-- Harness estrutural da renovação segura de preferências.
-- Execute no QA depois da migration 008. Termina com ROLLBACK.

begin;

do $$
declare
  begin_definition text;
  complete_definition text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_transactions'
      and column_name = 'provider_request_key'
      and is_nullable = 'NO'
  ) then raise exception 'FAIL: provider_request_key ausente ou anulável'; end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'payment_transactions_provider_request_unique_idx'
  ) then raise exception 'FAIL: unicidade da chave do provedor ausente'; end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'payment_transactions_provider_preference_unique_idx'
  ) then raise exception 'FAIL: unicidade da preferência ausente'; end if;

  select pg_get_functiondef(
    'public.begin_mercadopago_checkout_v1(uuid,uuid,uuid,text,text)'::regprocedure
  ) into begin_definition;
  if begin_definition not like '%providerRequestKey%'
     or begin_definition not like '%expiration_grace%'
     or begin_definition not like '%interval ''5 minutes''%'
     or begin_definition not like '%provider_request_key = gen_random_uuid()%' then
    raise exception 'FAIL: renovação conservadora incompleta';
  end if;

  select pg_get_functiondef(
    'public.complete_mercadopago_preference_v1(uuid,text,text,text,timestamp with time zone)'::regprocedure
  ) into complete_definition;
  if complete_definition not like '%PAYMENT_PREFERENCE_CONFLICT%'
     or complete_definition not like '%for update%' then
    raise exception 'FAIL: conclusão idempotente/concorrrente ausente';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.begin_mercadopago_checkout_v1(uuid,uuid,uuid,text,text)'::regprocedure,
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.complete_mercadopago_preference_v1(uuid,text,text,text,timestamp with time zone)'::regprocedure,
       'EXECUTE'
     ) then
    raise exception 'FAIL: RPC financeiro exposto ao cliente';
  end if;

  raise notice 'PASS: renovação, idempotência do provedor e privilégios presentes';
end;
$$;

rollback;
