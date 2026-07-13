-- TriAxis Nexus V4 — base de produção do MVP
-- Execute este arquivo no SQL Editor de um projeto Supabase novo.

create extension if not exists pgcrypto with schema extensions;

do $$ begin
  create type public.app_role as enum ('customer', 'production', 'support', 'admin');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.profile_status as enum ('active', 'suspended');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.product_status as enum ('draft', 'active', 'archived');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.order_status as enum (
    'submitted',
    'awaiting_approval',
    'approved',
    'in_production',
    'ready',
    'delivered',
    'cancelled'
  );
exception when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.generate_agent_tag()
returns text
language plpgsql
volatile
set search_path = public, extensions, pg_temp
as $$
declare
  candidate text;
begin
  loop
    candidate := '#' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 5));
    exit when not exists (select 1 from public.profiles where tag = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.generate_order_code()
returns text
language sql
volatile
set search_path = public, extensions, pg_temp
as $$
  select 'ORD-' || to_char(timezone('utc', now()), 'YYYYMMDD') || '-' ||
    upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 120),
  phone text check (phone is null or char_length(phone) between 8 and 30),
  tag text not null unique default public.generate_agent_tag()
    check (tag ~ '^#[A-F0-9]{5}$'),
  status public.profile_status not null default 'active',
  avatar_path text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, role)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 160),
  description text not null default '',
  base_price numeric(12,2) not null default 0 check (base_price >= 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  status public.product_status not null default 'draft',
  published boolean not null default false,
  customization jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null,
  alt_text text not null default '',
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  unique (product_id, storage_path)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique default public.generate_order_code(),
  customer_id uuid not null references auth.users(id) on delete restrict,
  status public.order_status not null default 'submitted',
  currency text not null default 'BRL' check (currency = 'BRL'),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  total numeric(12,2) not null check (total >= 0),
  customer_notes text not null default '',
  submitted_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_snapshot jsonb not null,
  quantity integer not null check (quantity between 1 and 999),
  configuration jsonb not null default '{}'::jsonb,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  changed_by uuid references auth.users(id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists products_public_catalog_idx
  on public.products (published, status, created_at desc);
create index if not exists product_images_product_idx
  on public.product_images (product_id, sort_order);
create index if not exists orders_customer_idx
  on public.orders (customer_id, created_at desc);
create index if not exists orders_status_idx
  on public.orders (status, created_at desc);
create index if not exists order_items_order_idx
  on public.order_items (order_id);
create index if not exists order_history_order_idx
  on public.order_status_history (order_id, created_at);
create index if not exists audit_events_entity_idx
  on public.audit_events (entity_type, entity_id, created_at desc);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_name text;
begin
  new_name := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if char_length(new_name) < 2 then
    new_name := split_part(coalesce(new.email, 'Cliente'), '@', 1);
  end if;
  if char_length(new_name) < 2 then
    new_name := 'Cliente TriAxis';
  end if;

  insert into public.profiles (id, display_name, phone)
  values (new.id, left(new_name, 120), nullif(trim(new.raw_user_meta_data ->> 'phone'), ''))
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'customer')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.has_role(required_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles
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
      or public.has_role('support');
$$;

create or replace function public.can_manage_orders()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_role('admin') or public.has_role('production');
$$;

create or replace function public.submit_order(
  requested_product_id uuid,
  requested_quantity integer,
  requested_configuration jsonb default '{}'::jsonb,
  requested_notes text default ''
)
returns table (order_id uuid, order_code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  customer_profile public.profiles%rowtype;
  selected_product public.products%rowtype;
  created_order public.orders%rowtype;
  safe_quantity integer;
  calculated_total numeric(12,2);
begin
  if auth.uid() is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  select * into customer_profile
  from public.profiles
  where id = auth.uid();

  if not found or customer_profile.status <> 'active' then
    raise exception 'PROFILE_NOT_ACTIVE';
  end if;

  safe_quantity := requested_quantity;
  if safe_quantity is null or safe_quantity < 1 or safe_quantity > 999 then
    raise exception 'INVALID_QUANTITY';
  end if;

  select * into selected_product
  from public.products
  where id = requested_product_id
    and published = true
    and status = 'active'
  for share;

  if not found then
    raise exception 'PRODUCT_NOT_AVAILABLE';
  end if;

  calculated_total := selected_product.base_price * safe_quantity;

  insert into public.orders (
    customer_id, subtotal, total, customer_notes
  ) values (
    auth.uid(), calculated_total, calculated_total, left(coalesce(requested_notes, ''), 2000)
  ) returning * into created_order;

  insert into public.order_items (
    order_id,
    product_id,
    product_snapshot,
    quantity,
    configuration,
    unit_price,
    line_total
  ) values (
    created_order.id,
    selected_product.id,
    jsonb_build_object(
      'id', selected_product.id,
      'slug', selected_product.slug,
      'name', selected_product.name,
      'base_price', selected_product.base_price,
      'currency', selected_product.currency
    ),
    safe_quantity,
    coalesce(requested_configuration, '{}'::jsonb),
    selected_product.base_price,
    calculated_total
  );

  insert into public.order_status_history (
    order_id, from_status, to_status, changed_by, note
  ) values (
    created_order.id, null, 'submitted', auth.uid(), 'Pedido enviado pelo cliente.'
  );

  insert into public.audit_events (actor_id, action, entity_type, entity_id)
  values (auth.uid(), 'order.submitted', 'order', created_order.id);

  return query select created_order.id, created_order.order_code;
end;
$$;

create or replace function public.set_order_status(
  target_order_id uuid,
  target_status public.order_status,
  status_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous_status public.order_status;
  transition_allowed boolean;
begin
  if not public.can_manage_orders() then
    raise exception 'FORBIDDEN';
  end if;

  select status into previous_status
  from public.orders
  where id = target_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  transition_allowed := case previous_status
    when 'submitted' then target_status in ('awaiting_approval', 'cancelled')
    when 'awaiting_approval' then target_status in ('approved', 'cancelled')
    when 'approved' then target_status in ('in_production', 'cancelled')
    when 'in_production' then target_status in ('ready', 'cancelled')
    when 'ready' then target_status in ('delivered', 'cancelled')
    else false
  end;

  if not transition_allowed then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  update public.orders
  set status = target_status
  where id = target_order_id;

  insert into public.order_status_history (
    order_id, from_status, to_status, changed_by, note
  ) values (
    target_order_id,
    previous_status,
    target_status,
    auth.uid(),
    left(coalesce(status_note, ''), 1000)
  );

  insert into public.audit_events (
    actor_id, action, entity_type, entity_id, metadata
  ) values (
    auth.uid(),
    'order.status_changed',
    'order',
    target_order_id,
    jsonb_build_object('from', previous_status, 'to', target_status)
  );
end;
$$;

create or replace function public.set_user_role(
  target_user_id uuid,
  target_role public.app_role,
  enabled boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN';
  end if;

  if target_role = 'customer' and not enabled then
    raise exception 'CUSTOMER_ROLE_REQUIRED';
  end if;

  if enabled then
    insert into public.user_roles (user_id, role, assigned_by)
    values (target_user_id, target_role, auth.uid())
    on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles
    where user_id = target_user_id and role = target_role;
  end if;

  insert into public.audit_events (
    actor_id, action, entity_type, entity_id, metadata
  ) values (
    auth.uid(),
    case when enabled then 'role.assigned' else 'role.removed' end,
    'profile',
    target_user_id,
    jsonb_build_object('role', target_role)
  );
end;
$$;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_staff());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update to authenticated
using (id = auth.uid() and status = 'active')
with check (id = auth.uid() and status = 'active');

drop policy if exists roles_select on public.user_roles;
create policy roles_select on public.user_roles
for select to authenticated
using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists products_public_select on public.products;
create policy products_public_select on public.products
for select to anon, authenticated
using ((published = true and status = 'active') or public.has_role('admin'));

drop policy if exists products_admin_insert on public.products;
create policy products_admin_insert on public.products
for insert to authenticated
with check (public.has_role('admin'));

drop policy if exists products_admin_update on public.products;
create policy products_admin_update on public.products
for update to authenticated
using (public.has_role('admin'))
with check (public.has_role('admin'));

drop policy if exists products_admin_delete on public.products;
create policy products_admin_delete on public.products
for delete to authenticated
using (public.has_role('admin'));

drop policy if exists product_images_public_select on public.product_images;
create policy product_images_public_select on public.product_images
for select to anon, authenticated
using (
  exists (
    select 1 from public.products p
    where p.id = product_id
      and ((p.published = true and p.status = 'active') or public.has_role('admin'))
  )
);

drop policy if exists product_images_admin_write on public.product_images;
create policy product_images_admin_write on public.product_images
for all to authenticated
using (public.has_role('admin'))
with check (public.has_role('admin'));

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
for select to authenticated
using (customer_id = auth.uid() or public.is_staff());

drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items
for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.customer_id = auth.uid() or public.is_staff())
  )
);

drop policy if exists order_history_select on public.order_status_history;
create policy order_history_select on public.order_status_history
for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.customer_id = auth.uid() or public.is_staff())
  )
);

