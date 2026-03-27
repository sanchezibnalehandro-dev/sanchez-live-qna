# altera-qna-live

Live Q&A-инструмент для мероприятий Altera: гости задают вопросы спикеру по QR/ссылке, вопросы собираются в живую ленту, модератор и администратор управляют потоком в отдельных окнах.

## Стек

Ванильный HTML/CSS/JS (ES-модули, без сборщиков), Supabase JS v2 через CDN (esm.sh), деплой на Vercel.

## Рабочий контур

Проект использует Supabase Auth (email + пароль) для авторизации модератора и администратора. Гостевая страница не требует входа.

Маршруты:

- `/` → редирект на `login-auth.html?room=altera-forum`
- `login-auth.html` — вход через Supabase Auth
- `admin-auth.html?room=altera-forum` — админка (управление комнатой, спикерами, вопросами, god-mode)
- `mod-auth.html?room=altera-forum` — окно модератора на сцене (фильтры, статусы, pin, одобрение)
- `ask.html?room=altera-forum` — гостевая страница (вопросы + голосование ±1)

## Основные файлы

- `supabase-qna.js` — весь слой работы с Supabase (запросы, подписки, утилиты)
- `supabase-qna-config.js` — URL и anon key проекта Supabase (не коммитится)
- `theme.css` — дизайн-система (палитра Altera: тёмно-синий фон, электрик-синие акценты)
- `vercel.json` — редирект корня на login-auth

## Возможности

- Гостевая: отправка вопроса, голосование +1 (toggle: можно снять), счётчик символов (200), индикатор приёма, бейдж «ваш вопрос»
- Модератор: фильтры по статусу (все/открытые/на модерации/заданные/скрытые), одобрение, pin, статистика
- Админка: состояние комнаты (toggle приём/премодерация), редактор спикеров, добавление/удаление спикеров, фильтр вопросов по спикеру, god-mode (добавить вопрос вручную, +1 к любому), очистка вопросов с подтверждением, экспорт CSV
- Realtime: подписка на изменения через Supabase Realtime с дебаунсом и reconnect
- RLS: Row Level Security — гости SELECT + INSERT, authenticated UPDATE/DELETE

## Backend

Supabase. Таблицы: `qna_rooms`, `qna_speakers`, `qna_questions`, `qna_question_votes`.

SQL-файлы в репозитории: `schema.sql` (схема + триггеры), `RLS-auth-next.sql` (шаблон политик).

Realtime Publication: все 4 таблицы добавлены в `supabase_realtime`.

## Деплой

Vercel автодеплой из GitHub (`main` ветка). Статический сайт, без серверных функций.

Прод: `https://altera-qna-live.vercel.app/`
