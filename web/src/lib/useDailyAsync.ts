import { useDailyCycle } from "./DailyCycleContext";
import { useAsync } from "./useAsync";

/** Invalida toda selección anterior en el mismo render del cambio de día. */
export function useDailyAsync<T>(fetcher: (date: string, signal: AbortSignal) => Promise<T>, deps: unknown[] = []) {
  const { cycle, error, retry } = useDailyCycle();
  const state = useAsync(async signal => {
    if (!cycle) return undefined;
    return { date: cycle.date, value: await fetcher(cycle.date, signal) };
  }, [cycle?.date, ...deps]);
  const current = state.data?.date === cycle?.date;
  return { ...state, data: current ? state.data?.value : undefined,
    loading: (!cycle && !error) || state.loading || (!current && !state.error),
    error: cycle ? state.error : error, reload: cycle ? state.reload : retry };
}
