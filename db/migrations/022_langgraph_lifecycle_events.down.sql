DO $$
BEGIN
  IF to_regclass('langgraph_checkpoint.factory_lifecycle_events') IS NOT NULL
     AND EXISTS (SELECT 1 FROM langgraph_checkpoint.factory_lifecycle_events LIMIT 1) THEN
    RAISE EXCEPTION 'LangGraph lifecycle event history is not empty; rollback refused';
  END IF;
END
$$;

DROP TABLE IF EXISTS langgraph_checkpoint.factory_lifecycle_events;
DROP FUNCTION IF EXISTS langgraph_checkpoint.reject_factory_lifecycle_event_mutation();
