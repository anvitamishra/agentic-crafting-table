import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseCodexUsage, readCodexUsage, type CodexUsage } from './codex-usage.ts';

const response = {
  rate_limit: {
    primary_window: { used_percent: 99, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
    secondary_window: { used_percent: 20, limit_window_seconds: 604_800, reset_at: 1_800_500_000 },
  },
};

async function codexHome(t: test.TestContext, auth?: unknown) {
  const home = await mkdtemp(join(tmpdir(), 'act-codex-usage-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  if (auth !== undefined) {
    await mkdir(home, { recursive: true });
    await writeFile(join(home, 'auth.json'), JSON.stringify(auth));
  }
  return home;
}

function fakeFetch(body: unknown, status = 200) {
  const requests: { input: string | URL | Request; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ input, init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { requests, fetcher };
}

test('reads only Codex usage with the local Codex sign-in', async t => {
  const home = await codexHome(t, { tokens: { access_token: 'fixture-access-token', account_id: 'fixture-account' } });
  const { requests, fetcher } = fakeFetch(response);
  const usage: CodexUsage = await readCodexUsage({ codexHome: home, fetcher });

  assert.deepEqual(usage, {
    fiveHour: { remainingPercent: 1, resetAt: new Date(1_800_000_000 * 1000).toISOString() },
    weekly: { remainingPercent: 80, resetAt: new Date(1_800_500_000 * 1000).toISOString() },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, 'https://chatgpt.com/backend-api/wham/usage');
  assert.equal(requests[0].init?.method, 'GET');
  assert.equal(new Headers(requests[0].init?.headers).get('authorization'), 'Bearer fixture-access-token');
  assert.equal(new Headers(requests[0].init?.headers).get('chatgpt-account-id'), 'fixture-account');
  assert.equal(requests[0].init?.body, undefined);
  assert.equal(requests[0].init?.redirect, 'error');
});

test('maps five-hour and weekly windows by their duration, regardless of API field order', () => {
  const result = parseCodexUsage({
    rate_limit: {
      primary_window: { used_percent: 20, limit_window_seconds: 604_800, reset_at: 1_800_500_000 },
      secondary_window: { used_percent: 99, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
    },
  });

  assert.deepEqual(result, {
    fiveHour: { remainingPercent: 1, resetAt: new Date(1_800_000_000 * 1000).toISOString() },
    weekly: { remainingPercent: 80, resetAt: new Date(1_800_500_000 * 1000).toISOString() },
  });
});

test('rejects rate-limit windows without the expected five-hour and weekly durations', () => {
  assert.throws(() => parseCodexUsage({
    rate_limit: {
      primary_window: { used_percent: 99, limit_window_seconds: 86_400, reset_at: 1_800_000_000 },
      secondary_window: { used_percent: 20, limit_window_seconds: 604_800, reset_at: 1_800_500_000 },
    },
  }), /Codex usage response did not include both the five-hour and weekly limits/);
});

test('reports missing local Codex sign-in without making a request', async t => {
  const home = await codexHome(t);
  let called = false;
  const fetcher: typeof fetch = async () => { called = true; return new Response(); };
  await assert.rejects(readCodexUsage({ codexHome: home, fetcher }), /Codex sign-in was not found/);
  assert.equal(called, false);
});

test('rejects unusable usage data and HTTP errors without exposing response content', async t => {
  const home = await codexHome(t, { tokens: { access_token: 'fixture-access-token', account_id: 'fixture-account' } });
  const malformed = fakeFetch({ rate_limit: { primary_window: {}, secondary_window: {} } });
  await assert.rejects(readCodexUsage({ codexHome: home, fetcher: malformed.fetcher }), /Codex usage response was invalid/);

  const failed = fakeFetch({ secret: 'do not expose' }, 403);
  await assert.rejects(readCodexUsage({ codexHome: home, fetcher: failed.fetcher }), error => {
    assert.match((error as Error).message, /HTTP 403/);
    assert.doesNotMatch((error as Error).message, /do not expose/);
    return true;
  });
});
