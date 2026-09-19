create table if not exists public.qna_rooms (
  id bigserial primary key,
  slug text not null unique,
  title text not null default 'Speaker Q&A',
  fallback_label text not null default 'Вопросы спикеру',
  is_questions_open boolean not null default true,
  moderation_enabled boolean not null default false,
  active_speaker_id bigint null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create index if not exists qna_questions_room_speaker_idx
  on public.qna_questions(room_id, speaker_id, created_at desc);

create index if not exists qna_questions_status_idx
  on public.qna_questions(status, is_pinned, created_at desc);

create index if not exists qna_speakers_room_idx
  on public.qna_speakers(room_id, sort_order);

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

create or replace function public.qna_recalc_votes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.qna_questions
  set votes_count = (
    select count(*)
    from public.qna_question_votes v
    where v.question_id = coalesce(new.question_id, old.question_id)
  )
  where id = coalesce(new.question_id, old.question_id);
  return null;
end;
$$;

revoke execute on function public.qna_recalc_votes_count()
from public, anon, authenticated;

drop trigger if exists qna_votes_after_insert on public.qna_question_votes;
create trigger qna_votes_after_insert
after insert on public.qna_question_votes
for each row execute function public.qna_recalc_votes_count();

drop trigger if exists qna_votes_after_delete on public.qna_question_votes;
create trigger qna_votes_after_delete
after delete on public.qna_question_votes
for each row execute function public.qna_recalc_votes_count();

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
