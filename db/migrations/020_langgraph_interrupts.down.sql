DO $$
BEGIN
  IF (to_regclass('langgraph_checkpoint.factory_interrupts') IS NOT NULL
      AND EXISTS (SELECT 1 FROM langgraph_checkpoint.factory_interrupts LIMIT 1))
     OR (to_regclass('langgraph_checkpoint.factory_run_actions') IS NOT NULL
      AND EXISTS (SELECT 1 FROM langgraph_checkpoint.factory_run_actions LIMIT 1)) THEN
    RAISE EXCEPTION 'LangGraph operator history is not empty; rollback refused';
  END IF;
END
$$;

DROP TABLE IF EXISTS langgraph_checkpoint.factory_run_actions;
DROP TABLE IF EXISTS langgraph_checkpoint.factory_interrupts;
ALTER TABLE langgraph_checkpoint.factory_threads
  DROP COLUMN IF EXISTS last_error_code,
  DROP COLUMN IF EXISTS operator_version;
ALTER TABLE langgraph_checkpoint.factory_threads
  DROP CONSTRAINT IF EXISTS langgraph_thread_status_check;
ALTER TABLE langgraph_checkpoint.factory_threads
  ADD CONSTRAINT langgraph_thread_status_check
  CHECK (status IN ('active','paused','completed','failed','expired'));
