create table if not exists public.qna_rooms (
  id bigserial primary key,
  slug text not null unique,
  title text not null default 'Speaker Q&A',
  fallback_label text not null default 'Вопросы спикеру',
  is_questions_open boolean not null default true,
  moderation_enabled boolean not null default false,
  mode text not null default 'speaker' check (mode in ('speaker', 'panel')),
  moderator_name text null,
  moderator_regalia text null,
  event_key text null,
  session_order integer not null default 100,
  starts_at timestamptz null,
  duration_minutes integer null,
  is_current_session boolean not null default false,
  active_speaker_id bigint null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qna_rooms_duration_minutes_check
    check (duration_minutes is null or duration_minutes > 0),
  constraint qna_rooms_id_event_key_key
    unique (id, event_key)
);

-- `create table if not exists` не меняет уже развёрнутую таблицу.
-- Поэтому ниже — безопасный additive upgrade для существующих комнат.
alter table public.qna_rooms
  add column if not exists mode text,
  add column if not exists moderator_name text null,
  add column if not exists moderator_regalia text null;

update public.qna_rooms
set mode = 'speaker'
where mode is null;

alter table public.qna_rooms
  alter column mode set default 'speaker',
  alter column mode set not null;

alter table public.qna_rooms
  add column if not exists event_key text,
  add column if not exists session_order integer,
  add column if not exists starts_at timestamptz,
  add column if not exists duration_minutes integer,
  add column if not exists is_current_session boolean;

do $program$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'qna_rooms_duration_minutes_check'
      and conrelid = 'public.qna_rooms'::regclass
  ) then
    alter table public.qna_rooms
      add constraint qna_rooms_duration_minutes_check
      check (duration_minutes is null or duration_minutes > 0);
  end if;
end;
$program$;

update public.qna_rooms
set session_order = 100
where session_order is null;

update public.qna_rooms
set is_current_session = false
where is_current_session is null;

alter table public.qna_rooms
  alter column session_order set default 100,
  alter column session_order set not null,
  alter column is_current_session set default false,
  alter column is_current_session set not null;

do $event$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'qna_rooms_current_session_event_check'
      and conrelid = 'public.qna_rooms'::regclass
  ) then
    alter table public.qna_rooms
      add constraint qna_rooms_current_session_event_check
      check (not is_current_session or event_key is not null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'qna_rooms_event_intake_check'
      and conrelid = 'public.qna_rooms'::regclass
  ) then
    alter table public.qna_rooms
      add constraint qna_rooms_event_intake_check
      check (event_key is null or is_current_session or not is_questions_open);
  end if;
end;
$event$;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qna_rooms_mode_check'
      and conrelid = 'public.qna_rooms'::regclass
  ) then
    alter table public.qna_rooms
      add constraint qna_rooms_mode_check
      check (mode in ('speaker', 'panel'));
  end if;
end;
$$;

do $program_v2_room_key$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qna_rooms_id_event_key_key'
      and conrelid = 'public.qna_rooms'::regclass
  ) then
    alter table public.qna_rooms
      add constraint qna_rooms_id_event_key_key
      unique (id, event_key);
  end if;
end;
$program_v2_room_key$;

