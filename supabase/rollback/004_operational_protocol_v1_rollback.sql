-- Rollback conservador da migration 004.
-- Execute apenas com janela de manutenção e backup verificado.
-- Depois deste arquivo, reaplique 003_security_orders_storage.sql para restaurar
-- as versões anteriores de submit_order, set_order_status e is_staff.

create table if not exists public.protocol_v1_rollback_archive (
  order_id uuid primary key,
  archived_at timestamptz not null default timezone('utc', now()),
  order_data jsonb not null,
  history_data jsonb not null default '[]'::jsonb
);

insert into public.protocol_v1_rollback_archive (order_id, order_data, history_data)
select o.id, to_jsonb(o), coalesce((
  select jsonb_agg(to_jsonb(h) order by h.created_at, h.id)
  from public.order_operational_history h where h.order_id = o.id
), '[]'::jsonb)
from public.orders o
on conflict (order_id) do update set
  archived_at = excluded.archived_at,
  order_data = excluded.order_data,
  history_data = excluded.history_data;

drop policy if exists order_operational_history_select on public.order_operational_history;
drop policy if exists operational_roles_select on public.operational_user_roles;
drop function if exists public.revise_order_configuration_v1(uuid, jsonb, text);
drop function if exists public.transition_order_v1(uuid, text, text, jsonb);
drop function if exists public.order_unit_price_v1(public.products, jsonb);
drop function if exists public.set_operational_role(uuid, text, boolean);
drop function if exists public.has_operational_role(text);
drop table if exists public.order_operational_history;
drop table if exists public.operational_user_roles;
drop index if exists public.orders_payment_reference_unique_idx;

alter table public.orders
  drop constraint if exists orders_operational_status_check,
  drop constraint if exists orders_discount_nonnegative,
  drop constraint if exists orders_shipping_fee_nonnegative,
  drop constraint if exists orders_payment_amount_nonnegative,
  drop column if exists operational_status,
  drop column if exists customer_snapshot,
  drop column if exists discount,
  drop column if exists shipping_fee,
  drop column if exists payment_method,
  drop column if exists payment_reference,
  drop column if exists payment_payer,
  drop column if exists payment_amount,
  drop column if exists payment_received_at,
  drop column if exists payment_validated_by,
  drop column if exists payment_validated_at,
  drop column if exists approved_by,
  drop column if exists approved_at,
  drop column if exists capacity_confirmed_by,
  drop column if exists capacity_confirmed_at,
  drop column if exists production_assignee,
  drop column if exists production_due_at,
  drop column if exists delivery_method,
  drop column if exists delivery_details,
  drop column if exists tracking_code,
  drop column if exists delivered_at,
  drop column if exists cancellation_reason,
  drop column if exists exception_reason,
  drop column if exists specification_revision,
  drop column if exists price_snapshot,
  drop column if exists operational_metadata;

-- O arquivo 003 deve ser reaplicado imediatamente após este rollback.
-- A tabela protocol_v1_rollback_archive é preservada para recuperação/auditoria.
