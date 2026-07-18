DO $$
BEGIN
  IF to_regclass('runtime_control.ownership_epochs') IS NOT NULL
     AND EXISTS (SELECT 1 FROM runtime_control.ownership_epochs LIMIT 1) THEN
    RAISE EXCEPTION 'Runtime ownership history is not empty; rollback refused';
  END IF;
END
$$;

DROP TABLE IF EXISTS runtime_control.migration_records;
DROP TABLE IF EXISTS runtime_control.ownership_epochs;
DROP SCHEMA IF EXISTS runtime_control;
