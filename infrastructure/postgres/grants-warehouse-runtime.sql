-- Nonsecret owner-run policy. Applied at bootstrap, reconciliation, and after
-- warehouse migrations. Default future-table rights are append-only; mutable
-- facts/dimensions receive UPDATE/DELETE explicitly after each deployment.
CREATE SCHEMA IF NOT EXISTS warehouse AUTHORIZATION fieldops_warehouse;
CREATE SCHEMA IF NOT EXISTS analytics AUTHORIZATION fieldops_warehouse;
REVOKE ALL ON DATABASE fieldops_warehouse FROM PUBLIC;
REVOKE ALL ON DATABASE fieldops_warehouse FROM fieldops_warehouse_app,fieldops_warehouse_reader;
GRANT CONNECT ON DATABASE fieldops_warehouse TO fieldops_warehouse_app,fieldops_warehouse_reader;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public,warehouse,analytics FROM fieldops_warehouse_app,fieldops_warehouse_reader;
GRANT USAGE ON SCHEMA warehouse,analytics TO fieldops_warehouse_app,fieldops_warehouse_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA warehouse,analytics FROM fieldops_warehouse_app,fieldops_warehouse_reader;
GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA warehouse TO fieldops_warehouse_app;
GRANT SELECT ON ALL TABLES IN SCHEMA warehouse,analytics TO fieldops_warehouse_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA warehouse,analytics FROM fieldops_warehouse_app,fieldops_warehouse_reader;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA warehouse TO fieldops_warehouse_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fieldops_warehouse IN SCHEMA warehouse REVOKE ALL ON TABLES FROM fieldops_warehouse_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fieldops_warehouse IN SCHEMA warehouse GRANT SELECT,INSERT ON TABLES TO fieldops_warehouse_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fieldops_warehouse IN SCHEMA warehouse,analytics REVOKE ALL ON TABLES FROM fieldops_warehouse_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE fieldops_warehouse IN SCHEMA warehouse,analytics GRANT SELECT ON TABLES TO fieldops_warehouse_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE fieldops_warehouse IN SCHEMA warehouse GRANT USAGE,SELECT ON SEQUENCES TO fieldops_warehouse_app;
DO $fieldops_warehouse_grants$
DECLARE relation record;
BEGIN
 FOR relation IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='warehouse' AND c.relkind IN ('r','p') AND c.relname IN (
  'dim_date','dim_technician','dim_supervisor','dim_customer','dim_service_category',
  'dim_workflow_stage','dim_work_order_status','fact_work_order','fact_workflow_stage',
  'fact_booking','fact_sla_breach','fact_supervisor_intervention')
 LOOP EXECUTE format('GRANT UPDATE,DELETE ON TABLE %I.%I TO fieldops_warehouse_app',relation.nspname,relation.relname); END LOOP;
 IF to_regclass('warehouse.schema_migration') IS NOT NULL THEN
  REVOKE ALL ON TABLE warehouse.schema_migration FROM fieldops_warehouse_app;
  GRANT SELECT ON TABLE warehouse.schema_migration TO fieldops_warehouse_app;
 END IF;
END;
$fieldops_warehouse_grants$;
