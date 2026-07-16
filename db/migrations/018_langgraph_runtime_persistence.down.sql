DO $$
DECLARE
  registry_rows BIGINT := 0;
  checkpoint_rows BIGINT := 0;
  blob_rows BIGINT := 0;
  write_rows BIGINT := 0;
BEGIN
  IF to_regclass('langgraph_checkpoint.factory_threads') IS NOT NULL THEN
    SELECT COUNT(*) INTO registry_rows FROM langgraph_checkpoint.factory_threads;
  END IF;
  IF to_regclass('langgraph_checkpoint.checkpoints') IS NOT NULL THEN
    SELECT COUNT(*) INTO checkpoint_rows FROM langgraph_checkpoint.checkpoints;
  END IF;
  IF to_regclass('langgraph_checkpoint.checkpoint_blobs') IS NOT NULL THEN
    SELECT COUNT(*) INTO blob_rows FROM langgraph_checkpoint.checkpoint_blobs;
  END IF;
  IF to_regclass('langgraph_checkpoint.checkpoint_writes') IS NOT NULL THEN
    SELECT COUNT(*) INTO write_rows FROM langgraph_checkpoint.checkpoint_writes;
  END IF;
  IF registry_rows + checkpoint_rows + blob_rows + write_rows > 0 THEN
    RAISE EXCEPTION 'LANGGRAPH-01 rollback refused: % registry, % checkpoints, % blobs, % writes still reference graph threads',
      registry_rows, checkpoint_rows, blob_rows, write_rows;
  END IF;
END
$$;

DROP SCHEMA IF EXISTS langgraph_checkpoint CASCADE;
