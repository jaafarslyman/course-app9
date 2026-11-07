-- Ensure a supplied learner session determines chat identity even when the
-- same browser also sends an administrator access token.
-- Run after chat.sql. Safe to run repeatedly.
begin;

do $migration$
declare
  v_function regprocedure;
  v_old text;
  v_new text;
  v_definition text;
begin
  for v_function, v_old, v_new in
    select *
    from (values
      (
        'public.chat_get_state(text)'::regprocedure,
        $old$v_is_admin := public.is_course_admin();$old$,
        $new$v_is_admin := public.is_course_admin() and coalesce(p_session_secret, '') = '';$new$
      ),
      (
        'public.chat_media_upload_permission(text)'::regprocedure,
        $old$if public.is_course_admin() then$old$,
        $new$if public.is_course_admin() and coalesce(p_session_secret, '') = '' then$new$
      ),
      (
        'public.chat_send_message(text, text, text, text, text, bigint)'::regprocedure,
        $old$v_is_admin := public.is_course_admin();$old$,
        $new$v_is_admin := public.is_course_admin() and coalesce(p_session_secret, '') = '';$new$
      ),
      (
        'public.chat_media_path(uuid, text)'::regprocedure,
        $old$if not public.is_course_admin() then$old$,
        $new$if not public.is_course_admin() or coalesce(p_session_secret, '') <> '' then$new$
      )
    ) as changes(function_name, old_text, new_text)
  loop
    select pg_get_functiondef(v_function) into v_definition;

    if position(v_old in v_definition) > 0 then
      execute replace(v_definition, v_old, v_new);
    elsif position(v_new in v_definition) = 0 then
      raise exception 'Unexpected definition for %; no changes were applied for this function', v_function;
    end if;
  end loop;
end
$migration$;

commit;
