import { useCallback, useEffect, useState } from 'react';
import type { ActivityView, SessionResponse } from '../../shared/api';
import { activityHeaders } from './api';

export function useActivityView(session: SessionResponse | null, credential: string, onExpired: () => void) {
  const [view, setView] = useState<ActivityView | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [fullSnapshot, setFullSnapshot] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!session) { setView(null); setError(''); return; }
    let alive = true;
    let version: number | undefined;
    let request: AbortController | undefined;
    let wake: (() => void) | undefined;
    let retryNow = false;
    function online() { version = undefined; retryNow = true; request?.abort(); wake?.(); }
    window.addEventListener('online', online);

    async function poll() {
      while (alive) {
        request = new AbortController();
        try {
          const full = version === undefined;
          const response = await fetch(`/api/view${full ? '' : `?after=${version}`}`, {
            headers: activityHeaders(session!, credential), signal: request.signal,
          });
          if (!alive) return;
          if (response.status === 204) continue;
          const body = await response.json();
          if (!alive) return;
          if (response.status === 401 || (response.status === 409 && body.code === 'ACTIVITY_EXPIRED')) { onExpired(); return; }
          if (!response.ok) throw new Error();
          setView(body as ActivityView); setError('');
          version = body.version;
          retryNow = false;
          if (full) setFullSnapshot(value => value + 1);
        } catch {
          if (!alive) return;
          version = undefined;
          setError('連線中斷，正在重新連線；不會自動重送答案。');
          if (retryNow) { retryNow = false; continue; }
          await new Promise<void>(resolve => {
            const timer = setTimeout(done, 800);
            function done() { clearTimeout(timer); wake = undefined; resolve(); }
            wake = done;
          });
        }
      }
    }
    void poll();
    return () => { alive = false; window.removeEventListener('online', online); request?.abort(); wake?.(); };
  }, [session, credential, onExpired, revision]);
  return { view, error, refresh, fullSnapshot };
}