drop policy if exists audit_admin_select on public.audit_events;
create policy audit_admin_select on public.audit_events
for select to authenticated
using (public.has_role('admin'));

grant usage on schema public to anon, authenticated;

grant select on public.products, public.product_images to anon, authenticated;
grant select on public.profiles, public.user_roles, public.orders,
  public.order_items, public.order_status_history to authenticated;
grant select on public.audit_events to authenticated;

grant update (display_name, phone, avatar_path) on public.profiles to authenticated;
grant insert, update, delete on public.products, public.product_images to authenticated;

revoke all on function public.has_role(public.app_role) from public;
revoke all on function public.is_staff() from public;
revoke all on function public.can_manage_orders() from public;
revoke all on function public.submit_order(uuid, integer, jsonb, text) from public;
revoke all on function public.set_order_status(uuid, public.order_status, text) from public;
revoke all on function public.set_user_role(uuid, public.app_role, boolean) from public;

grant execute on function public.has_role(public.app_role) to authenticated;
grant execute on function public.has_role(public.app_role) to anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.can_manage_orders() to authenticated;
grant execute on function public.submit_order(uuid, integer, jsonb, text) to authenticated;
grant execute on function public.set_order_status(uuid, public.order_status, text) to authenticated;
grant execute on function public.set_user_role(uuid, public.app_role, boolean) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read on storage.objects
for select to anon, authenticated
using (bucket_id = 'product-images');

drop policy if exists product_images_admin_insert on storage.objects;
create policy product_images_admin_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'product-images' and public.has_role('admin'));

drop policy if exists product_images_admin_update on storage.objects;
create policy product_images_admin_update on storage.objects
for update to authenticated
using (bucket_id = 'product-images' and public.has_role('admin'))
with check (bucket_id = 'product-images' and public.has_role('admin'));

drop policy if exists product_images_admin_delete on storage.objects;
create policy product_images_admin_delete on storage.objects
for delete to authenticated
using (bucket_id = 'product-images' and public.has_role('admin'));

drop policy if exists avatars_owner_or_staff_read on storage.objects;
create policy avatars_owner_or_staff_read on storage.objects
for select to authenticated
using (
  bucket_id = 'avatars'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_staff()
  )
);

drop policy if exists avatars_owner_insert on storage.objects;
create policy avatars_owner_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists avatars_owner_update on storage.objects;
create policy avatars_owner_update on storage.objects
for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'avatars'
de  and (storage.foldername(name))[1] = auth.uid()::text
);
