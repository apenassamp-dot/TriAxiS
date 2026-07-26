-- TriAxis Protocol v1.1
-- Enforce maker-checker separation and structured refund evidence.
-- Requires: 004_operational_protocol_v1.sql

alter table public.orders
  add column if not exists payment_received_by uuid references auth.users(id) on delete set null,
  add column if not exists shipment_recorded_by uuid references auth.users(id) on delete set null,
  add column if not exists delivered_by uuid references auth.users(id) on delete set null,
  add column if not exists refund_requested_by uuid references auth.users(id) on delete set null,
  add column if not exists refund_processed_by uuid references auth.users(id) on delete set null,
  add column if not exists refund_amount numeric(12,2),
  add column if not exists refund_reference text,
  add column if not exists refund_recipient text,
  add column if not exists refund_requested_at timestamptz,
  add column if not exists refund_processed_at timestamptz;

create unique index if not exists orders_refund_reference_unique_idx
  on public.orders (lower(refund_reference))
  where refund_reference is not null;

-- Recover actor data for orders that already passed through protocol v1.
update public.orders o
set payment_received_by = (
  select h.changed_by
  from public.order_operational_history h
  where h.order_id = o.id and h.to_status = 'payment_received'
  order by h.created_at desc
  limit 1
)
where o.payment_received_by is null
  and exists (
    select 1 from public.order_operational_history h
    where h.order_id = o.id and h.to_status = 'payment_received'
  );

update public.orders o
set shipment_recorded_by = (
  select h.changed_by
  from public.order_operational_history h
  where h.order_id = o.id and h.to_status in ('shipped', 'available_for_pickup')
  order by h.created_at desc
  limit 1
)
where o.shipment_recorded_by is null
  and exists (
    select 1 from public.order_operational_history h
    where h.order_id = o.id and h.to_status in ('shipped', 'available_for_pickup')
  );

update public.orders o
set delivered_by = (
  select h.changed_by
  from public.order_operational_history h
  where h.order_id = o.id and h.to_status = 'delivered'
  order by h.created_at desc
  limit 1
)
where o.delivered_by is null
  and exists (
    select 1 from public.order_operational_history h
    where h.order_id = o.id and h.to_status = 'delivered'
  );

update public.orders o
set refund_requested_by = (
      select h.changed_by
      from public.order_operational_history h
      where h.order_id = o.id and h.to_status = 'refund_pending'
      order by h.created_at desc
      limit 1
    ),
    refund_requested_at = coalesce(o.refund_requested_at, (
      select h.created_at
      from public.order_operational_history h
      where h.order_id = o.id and h.to_status = 'refund_pending'
      order by h.created_at desc
      limit 1
    ))
where o.refund_requested_by is null
  and exists (
    select 1 from public.order_operational_history h
    where h.order_id = o.id and h.to_status = 'refund_pending'
  );

update public.orders o
set refund_processed_by = (
      select h.changed_by
      from public.order_operational_history h
      where h.order_id = o.id and h.to_status = 'refunded'
      order by h.created_at desc
      limit 1
    ),
    refund_processed_at = coalesce(o.refund_processed_at, (
      select h.created_at
      from public.order_operational_history h
      where h.order_id = o.id and h.to_status = 'refunded'
      order by h.created_at desc
      limit 1
    ))
where o.refund_processed_by is null
  and exists (
    select 1 from public.order_operational_history h
    where h.order_id = o.id and h.to_status = 'refunded'
  );

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
  requested_refund_amount numeric;
  requested_refund_recipient text;
  processed_refund_reference text;
  processed_refund_at timestamptz;
