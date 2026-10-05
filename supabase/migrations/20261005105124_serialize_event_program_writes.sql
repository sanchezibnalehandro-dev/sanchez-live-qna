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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_event_key));

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
to authenticated, service_role;

create or replace function public.save_qna_event_program(
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
  v_distinct_orders integer;
  v_session_requested integer;
  v_distinct_session_rooms integer;
  v_event_total integer;
  v_matching_sessions integer;
  v_anchor timestamptz;
  v_item record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_event_key is null or btrim(p_event_key) = '' then
    raise exception 'Event key is required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Program payload must be a non-empty array' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_event_key));

  select count(*),
         count(distinct session_order),
         count(*) filter (where kind = 'session'),
         count(distinct room_id) filter (where kind = 'session')
  into v_requested, v_distinct_orders, v_session_requested, v_distinct_session_rooms
  from jsonb_to_recordset(p_items)
    as x(id bigint, kind text, room_id bigint, title text, session_order integer, starts_at timestamptz, duration_minutes integer);

  if v_requested <> v_distinct_orders then
    raise exception 'Program order values must be unique' using errcode = '22023';
  end if;

  if v_session_requested <> v_distinct_session_rooms then
    raise exception 'Each session room must appear exactly once' using errcode = '22023';
  end if;

  if (
    select count(id) <> count(distinct id)
    from jsonb_to_recordset(p_items)
      as x(id bigint, kind text, room_id bigint, title text, session_order integer, starts_at timestamptz, duration_minutes integer)
  ) then
    raise exception 'Program item ids must be unique' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items)
      as x(id bigint, kind text, room_id bigint, title text, session_order integer, starts_at timestamptz, duration_minutes integer)
    where x.kind is null
       or x.kind not in ('session', 'service')
       or x.session_order is null
       or x.session_order < 1
       or x.title is null
       or btrim(x.title) = ''
       or (x.duration_minutes is not null and x.duration_minutes <= 0)
       or (x.kind = 'session' and (x.room_id is null or x.id is null))
       or (x.kind = 'service' and x.room_id is not null)
  ) then
    raise exception 'Program item is invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items)
      as x(id bigint, kind text, room_id bigint, title text, session_order integer, starts_at timestamptz, duration_minutes integer)
    where x.id is not null
      and not exists (
        select 1
        from public.qna_event_program_items existing
        where existing.id = x.id
          and existing.event_key = p_event_key
          and existing.kind = x.kind
          and existing.room_id is not distinct from x.room_id
      )
  ) then
    raise exception 'Program item does not belong to this event' using errcode = '22023';
  end if;

  select count(*)
  into v_event_total
  from public.qna_rooms
  where event_key = p_event_key;

  select count(*)
  into v_matching_sessions
  from public.qna_rooms room
  join jsonb_to_recordset(p_items)
    as x(id bigint, kind text, room_id bigint, title text, session_order integer, starts_at timestamptz, duration_minutes integer)
    on x.kind = 'session' and x.room_id = room.id
  where room.event_key = p_event_key;

  if v_event_total = 0
     or v_session_requested <> v_event_total
     or v_matching_sessions <> v_event_total then
    raise exception 'Program must contain every event room exactly once' using errcode = '22023';
  end if;

  perform 1
  from public.qna_rooms
  where event_key = p_event_key
  order by id
  for update;

  perform 1
  from public.qna_event_program_items
  where event_key = p_event_key
  order by id
  for update;

  select x.starts_at
  into v_anchor
  from jsonb_to_recordset(p_items)
    as x(id bigint, kind text, room_id bigint, title text, session_order integer, starts_at timestamptz, duration_minutes integer)
  order by x.session_order
  limit 1;

  if v_anchor is not null and exists (
    select 1
    from jsonb_to_recordset(p_items)
      as x(id bigint, kind text, room_id bigint, title text, session_order integer, starts_at timestamptz, duration_minutes integer)
    where x.duration_minutes is null
  ) then
    raise exception 'Every scheduled program block requires a duration' using errcode = '22023';
  end if;

  set constraints qna_event_program_items_event_order_key deferred;

  delete from public.qna_event_program_items existing
  where existing.event_key = p_event_key
    and existing.kind = 'service'
    and not exists (
      select 1
      from jsonb_to_recordset(p_items)
        as x(id bigint, kind text, room_id bigint, title text, session_order integer, starts_at timestamptz, duration_minutes integer)
      where x.kind = 'service'
        and x.id = existing.id
    );

  for v_item in
    with input as (
      select *
      from jsonb_to_recordset(p_items)
        as x(id bigint, kind text, room_id bigint, title text, session_order integer, starts_at timestamptz, duration_minutes integer)
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
    select *
    from computed
    order by session_order
  loop
    if v_item.kind = 'session' then
      update public.qna_rooms room
      set title = btrim(v_item.title),
          session_order = v_item.session_order,
          starts_at = v_item.computed_starts_at,
          duration_minutes = v_item.duration_minutes,
          updated_at = now()
      where room.id = v_item.room_id
        and room.event_key = p_event_key;

      update public.qna_event_program_items item
      set title = null,
          session_order = v_item.session_order,
          starts_at = v_item.computed_starts_at,
          duration_minutes = v_item.duration_minutes,
          updated_at = now()
      where item.id = v_item.id
        and item.event_key = p_event_key
        and item.kind = 'session'
        and item.room_id = v_item.room_id;
    elsif v_item.id is null then
      insert into public.qna_event_program_items (
        event_key, room_id, kind, title, session_order, starts_at, duration_minutes
      )
      values (
        p_event_key, null, 'service', btrim(v_item.title),
        v_item.session_order, v_item.computed_starts_at, v_item.duration_minutes
      );
    else
      update public.qna_event_program_items item
      set title = btrim(v_item.title),
          session_order = v_item.session_order,
          starts_at = v_item.computed_starts_at,
          duration_minutes = v_item.duration_minutes,
          updated_at = now()
      where item.id = v_item.id
        and item.event_key = p_event_key
        and item.kind = 'service';
    end if;
  end loop;
end;
$$;

revoke execute on function public.save_qna_event_program(text, jsonb)
from public, anon;
grant execute on function public.save_qna_event_program(text, jsonb)
to authenticated, service_role;
