-- The least-privilege role the application connects as (12 Sep 2026 audit, C4).
--
--   psql "$ADMIN_DATABASE_URL" -v app_password="'<generated>'" -f scripts/db-app-role.sql
--
-- Until 12 Sep the application connected as the server administrator, so row-level security and
-- the audit trail's immutability were advisory against itself: the owner of a table can drop its
-- policies, un-force them, or rewrite history. This role cannot. It is not a superuser, cannot
-- bypass RLS, owns nothing, and holds ordinary DML on every table except that it may never
-- UPDATE or DELETE a row of ScheduleAudit — the trail is append-only by construction for the
-- application, while the administrator (which runs migrations and restores) keeps the ability.
--
-- Migrations keep running as the administrator (the pipeline's DATABASE_URL secret is unchanged),
-- so tables a future migration creates are owned by the administrator; the DEFAULT PRIVILEGES
-- below make the grants follow automatically. The audit revoke does not: a future audit-shaped
-- table needs its own REVOKE, which its migration should carry.
--
-- Safe to run twice: the role is created once, the password set every time (the generator owns
-- it), and every GRANT/REVOKE is idempotent.

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE axiomate_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L VALID UNTIL ''infinity''', :app_password)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axiomate_app') \gexec

SELECT format('ALTER ROLE axiomate_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L VALID UNTIL ''infinity''', :app_password) \gexec

GRANT CONNECT ON DATABASE axiomate_tms TO axiomate_app;
GRANT USAGE ON SCHEMA public TO axiomate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO axiomate_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO axiomate_app;

-- The trail: the application appends and reads, and nothing else.
REVOKE UPDATE, DELETE ON "ScheduleAudit" FROM axiomate_app;

-- Tables the administrator creates later (every migration) get the same grants without a hand step.
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO axiomate_app;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO axiomate_app;

-- Proof it ran to the end, and what the role is.
SELECT 'db-app-role ran as ' || current_user
       || '. axiomate_app: login=' || rolcanlogin || ', superuser=' || rolsuper || ', bypassrls=' || rolbypassrls
       || ', audit update=' || has_table_privilege('axiomate_app', '"ScheduleAudit"', 'UPDATE')
       || ', audit delete=' || has_table_privilege('axiomate_app', '"ScheduleAudit"', 'DELETE')
       || ', issue select=' || has_table_privilege('axiomate_app', '"Issue"', 'SELECT') AS result
  FROM pg_roles WHERE rolname = 'axiomate_app';