begin
  if auth.uid() is null or not public.is_active_profile() then raise exception 'PROFILE_NOT_ACTIVE'; end if;
  if char_length(safe_reason) not between 3 and 1000 then raise exception 'STATUS_REASON_REQUIRED'; end if;
  select * into current_order from public.orders where id = target_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

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
  if current_order.operational_status = target_status then return; end if;
  if not allowed then raise exception 'INVALID_STATUS_TRANSITION'; end if;

  -- Maker-checker gates apply to admins too.
  if target_status = 'payment_validation'
     and current_order.payment_received_by = auth.uid() then raise exception 'ACTOR_SEPARATION_PAYMENT_REQUIRED'; end if;
  if target_status = 'approved_for_production'
     and current_order.payment_validated_by = auth.uid() then raise exception 'ACTOR_SEPARATION_APPROVAL_REQUIRED'; end if;
  if target_status = 'in_production'
     and current_order.approved_by = auth.uid() then raise exception 'ACTOR_SEPARATION_PRODUCTION_REQUIRED'; end if;
  if target_status in ('shipped','available_for_pickup')
     and current_order.production_assignee = auth.uid() then raise exception 'ACTOR_SEPARATION_SHIPMENT_REQUIRED'; end if;
  if target_status = 'delivered'
     and current_order.shipment_recorded_by = auth.uid() then raise exception 'ACTOR_SEPARATION_DELIVERY_REQUIRED'; end if;
  if target_status = 'refunded'
     and current_order.refund_requested_by = auth.uid() then raise exception 'ACTOR_SEPARATION_REFUND_REQUIRED'; end if;

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
      payment_received_by = auth.uid(), payment_received_at = timezone('utc', now()) where id = target_order_id;
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
      tracking_code = nullif(left(safe_data ->> 'tracking_code', 160), ''),
      shipment_recorded_by = auth.uid() where id = target_order_id;
  elsif target_status = 'delivered' then
    update public.orders set delivered_by = auth.uid(), delivered_at = timezone('utc', now()) where id = target_order_id;
  elsif target_status = 'refund_pending' then
    requested_refund_amount := nullif(safe_data ->> 'refund_amount', '')::numeric;
    requested_refund_recipient := nullif(btrim(safe_data ->> 'refund_recipient'), '');
    if requested_refund_amount is null or requested_refund_amount <= 0 or requested_refund_amount > current_order.total
       or requested_refund_recipient is null or char_length(requested_refund_recipient) > 160 then
      raise exception 'REFUND_REQUEST_DATA_REQUIRED';
    end if;
    update public.orders set refund_requested_by = auth.uid(),
      refund_amount = requested_refund_amount,
      refund_recipient = requested_refund_recipient,
      refund_requested_at = timezone('utc', now())
    where id = target_order_id;
  elsif target_status = 'refunded' then
    processed_refund_reference := nullif(btrim(safe_data ->> 'refund_reference'), '');
    processed_refund_at := nullif(safe_data ->> 'refund_processed_at', '')::timestamptz;
    if current_order.refund_amount is null or current_order.refund_recipient is null
       or processed_refund_reference is null or char_length(processed_refund_reference) > 160
       or processed_refund_at is null or processed_refund_at > timezone('utc', now()) + interval '5 minutes' then
      raise exception 'REFUND_EVIDENCE_REQUIRED';
    end if;
    if exists (select 1 from public.orders where lower(refund_reference) = lower(processed_refund_reference) and id <> target_order_id) then
      raise exception 'REFUND_REFERENCE_ALREADY_USED';
    end if;
    update public.orders set refund_processed_by = auth.uid(),
      refund_reference = processed_refund_reference,
      refund_processed_at = processed_refund_at
    where id = target_order_id;
  elsif target_status = 'cancelled' then
    if current_order.operational_status in ('in_production','production_suspended')
       and nullif(btrim(safe_data ->> 'decision_reference'), '') is null then raise exception 'CANCELLATION_DECISION_REQUIRED'; end if;
    update public.orders set cancellation_reason = safe_reason where id = target_order_id;
  elsif target_status in ('blocked','production_suspended','delivery_issue') then
    update public.orders set exception_reason = safe_reason,
      operational_metadata = operational_metadata || jsonb_build_object('exception_from', current_order.operational_status) where id = target_order_id;
  end if;

  legacy_target := case
    when target_status = 'order_received' then 'submitted'
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

revoke all on function public.transition_order_v1(uuid, text, text, jsonb) from public;
grant execute on function public.transition_order_v1(uuid, text, text, jsonb) to authenticated;
