BEGIN;
-- Session advisory key (1464486217,1): shared runtime admission/exclusive drain.
-- Session advisory key (1464486217,2): exclusive admin freeze/thaw serialization.
-- Never run the runtime functions via a transaction-mode connection pooler.
CREATE TABLE IF NOT EXISTS pilot_grading.migration_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  frozen boolean NOT NULL DEFAULT false,
  frozen_at timestamptz,
  drained_at timestamptz,
  uploads_idle_confirmed_at timestamptz,
  CHECK(frozen = (frozen_at IS NOT NULL)),
  CHECK(frozen OR (drained_at IS NULL AND uploads_idle_confirmed_at IS NULL))
);
INSERT INTO pilot_grading.migration_control(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS pilot_grading.migration_admissions (
  token uuid PRIMARY KEY,
  backend_pid integer NOT NULL,
  backend_started_at timestamptz NOT NULL,
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- A committed marker survives backend death. No lease expiry or automatic purge:
-- a lost backend does not prove that an external PUT/provider call has stopped.
CREATE OR REPLACE FUNCTION pilot_grading.enter_migration(admission_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE is_open boolean; started timestamptz;
BEGIN
  IF NOT pg_try_advisory_lock_shared(1464486217,1) THEN RETURN false; END IF;
  BEGIN
    SELECT NOT frozen INTO is_open FROM pilot_grading.migration_control WHERE singleton=true;
    IF is_open IS DISTINCT FROM true THEN
      PERFORM pg_advisory_unlock_shared(1464486217,1);
      RETURN false;
    END IF;
    SELECT a.backend_start INTO started FROM pg_stat_activity a WHERE a.pid=pg_backend_pid();
    IF started IS NULL THEN RAISE EXCEPTION 'migration_backend_identity_unavailable'; END IF;
    INSERT INTO pilot_grading.migration_admissions(token,backend_pid,backend_started_at)
      VALUES(admission_token,pg_backend_pid(),started);
    RETURN true;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock_shared(1464486217,1);
    RAISE;
  END;
END $$;
CREATE OR REPLACE FUNCTION pilot_grading.leave_migration(admission_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM pilot_grading.migration_admissions
    WHERE token=admission_token AND backend_pid=pg_backend_pid()
    AND backend_started_at=(SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid());
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed <> 1 THEN RETURN false; END IF;
  IF NOT pg_advisory_unlock_shared(1464486217,1) THEN
    RAISE EXCEPTION 'migration_lock_not_owned';
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON pilot_grading.migration_control,pilot_grading.migration_admissions FROM PUBLIC,wj_auth_runtime;
REVOKE ALL ON FUNCTION pilot_grading.enter_migration(uuid),pilot_grading.leave_migration(uuid) FROM PUBLIC,wj_auth_runtime;
DO $$ DECLARE api_role text; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON pilot_grading.migration_control,pilot_grading.migration_admissions FROM %I',api_role);
      EXECUTE format('REVOKE ALL ON FUNCTION pilot_grading.enter_migration(uuid),pilot_grading.leave_migration(uuid) FROM %I',api_role);
    END IF;
  END LOOP;
END $$;
GRANT SELECT ON pilot_grading.migration_control TO wj_auth_runtime;
GRANT EXECUTE ON FUNCTION pilot_grading.enter_migration(uuid),pilot_grading.leave_migration(uuid) TO wj_auth_runtime;
COMMIT;
