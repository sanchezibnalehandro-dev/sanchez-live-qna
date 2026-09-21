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
  is_current_session boolean not null default false,
  active_speaker_id bigint null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  add column if not exists is_current_session boolean;

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

  perform id
  from public.qna_rooms
  where event_key = v_event_key
  order by id
  for update;

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

