BEGIN;
CREATE TABLE IF NOT EXISTS pilot_grading.deliveries (
  delivery_key text PRIMARY KEY,
  job_id uuid NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (delivery_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[1-9][0-9]{0,9}$'),
  CHECK (split_part(delivery_key, ':', 1) = job_id::text),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK (completed_at IS NULL OR lease_token IS NULL)
);
CREATE INDEX IF NOT EXISTS deliveries_available ON pilot_grading.deliveries(available_at,delivery_key)
  WHERE completed_at IS NULL;
REVOKE ALL ON pilot_grading.deliveries FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON pilot_grading.deliveries FROM %I',api_role);
    END IF;
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON pilot_grading.deliveries TO wj_auth_runtime;
COMMIT;
