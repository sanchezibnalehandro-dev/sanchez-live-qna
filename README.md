# altera-qna-live

Отдельный репозиторий для live Q&A-инструмента: вопросы спикеру по QR, список вопросов, `+1`, модераторская панель и админка.

## Страницы

- `ask.html?room=altera-forum`
- `mod.html?room=altera-forum`
- `admin.html?room=altera-forum`

## База

Используются таблицы:
- `qna_rooms`
- `qna_speakers`
- `qna_questions`
- `qna_question_votes`

## Что уже заложено

- guest / moderator / admin foundation
- тёмная UI-тема под Altera vibe
- Supabase-клиент и базовые операции
- SQL для схемы, RLS и демо-данных
- подготовка под деплой на Vercel
