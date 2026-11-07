-- Reverses migration 0003 (project memory). Not run automatically: apply by hand
-- with psql against the direct connection, then delete the row from
-- schema_migrations so 0003 can be applied again later.
--
--   psql "$DATABASE_URL_UNPOOLED" -f db/rollback/0003_project_memory.down.sql
--   psql "$DATABASE_URL_UNPOOLED" -c "delete from schema_migrations where version = '0003_project_memory'"
--
-- This removes every proposed and accepted memory and its history. Entries and
-- messages are untouched except for the memory_refs column, which is dropped.
begin;
alter table messages drop column if exists memory_refs;
drop table if exists memory_events;
drop table if exists memories;
drop table if exists projects;
commit;
