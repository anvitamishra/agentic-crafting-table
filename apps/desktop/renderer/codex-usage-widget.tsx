import { useEffect, useMemo, useState } from 'react';
import type { CodexUsage, CodexUsageWindow } from '../codex-usage.ts';
import { createCodexUsageRefresher, startCodexUsageAutoRefresh } from './codex-usage-refresh.ts';
import { Button } from './ui/button.tsx';
import { FloatingPanel } from './ui/floating-panel.tsx';
import { PixelGlyph } from './ui/pixel-glyph.tsx';

function resetLabel(value: string) {
  const reset = new Date(value);
  return `Resets ${reset.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function UsageWindow({ label, usage }: { label: string; usage: CodexUsageWindow }) {
  const percent = Math.round(usage.remainingPercent);
  return <div className="codex-usage-window">
    <div className="codex-usage-window-heading"><span>{label} remaining</span><strong>{percent}%</strong></div>
    <div className="codex-usage-meter" role="progressbar" aria-label={`${label} remaining allowance`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span style={{ width: `${percent}%` }} />
    </div>
    <small>{resetLabel(usage.resetAt)}</small>
  </div>;
}

export function CodexUsageWidget() {
  const [usage, setUsage] = useState<CodexUsage>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(true);
  const refresh = useMemo(() => createCodexUsageRefresher({
    read: () => window.craftingTable.codexUsageRead(),
    onUsage: setUsage,
    onError: setError,
    onLoading: setLoading,
  }), []);
  useEffect(() => {
    void refresh();
    return startCodexUsageAutoRefresh(refresh);
  }, [refresh]);
  if (!visible) return null;

  return <FloatingPanel className="codex-usage-widget" label="Codex usage" title="Codex usage" closeLabel="Hide Codex usage" close={() => setVisible(false)}
    at={{ x: Math.max(12, window.innerWidth - 324), y: 16 }} extras={<Button variant="icon" size="sm" className="codex-usage-refresh" aria-label="Refresh Codex usage" title="Refresh usage" disabled={loading} onClick={() => { void refresh(); }}>
      <PixelGlyph name="refresh" />
    </Button>}>
    {usage ? <div className="codex-usage-windows">
      <UsageWindow label="5-hour" usage={usage.fiveHour} />
      <UsageWindow label="Weekly" usage={usage.weekly} />
    </div> : loading ? <p className="codex-usage-loading" role="status">Reading local Codex usage…</p> : null}
    {error && <p className="codex-usage-error" role="alert">{error}</p>}
  </FloatingPanel>;
}
