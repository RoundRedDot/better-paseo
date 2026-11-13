import { useEffect, useRef } from "react";
import type { TasksHandle } from "../data";

export function useSearchHistory(tasks: TasksHandle, query: string, visible: boolean, cancelled = false) {
  const lane = tasks.lanes.done;
  const owner = useRef({}).current;
  const current = useRef({ query, cancelled });
  if (current.current.query !== query || current.current.cancelled !== cancelled) current.current = { query, cancelled };
  const run = current.current;
  const mounted = useRef(false);
  const searching = Boolean(query.trim());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!searching) return;
    tasks.beginHistorySearch?.(owner);
    return () => tasks.endHistorySearch?.(owner);
  }, [searching, owner, tasks.beginHistorySearch, tasks.endHistorySearch]);
  useEffect(() => { tasks.clearHistoryError?.(); }, [query, tasks.clearHistoryError]);
  useEffect(() => {
    if (searching && !cancelled && visible && !tasks.historyError && !tasks.historyBlocked && tasks.ready && lane.hasMore && !lane.loading) {
      tasks.loadMoreSearch?.(() => mounted.current && current.current === run);
    }
  }, [run, query, searching, cancelled, visible, tasks.historyError, tasks.historyBlocked, tasks.ready, lane.hasMore, lane.loading, tasks.loadMoreSearch]);
  return searching && !cancelled && visible && !tasks.historyError && (lane.loading || lane.hasMore || tasks.historyBlocked === true);
}
