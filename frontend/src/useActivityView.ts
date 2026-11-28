import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityView, SessionResponse } from '../../shared/api';
import { activityHeaders } from './api';
import type { TimedSnapshot } from './SubmissionAvailability';

export function useActivityView(session: SessionResponse | null, credential: string, onExpired: (reason: 'authorization' | 'activity') => void) {
  const [view, setView] = useState<TimedSnapshot<ActivityView> | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [fullSnapshot, setFullSnapshot] = useState(0);
  const [completedRefresh, setCompletedRefresh] = useState(0);
  const requestedRefresh = useRef(0);
  const refresh = useCallback(() => {
    const requested = ++requestedRefresh.current;
    setRevision(requested);
    return requested;
  }, []);

  useEffect(() => {
    if (!session) { setView(null); setError(''); return; }
    let alive = true;
    let version: number | undefined;
    let groupId: string | undefined;
    let request: AbortController | undefined;
    let wake: (() => void) | undefined;
    let retryNow = false;
    function online() { version = undefined; retryNow = true; request?.abort(); wake?.(); }
    window.addEventListener('online', online);

    async function poll() {
      while (alive) {
        const controller = new AbortController();
        request = controller;
        try {
          const full = version === undefined;
          const group = groupId ? '&group=' + encodeURIComponent(groupId) : '';
          const response = await fetch(`/api/view${full ? '' : `?after=${version}${group}`}`, {
            headers: activityHeaders(session!, credential), signal: controller.signal,
          });
          if (!alive) return;
          if (controller.signal.aborted) continue;
          if (response.status === 204) continue;
          const body = await response.json();
          if (!alive) return;
          if (controller.signal.aborted) continue;
          if (response.status === 401 || response.status === 403) { onExpired('authorization'); return; }
          if (response.status === 409 && body?.code === 'ACTIVITY_EXPIRED') { onExpired('activity'); return; }
          if (!response.ok || !body || !Number.isSafeInteger(body.version)
            || !['idle', 'preparing', 'active', 'reviewing', 'ended'].includes(body.phase)
            || (body.roundId !== null && typeof body.roundId !== 'string')
            || !Array.isArray(body.closedRoundIds)) throw new Error();
          setView({ ...body, sampledAt: Date.now() }); setError('');
          version = body.version;
          groupId = body.groupId;
          retryNow = false;
          if (full) {
            setFullSnapshot(value => value + 1);
            setCompletedRefresh(revision);
          }
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
  return { view, error, refresh, fullSnapshot, completedRefresh };
}
