import type { CodexUsage } from '../codex-usage.ts';

export const CODEX_USAGE_REFRESH_INTERVAL_MS = 60 * 1000;

interface IntervalTimers {
  setInterval(callback: () => void, delay: number): number;
  clearInterval(timer: number): void;
}

const browserTimers: IntervalTimers = {
  setInterval: (callback, delay) => window.setInterval(callback, delay),
  clearInterval: timer => window.clearInterval(timer),
};

function messageOf(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message : 'Could not read Codex usage.';
}

export function createCodexUsageRefresher({
  read,
  onUsage,
  onError,
  onLoading,
}: {
  read: () => Promise<CodexUsage>;
  onUsage: (usage: CodexUsage) => void;
  onError: (message: string) => void;
  onLoading: (loading: boolean) => void;
}) {
  let inFlight = false;
  return async () => {
    if (inFlight) return;
    inFlight = true;
    onLoading(true);
    onError('');
    try {
      onUsage(await read());
    } catch (error) {
      onError(messageOf(error));
    } finally {
      inFlight = false;
      onLoading(false);
    }
  };
}

export function startCodexUsageAutoRefresh(
  refresh: () => void | Promise<void>,
  timers: IntervalTimers = browserTimers,
) {
  const timer = timers.setInterval(() => { void refresh(); }, CODEX_USAGE_REFRESH_INTERVAL_MS);
  return () => timers.clearInterval(timer);
}
