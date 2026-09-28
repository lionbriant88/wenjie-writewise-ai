BEGIN;
CREATE SCHEMA IF NOT EXISTS pilot_grading;
REVOKE ALL ON SCHEMA pilot_grading FROM PUBLIC;
CREATE TABLE IF NOT EXISTS pilot_grading.tasks (
  owner_id uuid NOT NULL REFERENCES pilot_auth.accounts(id), id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0), rubric_revision integer NOT NULL DEFAULT 0 CHECK(rubric_revision>=0),
  state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','confirmed')), draft jsonb NOT NULL,
  confirmed_package jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  PRIMARY KEY(owner_id,id), UNIQUE(id)
);
CREATE TABLE IF NOT EXISTS pilot_grading.task_revisions (
  owner_id uuid NOT NULL, task_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0), package jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,task_id,revision),
  FOREIGN KEY(owner_id,task_id) REFERENCES pilot_grading.tasks(owner_id,id)
);
CREATE TABLE IF NOT EXISTS pilot_grading.command_receipts (
  owner_id uuid NOT NULL REFERENCES pilot_auth.accounts(id), operation text NOT NULL,
  command_id uuid NOT NULL, payload_hash text NOT NULL CHECK(payload_hash~'^[0-9a-f]{64}$'), response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,operation,command_id)
);
CREATE TABLE IF NOT EXISTS pilot_grading.uploads (
  owner_id uuid NOT NULL, task_id uuid NOT NULL, id uuid NOT NULL, path text UNIQUE NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('material','essay')), mime_type text NOT NULL CHECK(mime_type IN ('image/png','image/jpeg','image/webp')),
  size integer NOT NULL CHECK(size BETWEEN 1 AND 8388608), label text NOT NULL,
  state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','verified','attached')), sha256 text CHECK(sha256~'^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),last_signed_at timestamptz NOT NULL DEFAULT now(),verified_at timestamptz,deleted_at timestamptz,
  PRIMARY KEY(owner_id,id),UNIQUE(id),UNIQUE(owner_id,task_id,id),
  FOREIGN KEY(owner_id,task_id) REFERENCES pilot_grading.tasks(owner_id,id),
  CHECK((state='reserved' AND sha256 IS NULL) OR (state<>'reserved' AND sha256 IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS pilot_grading.task_material_uploads (
  owner_id uuid NOT NULL, task_id uuid NOT NULL,upload_id uuid NOT NULL,
  PRIMARY KEY(owner_id,task_id,upload_id),
  FOREIGN KEY(owner_id,task_id) REFERENCES pilot_grading.tasks(owner_id,id),
  FOREIGN KEY(owner_id,task_id,upload_id) REFERENCES pilot_grading.uploads(owner_id,task_id,id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA pilot_grading FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA pilot_grading FROM %I',api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA pilot_grading FROM %I',api_role);
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA pilot_grading TO wj_auth_runtime;
GRANT SELECT,INSERT,UPDATE ON pilot_grading.tasks TO wj_auth_runtime;
GRANT SELECT,INSERT ON pilot_grading.task_revisions,pilot_grading.command_receipts TO wj_auth_runtime;
GRANT SELECT,INSERT,UPDATE ON pilot_grading.uploads TO wj_auth_runtime;
GRANT SELECT,INSERT,DELETE ON pilot_grading.task_material_uploads TO wj_auth_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pilot_grading REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA pilot_grading REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
