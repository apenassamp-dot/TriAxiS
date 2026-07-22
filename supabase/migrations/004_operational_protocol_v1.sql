-- TriAxis Nexus V4 — Protocolo Operacional v1
-- Aplicar depois de 003_security_orders_storage.sql.
-- Mantém o enum/status legado para compatibilidade e torna operational_status
-- a fonte autoritativa do novo fluxo.

create table if not exists public.operational_user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('commercial', 'finance', 'operations', 'production', 'logistics', 'support')),
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, role)
);

alter table public.orders
  add column if not exists operational_status text not null default 'order_received',
  add column if not exists customer_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists discount numeric(12,2) not null default 0,
  add column if not exists shipping_fee numeric(12,2) not null default 0,
  add column if not exists payment_method text,
  add column if not exists payment_reference text,
  add column if not exists payment_payer text,
  add column if not exists payment_amount numeric(12,2),
  add column if not exists payment_received_at timestamptz,
  add column if not exists payment_validated_by uuid references auth.users(id) on delete set null,
  add column if not exists payment_validated_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists capacity_confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists capacity_confirmed_at timestamptz,
  add column if not exists production_assignee uuid references auth.users(id) on delete set null,
  add column if not exists production_due_at timestamptz,
  add column if not exists delivery_method text,
  add column if not exists delivery_details jsonb not null default '{}'::jsonb,
  add column if not exists tracking_code text,
  add column if not exists delivered_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists exception_reason text,
  add column if not exists specification_revision integer not null default 1,
  add column if not exists price_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists operational_metadata jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.orders add constraint orders_operational_status_check check (
    operational_status in (
      'order_received', 'awaiting_payment', 'payment_received', 'payment_validation',
      'approved_for_production', 'in_production', 'ready', 'shipped',
      'available_for_pickup', 'delivered', 'rejected', 'cancelled', 'blocked',
      'refund_pending', 'refunded', 'production_suspended', 'delivery_issue'
    )
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.orders add constraint orders_discount_nonnegative check (discount >= 0);
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.orders add constraint orders_shipping_fee_nonnegative check (shipping_fee >= 0);
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.orders add constraint orders_payment_amount_nonnegative check (payment_amount is null or payment_amount >= 0);
exception when duplicate_object then null;
end $$;

create unique index if not exists orders_payment_reference_unique_idx
  on public.orders (lower(payment_reference))
  where payment_reference is not null and btrim(payment_reference) <> '';

create table if not exists public.order_operational_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists order_operational_history_order_idx
  on public.order_operational_history (order_id, created_at, id);

create or replace function public.has_operational_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select required_role in ('commercial', 'finance', 'operations', 'production', 'logistics', 'support')
     and exists (
       select 1 from public.operational_user_roles
       where user_id = auth.uid() and role = required_role
     );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_role('admin')
      or public.has_role('production')
      or public.has_role('support')
      or exists (select 1 from public.operational_user_roles where user_id = auth.uid());
$$;

create or replace function public.set_operational_role(
  target_user_id uuid,
  target_role text,
  enabled boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role('admin') then raise exception 'FORBIDDEN'; end if;
  if target_role not in ('commercial', 'finance', 'operations', 'production', 'logistics', 'support') then
    raise exception 'INVALID_OPERATIONAL_ROLE';
  end if;
  if enabled then
    insert into public.operational_user_roles (user_id, role, assigned_by)
    values (target_user_id, target_role, auth.uid())
    on conflict (user_id, role) do nothing;
  else
    delete from public.operational_user_roles where user_id = target_user_id and role = target_role;
  end if;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when enabled then 'operational_role.assigned' else 'operational_role.removed' end,
          'profile', target_user_id, jsonb_build_object('role', target_role));
end;
$$;

create or replace function public.order_unit_price_v1(
  selected_product public.products,
  requested_configuration jsonb
)
returns table (unit_price numeric, price_components jsonb)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  pricing jsonb;
  variant_key text := coalesce(nullif(requested_configuration ->> 'variant', ''), 'standard');
  material_key text := coalesce(nullif(requested_configuration ->> 'material', ''), 'pla_fosco');
  finish_key text := coalesce(nullif(requested_configuration ->> 'finish', ''), 'simples');
  accessory_key text := coalesce(nullif(requested_configuration ->> 'accessory', ''), 'ball_chain');
  variant_add numeric;
  material_add numeric;
  finish_add numeric;
  accessory_add numeric;
begin
  pricing := coalesce(selected_product.customization -> 'pricing', '{}'::jsonb);
  if coalesce(jsonb_typeof(pricing -> 'variant'), '') <> 'object'
     or coalesce(jsonb_typeof(pricing -> 'material'), '') <> 'object'
     or coalesce(jsonb_typeof(pricing -> 'finish'), '') <> 'object'
     or coalesce(jsonb_typeof(pricing -> 'accessory'), '') <> 'object' then
    pricing := jsonb_build_object(
      'version', 'physical-v1',
      'variant', jsonb_build_object('standard', 0, 'blackout', 6, 'lab_access', 9, 'prototype', 4),
      'material', jsonb_build_object('pla_fosco', 0, 'pla_vermelho', 5, 'resina', 15, 'prototipo', -3),
      'finish', jsonb_build_object('simples', 0, 'premium', 12, 'scratch', 10, 'verniz', 8),
      'accessory', jsonb_build_object('ball_chain', 3, 'argola', 1.5, 'mosquetao', 5, 'sem_corrente', 0)
    );
  end if;
  if not coalesce(pricing -> 'variant' ? variant_key, false)
     or not coalesce(pricing -> 'material' ? material_key, false)
     or not coalesce(pricing -> 'finish' ? finish_key, false)
     or not coalesce(pricing -> 'accessory' ? accessory_key, false) then
    raise exception 'INVALID_PRICING_OPTION';
  end if;
  variant_add := (pricing -> 'variant' ->> variant_key)::numeric;
  material_add := (pricing -> 'material' ->> material_key)::numeric;
  finish_add := (pricing -> 'finish' ->> finish_key)::numeric;
  accessory_add := (pricing -> 'accessory' ->> accessory_key)::numeric;
  unit_price := round(greatest(0, selected_product.base_price + variant_add + material_add + finish_add + accessory_add), 2);
  price_components := jsonb_build_object(
    'version', coalesce(pricing ->> 'version', 'physical-v1'),
    'base_price', selected_product.base_price,
    'variant', jsonb_build_object('key', variant_key, 'amount', variant_add),
    'material', jsonb_build_object('key', material_key, 'amount', material_add),
    'finish', jsonb_build_object('key', finish_key, 'amount', finish_add),
    'accessory', jsonb_build_object('key', accessory_key, 'amount', accessory_add),
    'unit_price', unit_price
  );
  return next;
end;
$$;

create or replace function public.submit_order(
  requested_product_id uuid,
  requested_quantity integer,
  requested_configuration jsonb,
  requested_notes text,
  requested_idempotency_key uuid
)
returns table (order_id uuid, order_code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_product public.products%rowtype;
  created_order public.orders%rowtype;
  config_entry record;
  authoritative_unit numeric(12,2);
  calculated_total numeric(12,2);
  components jsonb;
begin
  if auth.uid() is null or not public.is_active_profile() then raise exception 'PROFILE_NOT_ACTIVE'; end if;
  if requested_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select * into created_order from public.orders
    where customer_id = auth.uid() and idempotency_key = requested_idempotency_key;
  if found then return query select created_order.id, created_order.order_code; return; end if;
  if requested_quantity is null or requested_quantity < 1 or requested_quantity > 99 then raise exception 'INVALID_QUANTITY'; end if;
  if requested_configuration is null or jsonb_typeof(requested_configuration) <> 'object' then raise exception 'INVALID_CONFIGURATION'; end if;
  if octet_length(requested_configuration::text) > 4096 or (select count(*) from jsonb_object_keys(requested_configuration)) > 12 then
    raise exception 'CONFIGURATION_TOO_LARGE';
  end if;
  for config_entry in select key, value from jsonb_each(requested_configuration) loop
    if config_entry.key not in ('variant','material','finish','accessory','color_main','color_accent','origin','deadline')
       or config_entry.key !~ '^[a-z][a-z0-9_]{0,31}$' then raise exception 'INVALID_CONFIGURATION_KEY'; end if;
    if jsonb_typeof(config_entry.value) <> 'string' or char_length(config_entry.value #>> '{}') > 120
       or config_entry.value #>> '{}' ~ '[[:cntrl:]]' then raise exception 'INVALID_CONFIGURATION_VALUE'; end if;
  end loop;
  if char_length(coalesce(requested_notes, '')) > 1000 then raise exception 'NOTES_TOO_LARGE'; end if;
  if (select count(*) from public.orders where customer_id = auth.uid()
      and submitted_at > timezone('utc', now()) - interval '10 minutes') >= 10 then raise exception 'ORDER_RATE_LIMITED'; end if;
  select * into selected_product from public.products
    where id = requested_product_id and published = true and status = 'active' for share;
  if not found then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  select p.unit_price, p.price_components into authoritative_unit, components
    from public.order_unit_price_v1(selected_product, requested_configuration) p;
  calculated_total := round(authoritative_unit * requested_quantity, 2);
  insert into public.orders (
    customer_id, idempotency_key, subtotal, discount, shipping_fee, total, customer_notes,
    operational_status, customer_snapshot, price_snapshot
  ) values (
    auth.uid(), requested_idempotency_key, calculated_total, 0, 0, calculated_total,
    coalesce(requested_notes, ''), 'order_received',
    coalesce((select jsonb_build_object('id', p.id, 'name', p.display_name, 'phone', p.phone,
      'tag', p.tag, 'email', auth.jwt() ->> 'email') from public.profiles p where p.id = auth.uid()),
      jsonb_build_object('id', auth.uid(), 'email', auth.jwt() ->> 'email')),
    components || jsonb_build_object('quantity', requested_quantity, 'subtotal', calculated_total, 'total', calculated_total)
  ) returning * into created_order;
  insert into public.order_items (order_id, product_id, product_snapshot, quantity, configuration, unit_price, line_total)
  values (created_order.id, selected_product.id,
    jsonb_build_object('id', selected_product.id, 'slug', selected_product.slug, 'name', selected_product.name,
      'base_price', selected_product.base_price, 'currency', selected_product.currency, 'pricing', components),
    requested_quantity, requested_configuration, authoritative_unit, calculated_total);
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (created_order.id, null, 'submitted', auth.uid(), 'Pedido recebido do cliente.');
  insert into public.order_operational_history (order_id, from_status, to_status, changed_by, reason, metadata)
  values (created_order.id, null, 'order_received', auth.uid(), 'Pedido recebido do cliente.',
          jsonb_build_object('price_snapshot', created_order.price_snapshot));
  insert into public.audit_events (actor_id, action, entity_type, entity_id)
  values (auth.uid(), 'order.submitted_v1', 'order', created_order.id);
  return query select created_order.id, created_order.order_code;
end;
$$;

create or replace function public.transition_order_v1(
  target_order_id uuid,
  target_status text,
  status_reason text,
  transition_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.orders%rowtype;
  allowed boolean := false;
  role_ok boolean := false;
  safe_reason text := btrim(coalesce(status_reason, ''));
  safe_data jsonb := case when jsonb_typeof(transition_data) = 'object' then transition_data else '{}'::jsonb end;
  legacy_target public.order_status;
  payment_ref text;
  payment_value numeric;
  due_at timestamptz;
begin
  if auth.uid() is null or not public.is_active_profile() then raise exception 'PROFILE_NOT_ACTIVE'; end if;
  if char_length(safe_reason) not between 3 and 1000 then raise exception 'STATUS_REASON_REQUIRED'; end if;
  select * into current_order from public.orders where id = target_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if current_order.operational_status = target_status then return; end if;

  allowed := case current_order.operational_status
    when 'order_received' then target_status in ('awaiting_payment','rejected','cancelled','blocked')
    when 'awaiting_payment' then target_status in ('payment_received','rejected','cancelled','blocked')
    when 'payment_received' then target_status in ('payment_validation','rejected','cancelled','blocked','refund_pending')
    when 'payment_validation' then target_status in ('approved_for_production','rejected','cancelled','blocked','refund_pending')
    when 'approved_for_production' then target_status in ('in_production','cancelled','blocked','refund_pending')
    when 'in_production' then target_status in ('ready','production_suspended','cancelled','refund_pending')
    when 'production_suspended' then target_status in ('in_production','cancelled','refund_pending')
    when 'ready' then target_status in ('shipped','available_for_pickup','delivery_issue','cancelled','refund_pending')
    when 'shipped' then target_status in ('delivered','delivery_issue','refund_pending')
    when 'available_for_pickup' then target_status in ('delivered','delivery_issue','refund_pending')
    when 'delivery_issue' then target_status in ('shipped','available_for_pickup','delivered','refund_pending')
    when 'blocked' then target_status in ('awaiting_payment','payment_validation','approved_for_production','cancelled','refund_pending')
    when 'refund_pending' then target_status in ('refunded','blocked')
    else false end;
  if not allowed then raise exception 'INVALID_STATUS_TRANSITION'; end if;

  role_ok := public.has_role('admin') or case
    when target_status in ('awaiting_payment','rejected') then public.has_operational_role('commercial') or public.has_operational_role('finance')
    when target_status in ('payment_received','payment_validation','refund_pending','refunded') then public.has_operational_role('finance')
    when target_status = 'approved_for_production' then public.has_operational_role('operations')
    when target_status in ('in_production','ready','production_suspended') then public.has_operational_role('production')
    when target_status in ('shipped','available_for_pickup','delivery_issue','delivered') then public.has_operational_role('logistics') or (target_status = 'delivered' and public.has_operational_role('support'))
    when target_status = 'cancelled' then public.has_operational_role('commercial') or public.has_operational_role('operations') or public.has_operational_role('support')
    when target_status = 'blocked' then public.has_operational_role('finance') or public.has_operational_role('operations')
    else false end;
  if not role_ok then raise exception 'FORBIDDEN_FOR_TRANSITION'; end if;

  if target_status = 'payment_received' then
    payment_ref := nullif(btrim(safe_data ->> 'payment_reference'), '');
    payment_value := nullif(safe_data ->> 'payment_amount', '')::numeric;
    if payment_ref is null or char_length(payment_ref) > 160 or payment_value is null or payment_value <= 0
       or nullif(btrim(safe_data ->> 'payment_method'), '') is null
       or nullif(btrim(safe_data ->> 'payment_payer'), '') is null then raise exception 'PAYMENT_DATA_REQUIRED'; end if;
    if exists (select 1 from public.orders where lower(payment_reference) = lower(payment_ref) and id <> target_order_id) then
      raise exception 'PAYMENT_REFERENCE_ALREADY_USED';
    end if;
    update public.orders set payment_reference = payment_ref, payment_amount = payment_value,
      payment_method = left(safe_data ->> 'payment_method', 80), payment_payer = left(safe_data ->> 'payment_payer', 160),
      payment_received_at = timezone('utc', now()) where id = target_order_id;
  elsif target_status = 'payment_validation' then
    if current_order.payment_reference is null or current_order.payment_amount is null then raise exception 'PAYMENT_EVIDENCE_REQUIRED'; end if;
    if current_order.payment_amount <> current_order.total then raise exception 'PAYMENT_AMOUNT_MISMATCH'; end if;
    update public.orders set payment_validated_by = auth.uid(), payment_validated_at = timezone('utc', now()) where id = target_order_id;
  elsif target_status = 'approved_for_production' then
    if current_order.payment_validated_at is null or current_order.payment_validated_by is null then raise exception 'PAYMENT_NOT_VALIDATED'; end if;
    if coalesce((safe_data ->> 'capacity_confirmed')::boolean, false) is not true then raise exception 'CAPACITY_NOT_CONFIRMED'; end if;
    update public.orders set approved_by = auth.uid(), approved_at = timezone('utc', now()),
      capacity_confirmed_by = auth.uid(), capacity_confirmed_at = timezone('utc', now()) where id = target_order_id;
  elsif target_status = 'in_production' then
    due_at := nullif(safe_data ->> 'production_due_at', '')::timestamptz;
    if current_order.capacity_confirmed_at is null or due_at is null or due_at <= timezone('utc', now()) then
      raise exception 'PRODUCTION_ASSIGNMENT_REQUIRED';
    end if;
    update public.orders set production_assignee = auth.uid(), production_due_at = due_at where id = target_order_id;
  elsif target_status in ('shipped','available_for_pickup') then
    if nullif(btrim(safe_data ->> 'delivery_method'), '') is null then raise exception 'DELIVERY_DATA_REQUIRED'; end if;
    if target_status = 'shipped' and nullif(btrim(safe_data ->> 'tracking_code'), '') is null then raise exception 'TRACKING_CODE_REQUIRED'; end if;
    update public.orders set delivery_method = left(safe_data ->> 'delivery_method', 80),
      delivery_details = coalesce(safe_data -> 'delivery_details', '{}'::jsonb),
      tracking_code = nullif(left(safe_data ->> 'tracking_code', 160), '') where id = target_order_id;
  elsif target_status = 'delivered' then
    update public.orders set delivered_at = timezone('utc', now()) where id = target_order_id;
  elsif target_status = 'cancelled' then
    if current_order.operational_status in ('in_production','production_suspended')
       and nullif(btrim(safe_data ->> 'decision_reference'), '') is null then raise exception 'CANCELLATION_DECISION_REQUIRED'; end if;
    update public.orders set cancellation_reason = safe_reason where id = target_order_id;
  elsif target_status in ('blocked','production_suspended','delivery_issue') then
    update public.orders set exception_reason = safe_reason,
      operational_metadata = operational_metadata || jsonb_build_object('exception_from', current_order.operational_status) where id = target_order_id;
  end if;

  legacy_target := case
    when target_status in ('order_received') then 'submitted'
    when target_status in ('awaiting_payment','payment_received','payment_validation','blocked') then 'awaiting_approval'
    when target_status = 'approved_for_production' then 'approved'
    when target_status in ('in_production','production_suspended') then 'in_production'
    when target_status in ('ready','shipped','available_for_pickup','delivery_issue') then 'ready'
    when target_status = 'delivered' then 'delivered'
    when target_status in ('rejected','cancelled','refund_pending','refunded') then 'cancelled'
  end;
  update public.orders set operational_status = target_status, status = legacy_target where id = target_order_id;
  insert into public.order_operational_history (order_id, from_status, to_status, changed_by, reason, metadata)
  values (target_order_id, current_order.operational_status, target_status, auth.uid(), safe_reason, safe_data);
  if current_order.status <> legacy_target then
    insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (target_order_id, current_order.status, legacy_target, auth.uid(), safe_reason);
  end if;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'order.operational_status_changed', 'order', target_order_id,
    jsonb_build_object('from', current_order.operational_status, 'to', target_status, 'reason', safe_reason));
end;
$$;

create or replace function public.revise_order_configuration_v1(
  target_order_id uuid,
  revised_configuration jsonb,
  revision_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.orders%rowtype;
  current_item public.order_items%rowtype;
  selected_product public.products%rowtype;
  authoritative_unit numeric(12,2);
  revised_total numeric(12,2);
  components jsonb;
  safe_reason text := btrim(coalesce(revision_reason, ''));
  config_entry record;
begin
  if auth.uid() is null or not public.is_active_profile() then raise exception 'PROFILE_NOT_ACTIVE'; end if;
  if jsonb_typeof(revised_configuration) <> 'object' then raise exception 'INVALID_CONFIGURATION'; end if;
  if octet_length(revised_configuration::text) > 4096 or (select count(*) from jsonb_object_keys(revised_configuration)) > 12 then
    raise exception 'CONFIGURATION_TOO_LARGE';
  end if;
  for config_entry in select key, value from jsonb_each(revised_configuration) loop
    if config_entry.key not in ('variant','material','finish','accessory','color_main','color_accent','origin','deadline')
       or jsonb_typeof(config_entry.value) <> 'string' or char_length(config_entry.value #>> '{}') > 120
       or config_entry.value #>> '{}' ~ '[[:cntrl:]]' then raise exception 'INVALID_CONFIGURATION'; end if;
  end loop;
  if char_length(safe_reason) not between 3 and 1000 then raise exception 'REVISION_REASON_REQUIRED'; end if;
  select * into current_order from public.orders where id = target_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if current_order.customer_id <> auth.uid() and not public.has_role('admin')
     and not public.has_operational_role('commercial') and not public.has_operational_role('operations') then
    raise exception 'FORBIDDEN';
  end if;
  if current_order.operational_status not in ('order_received','awaiting_payment','payment_received','payment_validation','approved_for_production') then
    raise exception 'SPECIFICATION_REVISION_NOT_ALLOWED';
  end if;
  select * into current_item from public.order_items where order_id = target_order_id order by created_at limit 1 for update;
  if not found or current_item.product_id is null then raise exception 'ORDER_ITEM_NOT_FOUND'; end if;
  select * into selected_product from public.products where id = current_item.product_id for share;
  if not found then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  select p.unit_price, p.price_components into authoritative_unit, components
    from public.order_unit_price_v1(selected_product, revised_configuration) p;
  revised_total := round(authoritative_unit * current_item.quantity, 2);
  update public.order_items set configuration = revised_configuration, unit_price = authoritative_unit,
    line_total = revised_total, product_snapshot = product_snapshot || jsonb_build_object('pricing', components)
  where id = current_item.id;
  update public.orders set subtotal = revised_total, total = greatest(0, revised_total - discount + shipping_fee),
    specification_revision = specification_revision + 1,
    price_snapshot = components || jsonb_build_object('quantity', current_item.quantity, 'subtotal', revised_total,
      'discount', discount, 'shipping_fee', shipping_fee, 'total', greatest(0, revised_total - discount + shipping_fee)),
    operational_status = case when payment_received_at is null then 'awaiting_payment' else 'payment_validation' end,
    status = 'awaiting_approval', approved_by = null, approved_at = null,
    capacity_confirmed_by = null, capacity_confirmed_at = null,
    payment_validated_by = null, payment_validated_at = null
  where id = target_order_id;
  insert into public.order_operational_history (order_id, from_status, to_status, changed_by, reason, metadata)
  values (target_order_id, current_order.operational_status,
    case when current_order.payment_received_at is null then 'awaiting_payment' else 'payment_validation' end,
    auth.uid(), safe_reason, jsonb_build_object('event', 'specification_revised', 'revision', current_order.specification_revision + 1,
      'price_snapshot', components));
  insert into public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'order.specification_revised', 'order', target_order_id,
    jsonb_build_object('revision', current_order.specification_revision + 1));
end;
$$;

-- Impede que clientes antigos contornem os gates do protocolo.
create or replace function public.set_order_status(target_order_id uuid, target_status public.order_status, status_note text default '')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'OPERATIONAL_PROTOCOL_V1_REQUIRED';
end;
$$;

alter table public.operational_user_roles enable row level security;
alter table public.order_operational_history enable row level security;

drop policy if exists operational_roles_select on public.operational_user_roles;
create policy operational_roles_select on public.operational_user_roles for select to authenticated
using (public.is_active_profile() and (user_id = auth.uid() or public.has_role('admin')));

drop policy if exists order_operational_history_select on public.order_operational_history;
create policy order_operational_history_select on public.order_operational_history for select to authenticated
using (public.is_active_profile() and exists (
  select 1 from public.orders o where o.id = order_id and (o.customer_id = auth.uid() or public.is_staff())
));

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
using (public.is_active_profile() and (customer_id = auth.uid() or public.is_staff()));

grant select on public.operational_user_roles, public.order_operational_history to authenticated;
revoke all on function public.has_operational_role(text) from public;
revoke all on function public.set_operational_role(uuid, text, boolean) from public;
revoke all on function public.order_unit_price_v1(public.products, jsonb) from public;
revoke all on function public.transition_order_v1(uuid, text, text, jsonb) from public;
revoke all on function public.revise_order_configuration_v1(uuid, jsonb, text) from public;
grant execute on function public.has_operational_role(text) to authenticated;
grant execute on function public.set_operational_role(uuid, text, boolean) to authenticated;
grant execute on function public.transition_order_v1(uuid, text, text, jsonb) to authenticated;
grant execute on function public.revise_order_configuration_v1(uuid, jsonb, text) to authenticated;

-- Preserva o acesso das contas operacionais já existentes sem ampliar funções:
-- production continua somente produção e support continua somente suporte.
insert into public.operational_user_roles (user_id, role, assigned_by)
select user_id, case role when 'production' then 'production' else 'support' end, assigned_by
from public.user_roles
where role in ('production', 'support')
on conflict (user_id, role) do nothing;

-- Compatibilidade segura: pedidos legados sem evidência financeira/capacidade
-- não são promovidos diretamente a estados protegidos pelo novo protocolo.
update public.orders
set operational_status = case status
  when 'submitted' then 'order_received'
  when 'awaiting_approval' then 'awaiting_payment'
  when 'approved' then 'blocked'
  when 'in_production' then 'blocked'
  when 'ready' then 'blocked'
  when 'delivered' then 'delivered'
  when 'cancelled' then 'cancelled'
end,
operational_metadata = operational_metadata || jsonb_build_object(
  'migration', '004',
  'legacy_status', status,
  'requires_reconciliation', status in ('approved','in_production','ready')
)
where operational_status = 'order_received' and status <> 'submitted';

insert into public.order_operational_history (order_id, from_status, to_status, changed_by, reason, metadata)
select o.id, null, o.operational_status, o.customer_id, 'Pedido legado incorporado ao Protocolo v1.', '{"migration":"004"}'::jsonb
from public.orders o
where not exists (select 1 from public.order_operational_history h where h.order_id = o.id);