create table if not exists public.qna_event_program_items (
  id bigserial primary key,
  event_key text not null,
  room_id bigint null,
  kind text not null,
  title text null,
  session_order integer not null,
  starts_at timestamptz null,
  duration_minutes integer null,
  is_current boolean not null default false,
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

create index if not exists qna_event_program_items_room_event_idx
on public.qna_event_program_items (room_id, event_key);

create unique index if not exists qna_event_program_items_one_current_per_event_idx
  on public.qna_event_program_items(event_key)
  where is_current = true;

create table if not exists public.qna_speakers (
  id bigserial primary key,
  room_id bigint not null references public.qna_rooms(id) on delete cascade,
  name text,
  regalia text,
  topic text,
  fallback_label text,
  sort_order integer not null default 100,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.qna_questions (
  id bigserial primary key,
  room_id bigint not null references public.qna_rooms(id) on delete cascade,
  speaker_id bigint null references public.qna_speakers(id) on delete set null,
  text text not null,
  author_name text,
  author_company text,
  session_id text,
  status text not null default 'open' check (status in ('open', 'asked', 'hidden', 'pending')),
  is_pinned boolean not null default false,
  votes_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  asked_at timestamptz null
);

create table if not exists public.qna_question_votes (
  id bigserial primary key,
  question_id bigint not null references public.qna_questions(id) on delete cascade,
  session_id text not null,
  created_at timestamptz not null default now(),
  unique(question_id, session_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qna_rooms_active_speaker_id_fkey'
      and conrelid = 'public.qna_rooms'::regclass
  ) then
    alter table public.qna_rooms
      add constraint qna_rooms_active_speaker_id_fkey
      foreign key (active_speaker_id)
      references public.qna_speakers(id)
      on delete set null;
  end if;
end;
$$;

alter table public.qna_questions
  drop constraint if exists qna_questions_text_length_check,
  drop constraint if exists qna_questions_author_name_length_check,
  drop constraint if exists qna_questions_author_company_length_check,
  drop constraint if exists qna_questions_session_id_length_check;

alter table public.qna_questions
  add constraint qna_questions_text_length_check
    check (char_length(text) <= 200 and char_length(btrim(text)) >= 1),
  add constraint qna_questions_author_name_length_check
    check (author_name is null or char_length(author_name) <= 120),
  add constraint qna_questions_author_company_length_check
    check (author_company is null or char_length(author_company) <= 120),
  add constraint qna_questions_session_id_length_check
    check (session_id is null or char_length(session_id) between 8 and 128);

alter table public.qna_question_votes
  drop constraint if exists qna_question_votes_session_id_length_check;

alter table public.qna_question_votes
  add constraint qna_question_votes_session_id_length_check
    check (char_length(session_id) between 8 and 128);

create index if not exists qna_questions_room_speaker_idx
  on public.qna_questions(room_id, speaker_id, created_at desc);

create index if not exists qna_questions_status_idx
  on public.qna_questions(status, is_pinned, created_at desc);

create index if not exists qna_speakers_room_idx
  on public.qna_speakers(room_id, sort_order);

create unique index if not exists qna_speakers_one_active_per_room_idx
  on public.qna_speakers(room_id)
  where is_active = true;

create unique index if not exists qna_rooms_one_current_session_per_event_idx
  on public.qna_rooms(event_key)
  where is_current_session = true and event_key is not null;

create or replace function public.qna_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists qna_rooms_touch_updated_at on public.qna_rooms;
create trigger qna_rooms_touch_updated_at
before update on public.qna_rooms
for each row execute function public.qna_touch_updated_at();

drop trigger if exists qna_speakers_touch_updated_at on public.qna_speakers;
create trigger qna_speakers_touch_updated_at
before update on public.qna_speakers
for each row execute function public.qna_touch_updated_at();

drop trigger if exists qna_questions_touch_updated_at on public.qna_questions;
create trigger qna_questions_touch_updated_at
before update on public.qna_questions
for each row execute function public.qna_touch_updated_at();

drop trigger if exists qna_votes_after_insert on public.qna_question_votes;
drop trigger if exists qna_votes_after_delete on public.qna_question_votes;
drop function if exists public.qna_recalc_votes_count();

create or replace function public.qna_adjust_votes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $votes$
begin
  if tg_op = 'INSERT' then
    update public.qna_questions
    set votes_count = votes_count + 1
    where id = new.question_id;
  elsif tg_op = 'DELETE' then
    update public.qna_questions
    set votes_count = greatest(votes_count - 1, 0)
    where id = old.question_id;
  end if;
  return null;
end;
$votes$;

revoke execute on function public.qna_adjust_votes_count()
from public, anon, authenticated;

update public.qna_questions question
set votes_count = (
  select count(*)
  from public.qna_question_votes vote
  where vote.question_id = question.id
);

create trigger qna_votes_after_insert
after insert on public.qna_question_votes
for each row execute function public.qna_adjust_votes_count();

create trigger qna_votes_after_delete
after delete on public.qna_question_votes
for each row execute function public.qna_adjust_votes_count();

create or replace function public.remove_vote(
  p_question_id bigint,
  p_session_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_session_id is null or length(trim(p_session_id)) < 8 then
    raise exception 'INVALID_SESSION';
  end if;

  perform 1
  from public.qna_questions question
  where question.id = p_question_id
  for no key update;

  delete from public.qna_question_votes
  where question_id = p_question_id
    and session_id = p_session_id;
end;
$$;

revoke execute on function public.remove_vote(bigint, text) from public;
grant execute on function public.remove_vote(bigint, text) to anon, authenticated;


create or replace function public.add_vote(
  p_question_id bigint,
  p_session_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $addvote$
declare
  v_question_session_id text;
  v_question_status text;
  v_event_key text;
  v_is_current_session boolean;
begin
  if p_session_id is null or length(trim(p_session_id)) < 8 or length(trim(p_session_id)) > 128 then
    raise exception 'INVALID_SESSION' using errcode = '22023';
  end if;

  select question.session_id, question.status, room.event_key, room.is_current_session
  into v_question_session_id, v_question_status, v_event_key, v_is_current_session
  from public.qna_questions question
  join public.qna_rooms room on room.id = question.room_id
  where question.id = p_question_id
  for no key update of question
  for share of room;

  if not found then
    raise exception 'QUESTION_NOT_FOUND' using errcode = '22023';
  end if;

  if v_question_status <> 'open' then
    raise exception 'VOTE_NOT_ALLOWED' using errcode = '42501';
  end if;

  if v_event_key is not null and not v_is_current_session then
    raise exception 'SESSION_NOT_CURRENT' using errcode = '42501';
  end if;

  if v_question_session_id is not null and v_question_session_id = trim(p_session_id) then
    raise exception 'CANNOT_VOTE_OWN_QUESTION' using errcode = '42501';
  end if;

  insert into public.qna_question_votes (question_id, session_id)
  values (p_question_id, trim(p_session_id))
  on conflict (question_id, session_id) do nothing;
end;
$addvote$;

revoke execute on function public.add_vote(bigint, text) from public;
grant execute on function public.add_vote(bigint, text) to anon, authenticated;

create or replace function public.submit_guest_question(
  p_room_id bigint,
  p_speaker_id bigint,
  p_text text,
  p_author_name text,
  p_author_company text,
  p_session_id text
)
returns table(id bigint, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_questions_open boolean;
  v_moderation_enabled boolean;
  v_mode text;
  v_event_key text;
  v_is_current_session boolean;
  v_status text;
  v_id bigint;
  v_session_id text := btrim(p_session_id);
begin
  if p_text is null or char_length(btrim(p_text)) < 1 or char_length(btrim(p_text)) > 200 then
    raise exception 'INVALID_QUESTION' using errcode = '22023';
  end if;

  if v_session_id is null or char_length(v_session_id) < 8 or char_length(v_session_id) > 128 then
    raise exception 'INVALID_SESSION' using errcode = '22023';
  end if;

  if p_author_name is not null and char_length(btrim(p_author_name)) > 120 then
    raise exception 'INVALID_AUTHOR_NAME' using errcode = '22023';
  end if;

  if p_author_company is not null and char_length(btrim(p_author_company)) > 120 then
    raise exception 'INVALID_AUTHOR_COMPANY' using errcode = '22023';
  end if;

  select room.is_questions_open, room.moderation_enabled, room.mode,
         room.event_key, room.is_current_session
  into v_questions_open, v_moderation_enabled, v_mode,
       v_event_key, v_is_current_session
  from public.qna_rooms room
  where room.id = p_room_id
  for update;

  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = '22023';
  end if;

  if v_event_key is not null and not v_is_current_session then
    raise exception 'SESSION_NOT_CURRENT' using errcode = '42501';
  end if;

  if not v_questions_open then
    raise exception 'QUESTIONS_CLOSED' using errcode = '42501';
  end if;

  if v_mode = 'panel' then
    if p_speaker_id is not null then
      raise exception 'PANEL_QUESTION_MUST_NOT_TARGET_SPEAKER' using errcode = '22023';
    end if;
  elsif exists (
    select 1
    from public.qna_speakers speaker
    where speaker.room_id = p_room_id
      and speaker.is_active = true
  ) then
    if p_speaker_id is null or not exists (
      select 1
      from public.qna_speakers speaker
      where speaker.id = p_speaker_id
        and speaker.room_id = p_room_id
        and speaker.is_active = true
    ) then
      raise exception 'SPEAKER_NOT_ACTIVE' using errcode = '22023';
    end if;
  elsif p_speaker_id is not null then
    raise exception 'SPEAKER_NOT_ACTIVE' using errcode = '22023';
  end if;

  v_status := case when v_moderation_enabled then 'pending' else 'open' end;

  insert into public.qna_questions (
    room_id,
    speaker_id,
    text,
    author_name,
    author_company,
    session_id,
    status
  )
  values (
    p_room_id,
    p_speaker_id,
    btrim(p_text),
    nullif(btrim(p_author_name), ''),
    nullif(btrim(p_author_company), ''),
    v_session_id,
    v_status
  )
  returning qna_questions.id into v_id;

  return query select v_id, v_status;
end;
$$;

revoke execute on function public.submit_guest_question(bigint, bigint, text, text, text, text)
from public;
grant execute on function public.submit_guest_question(bigint, bigint, text, text, text, text)
to anon, authenticated;

create or replace function public.reorder_qna_speakers(
  p_room_id bigint,
  p_order jsonb
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_requested integer;
  v_distinct integer;
  v_existing integer;
  v_room_total integer;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_order) <> 'array' then
    raise exception 'p_order must be a JSON array' using errcode = '22023';
  end if;

  select count(*), count(distinct x.id)
  into v_requested, v_distinct
  from jsonb_to_recordset(p_order) as x(id bigint, sort_order integer)
  where x.id is not null and x.sort_order is not null;

  if v_requested <> jsonb_array_length(p_order) or v_distinct <> v_requested then
    raise exception 'Invalid or duplicate speaker order entries' using errcode = '22023';
  end if;

  select count(*)
  into v_room_total
  from public.qna_speakers
  where room_id = p_room_id;

  if v_requested <> v_room_total then
    raise exception 'Complete speaker order required' using errcode = '22023';
  end if;

  select count(*)
  into v_existing
  from public.qna_speakers s
  join jsonb_to_recordset(p_order) as x(id bigint, sort_order integer)
    on x.id = s.id
  where s.room_id = p_room_id;

  if v_existing <> v_requested then
    raise exception 'Speaker order contains rows outside the room' using errcode = '22023';
  end if;

  update public.qna_speakers s
  set sort_order = x.sort_order
  from jsonb_to_recordset(p_order) as x(id bigint, sort_order integer)
  where s.id = x.id
    and s.room_id = p_room_id;
end;
$$;

revoke execute on function public.reorder_qna_speakers(bigint, jsonb)
from public, anon;
grant execute on function public.reorder_qna_speakers(bigint, jsonb)
to authenticated;

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
to authenticated;

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
to authenticated;

create or replace function public.create_qna_event_program_session(
  p_event_key text,
  p_mode text
)
returns table(
  room_id bigint,
  room_slug text,
  program_item_id bigint,
  title text,
  mode text,
  session_order integer,
  starts_at timestamptz,
  duration_minutes integer,
  is_current_session boolean,
  is_questions_open boolean
)
language plpgsql
security definer
set search_path = ''
as $create_session$
declare
  v_room_id bigint;
  v_room_slug text;
  v_program_item_id bigint;
  v_title text;
  v_session_order integer;
  v_starts_at timestamptz;
  v_duration_minutes integer := 30;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_event_key is null or btrim(p_event_key) = '' then
    raise exception 'Event key is required' using errcode = '22023';
  end if;

  if p_mode not in ('speaker', 'panel') then
    raise exception 'Session mode must be speaker or panel' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_event_key));

  if not exists (
    select 1
    from public.qna_rooms room
    where room.event_key = p_event_key
  ) then
    raise exception 'Event not found' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.qna_event_program_items item
    where item.event_key = p_event_key
  ) then
    raise exception 'Program v2 is not initialized for this event' using errcode = '22023';
  end if;

  select coalesce(max(item.session_order), 0) + 10
  into v_session_order
  from public.qna_event_program_items item
  where item.event_key = p_event_key;

  select item.starts_at + pg_catalog.make_interval(mins => item.duration_minutes)
  into v_starts_at
  from public.qna_event_program_items item
  where item.event_key = p_event_key
  order by item.session_order desc, item.id desc
  limit 1;

  v_title := case p_mode
    when 'panel' then 'Новая панель'
    else 'Новое выступление'
  end;

  v_room_id := pg_catalog.nextval(pg_catalog.pg_get_serial_sequence('public.qna_rooms', 'id'));
  v_room_slug := 'qna-session-' || v_room_id::text;

  insert into public.qna_rooms (
    id, slug, title, mode, event_key, session_order, starts_at, duration_minutes,
    is_current_session, is_questions_open, moderation_enabled
  )
  values (
    v_room_id, v_room_slug, v_title, p_mode, p_event_key, v_session_order, v_starts_at, v_duration_minutes,
    false, false, false
  );

  insert into public.qna_event_program_items (
    event_key, room_id, kind, title, session_order, starts_at, duration_minutes
  )
  values (
    p_event_key, v_room_id, 'session', null, v_session_order, v_starts_at, v_duration_minutes
  )
  returning id into v_program_item_id;

  return query
  select
    v_room_id,
    v_room_slug,
    v_program_item_id,
    v_title,
    p_mode,
    v_session_order,
    v_starts_at,
    v_duration_minutes,
    false,
    false;
end;
$create_session$;

revoke execute on function public.create_qna_event_program_session(text, text)
from public, anon;
grant execute on function public.create_qna_event_program_session(text, text)
to authenticated;

create or replace function public.set_active_qna_speaker(
  p_room_id bigint,
  p_speaker_id bigint
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_mode text;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select mode
  into v_mode
  from public.qna_rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Room not found' using errcode = '22023';
  end if;

  if v_mode = 'panel' then
    raise exception 'Active speaker is not used in panel mode' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.qna_speakers
    where id = p_speaker_id
      and room_id = p_room_id
  ) then
    raise exception 'Speaker does not belong to room' using errcode = '22023';
  end if;

  update public.qna_speakers
  set is_active = false
  where room_id = p_room_id
    and is_active = true;

  update public.qna_speakers
  set is_active = true
  where id = p_speaker_id
    and room_id = p_room_id;

  update public.qna_rooms
  set active_speaker_id = p_speaker_id
  where id = p_room_id;
end;
$$;

revoke execute on function public.set_active_qna_speaker(bigint, bigint)
from public, anon;
grant execute on function public.set_active_qna_speaker(bigint, bigint)
to authenticated;

create or replace function public.set_current_event_program_item(
  p_program_item_id bigint
)
returns void
language plpgsql
security invoker
set search_path = public
as $program_current$
declare
  v_event_key text;
  v_kind text;
  v_room_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select event_key, kind, room_id
  into v_event_key, v_kind, v_room_id
  from public.qna_event_program_items
  where id = p_program_item_id;

  if not found then
    raise exception 'Program item not found' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_event_key));

  perform id
  from public.qna_event_program_items
  where event_key = v_event_key
  order by id
  for update;

  perform id
  from public.qna_rooms
  where event_key = v_event_key
  order by id
  for update;

  update public.qna_event_program_items
  set is_current = (id = p_program_item_id)
  where event_key = v_event_key
    and is_current is distinct from (id = p_program_item_id);

  if v_kind = 'session' then
    if v_room_id is null then
      raise exception 'Session program item has no room' using errcode = '22023';
    end if;

    update public.qna_rooms
    set is_current_session = false,
        is_questions_open = false
    where event_key = v_event_key
      and id <> v_room_id
      and (is_current_session = true or is_questions_open = true);

    update public.qna_rooms
    set is_current_session = true
    where id = v_room_id
      and event_key = v_event_key;
  elsif v_kind = 'service' then
    update public.qna_rooms
    set is_current_session = false,
        is_questions_open = false
    where event_key = v_event_key
      and (is_current_session = true or is_questions_open = true);
  else
    raise exception 'Invalid program item kind' using errcode = '22023';
  end if;
end;
$program_current$;

revoke execute on function public.set_current_event_program_item(bigint)
from public, anon;
grant execute on function public.set_current_event_program_item(bigint)
to authenticated;

create or replace function public.clear_current_event_program_item(
  p_event_key text
)
returns void
language plpgsql
security invoker
set search_path = public
as $program_clear$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_event_key is null or btrim(p_event_key) = '' then
    raise exception 'Event key is required' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.qna_rooms where event_key = p_event_key
  ) and not exists (
    select 1 from public.qna_event_program_items where event_key = p_event_key
  ) then
    raise exception 'Event not found' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_event_key));

  perform id
  from public.qna_event_program_items
  where event_key = p_event_key
  order by id
  for update;

  perform id
  from public.qna_rooms
  where event_key = p_event_key
  order by id
  for update;

  update public.qna_event_program_items
  set is_current = false
  where event_key = p_event_key
    and is_current = true;

  update public.qna_rooms
  set is_current_session = false,
      is_questions_open = false
  where event_key = p_event_key
    and (is_current_session = true or is_questions_open = true);
