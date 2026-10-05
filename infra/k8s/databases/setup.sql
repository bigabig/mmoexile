-- The realm's database users, least privilege (run by cluster-db-up.sh as
-- the superuser on every start, so it is idempotent and applies rotated
-- passwords). psql variables: migrate_password, app_password.
--
--   mmoexile_migrate  owns the database and its schema: runs the migrations
--                     (the migrate Job), may change tables
--   mmoexile_app      the services: reads and writes rows, nothing else
--                     (no CREATE/ALTER/DROP/TRUNCATE)

SELECT 'CREATE ROLE mmoexile_migrate LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mmoexile_migrate') \gexec
SELECT 'CREATE ROLE mmoexile_app LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mmoexile_app') \gexec
ALTER ROLE mmoexile_migrate PASSWORD :'migrate_password';
ALTER ROLE mmoexile_app PASSWORD :'app_password';

SELECT 'CREATE DATABASE mmoexile OWNER mmoexile_migrate'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mmoexile') \gexec
REVOKE ALL ON DATABASE mmoexile FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE mmoexile TO mmoexile_app;

\connect mmoexile
-- The schema belongs to the migration user; nobody else may create in it
ALTER SCHEMA public OWNER TO mmoexile_migrate;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO mmoexile_app;
-- Rows of every table, existing and future (created by mmoexile_migrate)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mmoexile_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mmoexile_app;
ALTER DEFAULT PRIVILEGES FOR ROLE mmoexile_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mmoexile_app;
ALTER DEFAULT PRIVILEGES FOR ROLE mmoexile_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO mmoexile_app;
