alter table public.qna_rooms
  add constraint qna_rooms_id_event_key_key unique (id, event_key);

create table public.qna_event_program_items (
  id bigserial primary key,
  event_key text not null,
  room_id bigint null,
  kind text not null,
  title text null,
  session_order integer not null,
  starts_at timestamptz null,
  duration_minutes integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qna_event_program_items_event_key_check
    check (btrim(event_key) <> ''),
  constraint qna_event_program_items_kind_check
    check (kind in ('session', 'service')),
  constraint qna_event_program_items_shape_check
    check (
      (kind = 'session' and room_id is not null)
      or
      (kind = 'service' and room_id is null and title is not null and btrim(title) <> '')
    ),
  constraint qna_event_program_items_order_check
    check (session_order > 0),
  constraint qna_event_program_items_duration_check
    check (duration_minutes is null or duration_minutes > 0),
  constraint qna_event_program_items_room_key
    unique (room_id),
  constraint qna_event_program_items_event_order_key
    unique (event_key, session_order)
    deferrable initially deferred,
  constraint qna_event_program_items_room_event_fkey
    foreign key (room_id, event_key)
    references public.qna_rooms (id, event_key)
    on update cascade
    on delete restrict
);

alter table public.qna_event_program_items enable row level security;

create policy public_read_event_program_items
on public.qna_event_program_items
for select
to anon, authenticated
using (true);

create policy auth_insert_event_program_items
on public.qna_event_program_items
for insert
to authenticated
with check (true);

create policy auth_update_event_program_items
on public.qna_event_program_items
for update
to authenticated
using (true)
with check (true);

create policy auth_delete_event_program_items
on public.qna_event_program_items
for delete
to authenticated
using (true);

revoke all privileges on table public.qna_event_program_items from anon, authenticated;

grant select (
  id, event_key, room_id, kind, title, session_order, starts_at, duration_minutes
) on public.qna_event_program_items to anon;

grant select, insert, update, delete
on public.qna_event_program_items to authenticated;

grant select, insert, update, delete
on public.qna_event_program_items to service_role;

revoke all privileges on sequence public.qna_event_program_items_id_seq from anon, authenticated;

grant usage, select
on sequence public.qna_event_program_items_id_seq
to authenticated, service_role;

insert into public.qna_event_program_items (
  event_key, room_id, kind, title, session_order, starts_at, duration_minutes
)
select
  room.event_key,
  room.id,
  'session',
  null,
  room.session_order,
  room.starts_at,
  room.duration_minutes
from public.qna_rooms room
where room.event_key is not null;

do $realtime$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'qna_event_program_items'
  ) then
    alter publication supabase_realtime add table public.qna_event_program_items;
  end if;
end;
$realtime$;

create or replace function public.update_qna_event_program(
  p_event_key text,
  p_items jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_requested integer;
  v_distinct_ids integer;
  v_distinct_orders integer;
  v_existing integer;
  v_event_total integer;
  v_anchor timestamptz;
begin
  if p_event_key is null or btrim(p_event_key) = '' then
    raise exception 'Event key is required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Program payload must be an array' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.qna_event_program_items
    where event_key = p_event_key
      and kind = 'service'
  ) then
    raise exception 'PROGRAM_V2_REQUIRES_NEW_EDITOR' using errcode = '22023';
  end if;

  select count(*), count(distinct id), count(distinct session_order)
  into v_requested, v_distinct_ids, v_distinct_orders
  from jsonb_to_recordset(p_items)
    as x(id bigint, session_order integer, title text, starts_at timestamptz, duration_minutes integer);

  if v_requested = 0
     or v_requested <> v_distinct_ids
     or v_requested <> v_distinct_orders then
    raise exception 'Program must contain unique room ids and order values' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items)
      as x(id bigint, session_order integer, title text, starts_at timestamptz, duration_minutes integer)
    where x.id is null
       or x.session_order is null
       or x.session_order < 1
       or x.title is null
       or btrim(x.title) = ''
       or (x.duration_minutes is not null and x.duration_minutes <= 0)
  ) then
    raise exception 'Program item is invalid' using errcode = '22023';
  end if;

  select count(*)
  into v_event_total
  from public.qna_rooms
  where event_key = p_event_key;

  select count(*)
  into v_existing
  from public.qna_rooms room
  join jsonb_to_recordset(p_items)
    as x(id bigint, session_order integer, title text, starts_at timestamptz, duration_minutes integer)
    on x.id = room.id
  where room.event_key = p_event_key;

  if v_event_total = 0
     or v_existing <> v_event_total
     or v_requested <> v_event_total then
    raise exception 'Program must contain every event room exactly once' using errcode = '22023';
  end if;

  perform 1
  from public.qna_rooms
  where event_key = p_event_key
  order by id
  for update;

  select item.starts_at
  into v_anchor
  from jsonb_to_recordset(p_items)
    as item(id bigint, session_order integer, title text, starts_at timestamptz, duration_minutes integer)
  order by item.session_order
  limit 1;

  if v_anchor is not null and exists (
    select 1
    from jsonb_to_recordset(p_items)
      as item(id bigint, session_order integer, title text, starts_at timestamptz, duration_minutes integer)
    where item.duration_minutes is null
  ) then
    raise exception 'Every scheduled program block requires a duration' using errcode = '22023';
  end if;

  with input as (
    select *
    from jsonb_to_recordset(p_items)
      as item(id bigint, session_order integer, title text, starts_at timestamptz, duration_minutes integer)
  ),
  computed as (
    select
      input.*,
      case
        when v_anchor is null then null::timestamptz
        else v_anchor + make_interval(
          mins => coalesce(
            sum(input.duration_minutes) over (
              order by input.session_order
              rows between unbounded preceding and 1 preceding
            ),
            0
          )::integer
        )
      end as computed_starts_at
    from input
  )
  update public.qna_rooms room
  set session_order = item.session_order,
      title = btrim(item.title),
      starts_at = item.computed_starts_at,
      duration_minutes = item.duration_minutes,
      updated_at = now()
  from computed item
  where room.id = item.id
    and room.event_key = p_event_key;

  insert into public.qna_event_program_items (
    event_key, room_id, kind, title, session_order, starts_at, duration_minutes
  )
  select
    room.event_key,
    room.id,
    'session',
    null,
    room.session_order,
    room.starts_at,
    room.duration_minutes
  from public.qna_rooms room
  where room.event_key = p_event_key
  on conflict (room_id) do update
  set event_key = excluded.event_key,
      kind = 'session',
      title = null,
      session_order = excluded.session_order,
      starts_at = excluded.starts_at,
      duration_minutes = excluded.duration_minutes,
      updated_at = now();
end;
$$;

revoke execute on function public.update_qna_event_program(text, jsonb)
from public, anon;

grant execute on function public.update_qna_event_program(text, jsonb)
to authenticated;
