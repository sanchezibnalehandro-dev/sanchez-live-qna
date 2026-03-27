-- Следующий шаг после перевода login/admin/mod на Supabase Auth.
-- Идея: guest остаётся публичным на чтение + отправку вопросов/голосов,
-- а update-операции уходят только авторизованным пользователям.

alter table public.qna_rooms enable row level security;
alter table public.qna_speakers enable row level security;
alter table public.qna_questions enable row level security;
alter table public.qna_question_votes enable row level security;

-- Снести старые широкие update-политики вручную, если они есть.
-- Дальше задать политику: обновлять qna_rooms/qna_speakers/qna_questions могут только authenticated.

-- Пример логики:
-- create policy ... for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Публичное чтение можно оставить для room/speakers/questions.
-- Публичную вставку можно оставить для qna_questions и qna_question_votes.

-- Если захотите ещё жёстче:
-- 1) guest только insert/select
-- 2) admin/mod только update/select
-- 3) отдельный allow-list по email или user id через auth.uid()
