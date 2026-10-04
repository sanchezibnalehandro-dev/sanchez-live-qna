alter table public.qna_rooms
  add column if not exists starts_at timestamptz null,
  add column if not exists duration_minutes integer null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qna_rooms_duration_minutes_check'
      and conrelid = 'public.qna_rooms'::regclass
  ) then
    alter table public.qna_rooms
      add constraint qna_rooms_duration_minutes_check
      check (duration_minutes is null or duration_minutes > 0);
  end if;
end;
$$;

grant select (starts_at, duration_minutes)
on public.qna_rooms
to anon;
