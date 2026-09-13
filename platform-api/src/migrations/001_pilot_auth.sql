BEGIN;
CREATE SCHEMA IF NOT EXISTS pilot_auth;
REVOKE ALL ON SCHEMA pilot_auth FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wj_auth_runtime') THEN
    CREATE ROLE wj_auth_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS pilot_auth.guard (id integer PRIMARY KEY CHECK (id = 1));
INSERT INTO pilot_auth.guard VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS pilot_auth.batches (
  id text PRIMARY KEY CHECK (id = 'teacher-pilot-v1'),
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pilot_auth.accounts (
  id uuid PRIMARY KEY,
  batch_id text NOT NULL REFERENCES pilot_auth.batches(id),
  username text UNIQUE NOT NULL CHECK (username ~ '^wj_[0-9a-f]{24}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  role text NOT NULL CHECK (role IN ('teacher','admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  password_hash text NOT NULL,
  session_version integer NOT NULL DEFAULT 1 CHECK (session_version > 0),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION pilot_auth.immutable_password() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    RAISE EXCEPTION 'password_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION pilot_auth.immutable_password() FROM PUBLIC;
DROP TRIGGER IF EXISTS immutable_password ON pilot_auth.accounts;
CREATE TRIGGER immutable_password BEFORE UPDATE ON pilot_auth.accounts FOR EACH ROW EXECUTE FUNCTION pilot_auth.immutable_password();
CREATE TABLE IF NOT EXISTS pilot_auth.sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES pilot_auth.accounts(id),
  session_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON pilot_auth.sessions(account_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON pilot_auth.sessions(expires_at);
CREATE TABLE IF NOT EXISTS pilot_auth.rate_limits (
  bucket text PRIMARY KEY CHECK (bucket ~ '^[0-9a-f]{64}$'),
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0)
);
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON pilot_auth.rate_limits(window_start);
CREATE TABLE IF NOT EXISTS pilot_auth.audit (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES pilot_auth.accounts(id),
  target_id uuid NOT NULL REFERENCES pilot_auth.accounts(id),
  action text NOT NULL CHECK (action = 'account_updated'),
  changed_fields text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA pilot_auth FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA pilot_auth FROM %I',api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA pilot_auth FROM %I',api_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pilot_auth FROM %I',api_role);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA pilot_auth FROM wj_auth_runtime;
GRANT USAGE ON SCHEMA pilot_auth TO wj_auth_runtime;
GRANT SELECT ON pilot_auth.accounts TO wj_auth_runtime;
GRANT UPDATE (display_name, status, session_version, last_login_at) ON pilot_auth.accounts TO wj_auth_runtime;
GRANT SELECT, UPDATE ON pilot_auth.guard TO wj_auth_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON pilot_auth.sessions, pilot_auth.rate_limits TO wj_auth_runtime;
GRANT INSERT ON pilot_auth.audit TO wj_auth_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pilot_auth REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA pilot_auth REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
