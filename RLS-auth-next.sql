-- Актуальная RLS-модель для минимального Q&A.
-- Guest: читает публичные данные, отправляет вопросы и голоса.
-- Authenticated: управляет комнатой, спикерами и вопросами.
-- Снятие гостевого голоса выполняется через scoped RPC remove_vote() из schema.sql.

alter table public.qna_rooms enable row level security;
alter table public.qna_speakers enable row level security;
alter table public.qna_questions enable row level security;
alter table public.qna_question_votes enable row level security;

drop policy if exists public_read_rooms on public.qna_rooms;
drop policy if exists auth_update_rooms on public.qna_rooms;

create policy public_read_rooms
on public.qna_rooms
for select
to anon, authenticated
using (true);

create policy auth_update_rooms
on public.qna_rooms
for update
to authenticated
using (true)
with check (true);


drop policy if exists public_read_speakers on public.qna_speakers;
drop policy if exists auth_insert_speakers on public.qna_speakers;
drop policy if exists auth_update_speakers on public.qna_speakers;
drop policy if exists auth_delete_speakers on public.qna_speakers;

create policy public_read_speakers
on public.qna_speakers
for select
to anon, authenticated
using (true);

create policy auth_insert_speakers
on public.qna_speakers
for insert
to authenticated
with check (true);

create policy auth_update_speakers
on public.qna_speakers
for update
to authenticated
using (true)
with check (true);

create policy auth_delete_speakers
on public.qna_speakers
for delete
to authenticated
using (true);


drop policy if exists public_read_questions on public.qna_questions;
drop policy if exists public_insert_questions on public.qna_questions;
drop policy if exists auth_insert_questions on public.qna_questions;
drop policy if exists auth_read_questions on public.qna_questions;
drop policy if exists auth_update_questions on public.qna_questions;
drop policy if exists auth_delete_questions on public.qna_questions;

create policy public_read_questions
on public.qna_questions
for select
to anon
using (status in ('open', 'asked'));

create policy auth_read_questions
on public.qna_questions
for select
to authenticated
using (true);

create policy public_insert_questions
on public.qna_questions
for insert
to anon
with check (
  status in ('open', 'pending')
  and is_pinned = false
  and votes_count = 0
  and exists (
    select 1
    from public.qna_rooms room
    where room.id = qna_questions.room_id
      and room.is_questions_open = true
  )
);

create policy auth_insert_questions
on public.qna_questions
for insert
to authenticated
with check (
  status in ('open', 'pending')
  and is_pinned = false
  and votes_count = 0
);

create policy auth_update_questions
on public.qna_questions
for update
to authenticated
using (true)
with check (true);

create policy auth_delete_questions
on public.qna_questions
for delete
to authenticated
using (true);


drop policy if exists public_read_votes on public.qna_question_votes;
drop policy if exists public_insert_votes on public.qna_question_votes;
drop policy if exists public_delete_votes on public.qna_question_votes;
drop policy if exists auth_delete_votes on public.qna_question_votes;

create policy public_insert_votes
on public.qna_question_votes
for insert
to anon, authenticated
with check (true);

create policy auth_delete_votes
on public.qna_question_votes
for delete
to authenticated
using (true);


-- Ограничиваем права колонками, которые реально использует гостевой UI.
revoke all privileges on table public.qna_rooms from anon;
revoke all privileges on table public.qna_speakers from anon;
revoke all privileges on table public.qna_questions from anon;
revoke all privileges on table public.qna_question_votes from anon;

grant select (
  id, slug, title, fallback_label, is_questions_open, moderation_enabled, active_speaker_id
) on public.qna_rooms to anon;

grant select (
  id, room_id, name, regalia, topic, fallback_label, sort_order, is_active
) on public.qna_speakers to anon;

grant select (
  id, room_id, speaker_id, text, author_name, author_company,
  status, is_pinned, votes_count, created_at, asked_at
) on public.qna_questions to anon;

grant insert (
  room_id, speaker_id, text, author_name, author_company, session_id, status
) on public.qna_questions to anon;

grant insert (question_id, session_id)
on public.qna_question_votes to anon;


-- Авторизованный интерфейс получает только CRUD, который использует приложение.
revoke all privileges on table public.qna_rooms from authenticated;
revoke all privileges on table public.qna_speakers from authenticated;
revoke all privileges on table public.qna_questions from authenticated;
revoke all privileges on table public.qna_question_votes from authenticated;

grant select, update on public.qna_rooms to authenticated;
grant select, insert, update, delete on public.qna_speakers to authenticated;
grant select, insert, update, delete on public.qna_questions to authenticated;
grant insert, delete on public.qna_question_votes to authenticated;

grant usage, select on sequence public.qna_speakers_id_seq to authenticated;
grant usage, select on sequence public.qna_questions_id_seq to anon, authenticated;
grant usage, select on sequence public.qna_question_votes_id_seq to anon, authenticated;
