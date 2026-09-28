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
CREATE TABLE IF NOT EXISTS pilot_grading.essays (
 owner_id uuid NOT NULL,task_id uuid NOT NULL,id uuid NOT NULL,student_name text NOT NULL,essay_number integer NOT NULL CHECK(essay_number>0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),source_revision integer NOT NULL DEFAULT 1 CHECK(source_revision>0),
 confirmed_transcript text,current_result_job_id uuid,teacher_reviewed boolean NOT NULL DEFAULT false,manual_review_required boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,id),UNIQUE(id),UNIQUE(owner_id,task_id,id),UNIQUE(owner_id,task_id,essay_number),
 FOREIGN KEY(owner_id,task_id) REFERENCES pilot_grading.tasks(owner_id,id)
);
CREATE TABLE IF NOT EXISTS pilot_grading.essay_sources (
 owner_id uuid NOT NULL,task_id uuid NOT NULL,essay_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),confirmed_transcript text,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,essay_id,revision),
 FOREIGN KEY(owner_id,task_id,essay_id) REFERENCES pilot_grading.essays(owner_id,task_id,id)
);
CREATE TABLE IF NOT EXISTS pilot_grading.essay_pages (
 owner_id uuid NOT NULL,task_id uuid NOT NULL,essay_id uuid NOT NULL,upload_id uuid NOT NULL,page_number integer NOT NULL CHECK(page_number BETWEEN 1 AND 10),
 PRIMARY KEY(owner_id,essay_id,page_number),UNIQUE(upload_id),
 FOREIGN KEY(owner_id,task_id,essay_id) REFERENCES pilot_grading.essays(owner_id,task_id,id),
 FOREIGN KEY(owner_id,task_id,upload_id) REFERENCES pilot_grading.uploads(owner_id,task_id,id)
);
CREATE TABLE IF NOT EXISTS pilot_grading.jobs (
 owner_id uuid NOT NULL,task_id uuid NOT NULL,id uuid NOT NULL,essay_id uuid,kind text NOT NULL CHECK(kind IN ('grade','material_context','rubric')),
 source_revision integer,rubric_revision integer,essay_revision integer,draft_revision integer,
 logical_key text UNIQUE NOT NULL CHECK(logical_key~'^[0-9a-f]{64}$'),input_snapshot jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','partial','failed','result_unknown','cancelled')),
 revision integer NOT NULL DEFAULT 1,retryable boolean NOT NULL DEFAULT false,error_code text,retry_at timestamptz,
 attempts integer NOT NULL DEFAULT 0,rate_limit_requeues integer NOT NULL DEFAULT 0,result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,id),UNIQUE(id),UNIQUE(owner_id,task_id,id),
 FOREIGN KEY(owner_id,task_id) REFERENCES pilot_grading.tasks(owner_id,id),
 FOREIGN KEY(owner_id,task_id,essay_id) REFERENCES pilot_grading.essays(owner_id,task_id,id),
 FOREIGN KEY(owner_id,essay_id,source_revision) REFERENCES pilot_grading.essay_sources(owner_id,essay_id,revision),
 FOREIGN KEY(owner_id,task_id,rubric_revision) REFERENCES pilot_grading.task_revisions(owner_id,task_id,revision),
 CHECK((kind='grade' AND essay_id IS NOT NULL AND source_revision IS NOT NULL AND rubric_revision IS NOT NULL AND essay_revision IS NOT NULL) OR (kind<>'grade' AND essay_id IS NULL AND draft_revision IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_job_per_essay ON pilot_grading.jobs(owner_id,essay_id) WHERE essay_id IS NOT NULL AND state IN ('queued','running','result_unknown');
CREATE TABLE IF NOT EXISTS pilot_grading.job_uploads (
 owner_id uuid NOT NULL,task_id uuid NOT NULL,job_id uuid NOT NULL,upload_id uuid NOT NULL,
 PRIMARY KEY(owner_id,job_id,upload_id),
 FOREIGN KEY(owner_id,task_id,job_id) REFERENCES pilot_grading.jobs(owner_id,task_id,id),
 FOREIGN KEY(owner_id,task_id,upload_id) REFERENCES pilot_grading.uploads(owner_id,task_id,id)
);
CREATE TABLE IF NOT EXISTS pilot_grading.executions (
 id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES pilot_grading.jobs(id),token uuid NOT NULL UNIQUE,fence integer NOT NULL UNIQUE CHECK(fence>0),
 state text NOT NULL CHECK(state IN ('preparing','calling','result_unknown','finished','revoked')),
 prepare_deadline timestamptz NOT NULL,call_started_at timestamptz,call_deadline timestamptz,finished_at timestamptz,
 attempts jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pilot_grading.provider_gate (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),fence integer NOT NULL DEFAULT 0,
 active_execution_id uuid REFERENCES pilot_grading.executions(id),pause_reason text,pause_revision integer NOT NULL DEFAULT 1
);
INSERT INTO pilot_grading.provider_gate(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS pilot_grading.outbox (
 job_id uuid PRIMARY KEY REFERENCES pilot_grading.jobs(id),generation integer NOT NULL DEFAULT 1,
 available_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pilot_grading.grading_results (
 owner_id uuid NOT NULL,task_id uuid NOT NULL,essay_id uuid NOT NULL,job_id uuid NOT NULL,source_revision integer NOT NULL,rubric_revision integer NOT NULL,
 ai jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,job_id),
 FOREIGN KEY(owner_id,task_id,job_id) REFERENCES pilot_grading.jobs(owner_id,task_id,id),
 FOREIGN KEY(owner_id,task_id,essay_id) REFERENCES pilot_grading.essays(owner_id,task_id,id)
);
CREATE TABLE IF NOT EXISTS pilot_grading.teacher_reviews (
 owner_id uuid NOT NULL,job_id uuid NOT NULL,revision integer NOT NULL DEFAULT 1,review jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,job_id),FOREIGN KEY(owner_id,job_id) REFERENCES pilot_grading.grading_results(owner_id,job_id)
);
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conname='essays_current_result_fk' AND conrelid='pilot_grading.essays'::regclass) THEN
  ALTER TABLE pilot_grading.essays ADD CONSTRAINT essays_current_result_fk FOREIGN KEY(owner_id,current_result_job_id) REFERENCES pilot_grading.grading_results(owner_id,job_id);
 END IF;
END $$;
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
GRANT SELECT,INSERT,UPDATE ON pilot_grading.essays,pilot_grading.jobs,pilot_grading.executions,pilot_grading.outbox,pilot_grading.teacher_reviews TO wj_auth_runtime;
GRANT SELECT,UPDATE ON pilot_grading.provider_gate TO wj_auth_runtime;
GRANT SELECT,INSERT ON pilot_grading.essay_sources,pilot_grading.essay_pages,pilot_grading.job_uploads,pilot_grading.grading_results TO wj_auth_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pilot_grading REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA pilot_grading REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
