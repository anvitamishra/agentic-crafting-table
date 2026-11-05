import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CodexUsageWindow {
  remainingPercent: number;
  resetAt: string;
}

export interface CodexUsage {
  fiveHour: CodexUsageWindow;
  weekly: CodexUsageWindow;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function usageWindow(value: unknown): CodexUsageWindow & { windowSeconds: number } {
  if (!isRecord(value)) throw new Error('Codex usage response was invalid.');
  const percent = value.used_percent;
  const windowSeconds = value.limit_window_seconds;
  const reset = value.reset_at;
  const resetMs = typeof reset === 'number' ? reset * 1000 : typeof reset === 'string' ? Date.parse(reset) : Number.NaN;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || typeof windowSeconds !== 'number' || !Number.isFinite(windowSeconds) || !Number.isFinite(resetMs)) {
    throw new Error('Codex usage response was invalid.');
  }
  return {
    remainingPercent: 100 - Math.max(0, Math.min(100, percent)),
    resetAt: new Date(resetMs).toISOString(),
    windowSeconds,
  };
}

export function parseCodexUsage(value: unknown): CodexUsage {
  if (!isRecord(value) || !isRecord(value.rate_limit)) throw new Error('Codex usage response was invalid.');
  const windows = [usageWindow(value.rate_limit.primary_window), usageWindow(value.rate_limit.secondary_window)];
  const fiveHour = windows.find(window => window.windowSeconds === 5 * 60 * 60);
  const weekly = windows.find(window => window.windowSeconds === 7 * 24 * 60 * 60);
  if (!fiveHour || !weekly) throw new Error('Codex usage response did not include both the five-hour and weekly limits.');
  return {
    fiveHour: { remainingPercent: fiveHour.remainingPercent, resetAt: fiveHour.resetAt },
    weekly: { remainingPercent: weekly.remainingPercent, resetAt: weekly.resetAt },
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export async function readCodexUsage({ codexHome, fetcher = fetch }: { codexHome: string; fetcher?: typeof fetch }): Promise<CodexUsage> {
  let contents: string;
  try {
    contents = await readFile(join(codexHome, 'auth.json'), 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') throw new Error('Codex sign-in was not found. Sign in with the Codex CLI first.');
    throw new Error('Codex sign-in could not be read.');
  }

  let auth: unknown;
  try {
    auth = JSON.parse(contents);
  } catch {
    throw new Error('Codex sign-in data is invalid.');
  }
  const tokens = isRecord(auth) && isRecord(auth.tokens) ? auth.tokens : undefined;
  const accessToken = tokens?.access_token, accountId = tokens?.account_id;
  if (typeof accessToken !== 'string' || !accessToken || typeof accountId !== 'string' || !accountId) {
    throw new Error('Codex sign-in does not contain an account session. Sign in with the Codex CLI first.');
  }

  const response = await fetcher('https://chatgpt.com/backend-api/wham/usage', {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'ChatGPT-Account-Id': accountId },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Codex usage request failed (HTTP ${response.status}).`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Codex usage response was invalid.');
  }
  return parseCodexUsage(body);
}
