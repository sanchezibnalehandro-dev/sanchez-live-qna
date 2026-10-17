# Audience Choice · доступ операторов и выпуск

## Решение о правах

ModeratorLive Q&A исторически даёт права на управление любому подтверждённому
пользователю с ролью `authenticated`. Это **не полноценная авторизация**.
Не расширяем этот риск на Audience Choice.

В `audience-choice.sql` есть отдельная закрытая таблица
`public.audience_choice_staff` с парой `(poll_id, user_id)`.
Только оператор, записанный в эту таблицу для **конкретного** опроса,
может получать результаты через `audience_choice_admin_state` и менять
статус через `audience_choice_admin_status`.
Отсутствующий grant означает полный отказ, даже при успешном входе
в Supabase Auth. Гости никогда не читают таблицу напрямую.

Таблица не доступна ролям `anon` и `authenticated` для SELECT/INSERT/UPDATE/DELETE;
выдавать права может только привилегированный администратор базы.
**Миграция никому автоматически не выдаёт права оператора.**

## Предрелизный контроль, выполняет владелец Supabase

1. В Dashboard проекта BLACK_Q_A проверьте Authentication → Settings /
   General configuration: **Allow new users to sign up** должно быть
   отключено, если новых операторов создают только администраторы.
   Убедитесь, что анонимная авторизация тоже не включена там, где она не нужна.
   Текущий коннектор не предоставляет значение этого флага, поэтому статус
   публичной регистрации **пока не подтверждён**.
2. Подтвердите, какой существующий аккаунт должен управлять Audience Choice.
   Не ориентируйтесь на то, что в `auth.users` сейчас всего один пользователь:
   это не доказательство его полномочий.
3. **После** установки `audience-choice.sql`, до публикации голосования,
   запишите одобренного оператора в allowlist точечным SQL.
   Пример для проверки и адаптации (подставить одобренный реальный email;
   не сохранять адрес в репозитории):

```sql
-- Проверить, что ровно один подтверждённый аккаунт подходит.
select count(*) as matching_confirmed_accounts
from auth.users
where email = 'REPLACE_WITH_VERIFIED_OPERATOR_EMAIL'
  and email_confirmed_at is not null;

-- Выполнять только после независимого подтверждения аккаунта.
insert into public.audience_choice_staff (poll_id, user_id)
select p.id, u.id
from public.audience_choice_polls p
join auth.users u on u.email = 'REPLACE_WITH_VERIFIED_OPERATOR_EMAIL'
where p.poll_key in ('elina-28-2026', 'elina-28-rehearsal')
  and u.email_confirmed_at is not null
on conflict (poll_id, user_id) do nothing;

select p.poll_key, count(*) as authorized_operators
from public.audience_choice_polls p
left join public.audience_choice_staff s on s.poll_id=p.id
where p.poll_key in ('elina-28-2026', 'elina-28-rehearsal')
group by p.poll_key;
```

4. Проверьте успешный вход и Open/Close для одобренного оператора и
   отказ другому авторизованному аккаунту (ошибка 42501).
5. Ревокация права производится удалением **конкретной** пары
   `(poll_id,user_id)` привилегированным SQL. Не удаляйте пользователя
   из Auth только ради отключения Audience Choice.

## Граница защиты

Этот ACL защищает **только два административных RPC Audience Choice**.
Он не меняет существующие Q&A / Program v2 RLS-политики,
где любой `authenticated` пользователь по-прежнему может управлять
соответствующими объектами. Это отдельная архитектурная задача;
не надо переписывать весь ModeratorLive в канун трёх мероприятий без
проверенного миграционного плана.

## Release gate

- [ ] Контролируемая регистрация новых Auth-пользователей подтверждена.
- [ ] Владелец одобрил реальные операторские аккаунты.
- [ ] Применена миграция голосования и выданы allowlist grants только этим аккаунтам.
- [ ] Полный локальный интеграционный CI (включая unapproved-user rejection) PASS.
- [ ] Рабочий оператор, iPhone/Android, QR и Close протестированы.
- [ ] После этого решение о merge/deploy на Timeweb и проверка Vercel.

Никаких реальных email, паролей, service_role key и UUID операторов
в этом репозитории не хранить.
