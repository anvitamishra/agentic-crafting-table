import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexUsageRefresher, startCodexUsageAutoRefresh } from './codex-usage-refresh.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('schedules automatic refresh every 60 seconds and clears the interval', () => {
  let scheduled: (() => void) | undefined;
  let delay = 0;
  let stopped: number | undefined;
  const handle = 7;
  const calls: string[] = [];

  const stop = startCodexUsageAutoRefresh(
    () => { calls.push('refresh'); },
    { setInterval: (callback, interval) => { scheduled = callback; delay = interval; return handle; }, clearInterval: timer => { stopped = timer; } },
  );

  assert.equal(delay, 60 * 1000);
  scheduled?.();
  assert.deepEqual(calls, ['refresh']);
  stop();
  assert.equal(stopped, handle);
});

test('initial, scheduled and manual refreshes share one in-flight request guard', async () => {
  const response = deferred<{ fiveHour: { remainingPercent: number; resetAt: string }; weekly: { remainingPercent: number; resetAt: string } }>();
  const reads: number[] = [];
  const loaded: number[] = [];
  const loading: boolean[] = [];
  const errors: string[] = [];
  const refresh = createCodexUsageRefresher({
    read: () => { reads.push(reads.length + 1); return response.promise; },
    onUsage: value => loaded.push(value.fiveHour.remainingPercent),
    onError: message => errors.push(message),
    onLoading: value => loading.push(value),
  });
  let scheduled: (() => void) | undefined;
  const handle = 9;
  const stop = startCodexUsageAutoRefresh(
    () => { void refresh(); },
    { setInterval: callback => { scheduled = callback; return handle; }, clearInterval: () => {} },
  );

  const initial = refresh();
  scheduled?.();
  await refresh();
  assert.deepEqual(reads, [1]);

  response.resolve({
    fiveHour: { remainingPercent: 70, resetAt: '2026-11-05T22:00:00.000Z' },
    weekly: { remainingPercent: 40, resetAt: '2026-11-10T00:00:00.000Z' },
  });
  await initial;
  assert.deepEqual(loaded, [70]);
  assert.deepEqual(errors, ['']);
  assert.deepEqual(loading, [true, false]);
  stop();
  stop();
});