end;
$program_clear$;

revoke execute on function public.clear_current_event_program_item(text)
from public, anon;
grant execute on function public.clear_current_event_program_item(text)
to authenticated;

create or replace function public.set_current_event_session(
  p_room_id bigint
)
returns void
language plpgsql
set search_path = public
as $current$
declare
  v_event_key text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select event_key
  into v_event_key
  from public.qna_rooms
  where id = p_room_id;

  if not found then
    raise exception 'Room not found' using errcode = '22023';
  end if;

  if v_event_key is null then
    raise exception 'Room does not belong to an event' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_event_key));

  perform id
  from public.qna_event_program_items
  where event_key = v_event_key
  order by id
  for update;

  perform id
  from public.qna_rooms
  where event_key = v_event_key
  order by id
  for update;

  update public.qna_event_program_items
  set is_current = (
    kind = 'session'
    and room_id = p_room_id
  )
  where event_key = v_event_key
    and is_current is distinct from (
      kind = 'session'
      and room_id = p_room_id
    );

  update public.qna_rooms
  set is_current_session = false,
      is_questions_open = false
  where event_key = v_event_key
    and id <> p_room_id
    and (is_current_session = true or is_questions_open = true);

  update public.qna_rooms
  set is_current_session = true
  where id = p_room_id;
