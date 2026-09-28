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
