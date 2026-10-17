-- Local-only fixture for the complete ModeratorLive admin/browser rehearsal.
-- Applied exclusively to isolated Supabase CLI containers in GitHub Actions.
-- Never apply to BLACK_Q_A production.
insert into public.qna_rooms (
  slug,title,fallback_label,mode,event_key,session_order,
  duration_minutes,is_current_session,is_questions_open,moderation_enabled
) values (
  'elina-28-session','Five Team Presentations','Questions for the presenting teams',
  'panel','elina-28-2026',60,35,false,false,false
), (
  'test-day-29-session','Unrelated event','Questions for speakers',
  'panel','test-day-29',10,60,false,false,false
);
insert into public.qna_event_program_items (
  event_key,room_id,kind,title,session_order,starts_at,duration_minutes,is_current
)
select event_key,id,'session',null,session_order,null,duration_minutes,false
from public.qna_rooms
where slug in ('elina-28-session','test-day-29-session');
insert into public.qna_event_program_items (
  event_key,room_id,kind,title,session_order,starts_at,duration_minutes,is_current
)
values
  ('elina-28-2026',null,'service','Opening: Behind Every Startup',10,null,16,false),
  ('elina-28-2026',null,'service','Team Challenge Briefing',20,null,8,false);
