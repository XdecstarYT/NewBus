-- Live hints: tell browsers "something changed on <topic>" through Supabase Realtime.
-- Outside Supabase (tests, plain Postgres) there is no realtime schema, so this quietly does nothing.
CREATE OR REPLACE FUNCTION live.hint(topic text, payload jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM realtime.send(payload, 'hint', topic, false);
  EXCEPTION WHEN OTHERS THEN -- a missed hint must never undo a game action
    NULL;
  END;
END;
$$;
