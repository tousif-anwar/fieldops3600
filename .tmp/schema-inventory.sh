#!/bin/sh
set -eu
ADMIN="psql -X -v ON_ERROR_STOP=1 -U ${POSTGRES_USER} -d postgres"
echo "SERVER"
$ADMIN -At -F '|' -c "SELECT version();"
echo "DATABASES"
$ADMIN -At -F '|' -c "SELECT datname, pg_get_userbyid(datdba), pg_encoding_to_char(encoding), pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE NOT datistemplate ORDER BY datname;"
for db in $($ADMIN -At -c "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname NOT IN ('template0','template1') ORDER BY datname"); do
  echo "### DATABASE $db"
  psql -X -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "$db" -At -F '|' <<'SQL'
SELECT 'RELATIONS', n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner), GREATEST(c.reltuples::bigint,0), pg_size_pretty(pg_total_relation_size(c.oid))
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relkind IN ('r','p','v','m')
ORDER BY n.nspname,c.relname;
SELECT 'COLUMNS', table_schema, table_name, ordinal_position, column_name, data_type, udt_name, is_nullable, coalesce(column_default,'')
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog','information_schema')
ORDER BY table_schema,table_name,ordinal_position;
SELECT 'CONSTRAINTS', n.nspname, c.relname, con.conname, con.contype, pg_get_constraintdef(con.oid)
FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY n.nspname,c.relname,con.contype,con.conname;
SELECT 'INDEXES', schemaname, tablename, indexname, indexdef
FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename,indexname;
SELECT 'TRIGGERS', n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid), t.tgenabled
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE NOT t.tgisinternal AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY n.nspname,c.relname,t.tgname;
SELECT 'VIEWS', schemaname, viewname, pg_get_viewdef((quote_ident(schemaname)||'.'||quote_ident(viewname))::regclass, true)
FROM pg_views WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,viewname;
SELECT 'MATERIALIZED_VIEWS', schemaname, matviewname, ispopulated, pg_get_viewdef((quote_ident(schemaname)||'.'||quote_ident(matviewname))::regclass, true)
FROM pg_matviews ORDER BY schemaname,matviewname;
SELECT 'FUNCTIONS', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), pg_get_userbyid(p.proowner), p.prosecdef
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY n.nspname,p.proname;
SQL
  echo "--- MIGRATIONS $db"
  psql -X -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "$db" -At -F '|' -c "SELECT 'fieldops_schema_migrations', migration_id, sha256, applied_at_utc FROM fieldops_schema_migrations ORDER BY migration_id" 2>/dev/null || true
  psql -X -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "$db" -At -F '|' -c "SELECT 'schema_migration', version, applied_at_utc FROM warehouse.schema_migration ORDER BY version" 2>/dev/null || true
  echo "--- ROW COUNTS $db"
  psql -X -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "$db" -At -F '|' -c "SELECT schemaname||'.'||relname, n_live_tup, n_dead_tup, last_vacuum, last_analyze FROM pg_stat_user_tables ORDER BY schemaname,relname" 2>/dev/null || true
done
