import { useEffect, useState } from 'react';
import type { ActivityView, SessionResponse } from '../../shared/api';
import { activityHeaders } from './api';

export function useActivityView(session: SessionResponse, credential: string, onExpired: () => void) {
  const [view, setView] = useState<ActivityView | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    async function poll() {
      let version: number | undefined;
      while (alive) {
        try {
          const query = version === undefined ? '' : `?after=${version}`;
          const response = await fetch(`/api/view${query}`, { headers: activityHeaders(session, credential), signal: controller.signal });
          if (response.status === 401 || response.status === 409) { if (alive) onExpired(); return; }
          if (response.status === 204) continue;
          if (!response.ok) throw new Error('同步資料失敗，系統正在重新連線。');
          const next = await response.json() as ActivityView;
          if (alive) { setView(next); setError(''); }
          version = next.version;
        } catch (cause) {
          if (!alive || controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : '連線中斷，正在重新連線。');
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }
    }
    void poll();
    return () => { alive = false; controller.abort(); };
  }, [session.activityId, session.role, session.groupId, credential, onExpired]);
  return { view, error };
}