end;
$current$;

revoke execute on function public.set_current_event_session(bigint)
from public, anon;
grant execute on function public.set_current_event_session(bigint)
to authenticated;


create or replace function public.moderate_qna_question_status(
  p_room_id bigint,
  p_question_id bigint,
  p_status text
)
returns table(id bigint, status text, asked_at timestamptz)
language plpgsql
set search_path = public
as $modstatus$
declare
  v_event_key text;
  v_is_current_session boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_status not in ('open', 'asked', 'hidden') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;

  select room.event_key, room.is_current_session
  into v_event_key, v_is_current_session
  from public.qna_rooms room
  where room.id = p_room_id
  for share;

  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = '22023';
  end if;

  if v_event_key is not null and not v_is_current_session then
    raise exception 'SESSION_NOT_CURRENT' using errcode = '42501';
  end if;

  return query
  update public.qna_questions question
  set status = p_status,
      asked_at = case
        when p_status = 'asked' then now()
        when p_status = 'open' then null
        else question.asked_at
      end
  where question.id = p_question_id
    and question.room_id = p_room_id
  returning question.id, question.status, question.asked_at;

  if not found then
    raise exception 'QUESTION_NOT_FOUND' using errcode = '22023';
  end if;
end;
$modstatus$;

revoke execute on function public.moderate_qna_question_status(bigint, bigint, text)
from public, anon;
grant execute on function public.moderate_qna_question_status(bigint, bigint, text)
to authenticated;

create or replace function public.moderate_qna_question_pin(
  p_room_id bigint,
  p_question_id bigint,
  p_is_pinned boolean
)
returns table(id bigint, is_pinned boolean)
language plpgsql
set search_path = public
as $modpin$
declare
  v_event_key text;
  v_is_current_session boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select room.event_key, room.is_current_session
  into v_event_key, v_is_current_session
  from public.qna_rooms room
  where room.id = p_room_id
  for share;

  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = '22023';
  end if;

  if v_event_key is not null and not v_is_current_session then
    raise exception 'SESSION_NOT_CURRENT' using errcode = '42501';
  end if;

  return query
  update public.qna_questions question
  set is_pinned = p_is_pinned
  where question.id = p_question_id
    and question.room_id = p_room_id
  returning question.id, question.is_pinned;

  if not found then
    raise exception 'QUESTION_NOT_FOUND' using errcode = '22023';
  end if;
end;
$modpin$;

revoke execute on function public.moderate_qna_question_pin(bigint, bigint, boolean)
from public, anon;
grant execute on function public.moderate_qna_question_pin(bigint, bigint, boolean)
to authenticated;

