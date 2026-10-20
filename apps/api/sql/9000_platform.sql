-- Live hints: tell browsers "something changed on <topic>" through Supabase Realtime.
-- Outside Supabase (tests, plain Postgres) there is no realtime schema, so this quietly does nothing.
CREATE OR REPLACE FUNCTION live.hint(topic text, payload jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM realtime.send(payload, 'hint', topic, false);
  EXCEPTION WHEN undefined_function OR invalid_schema_name THEN
    NULL;
  END;
END;
$$;
