import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClassroomLocation, ProjectionView } from '../../shared/api';
import { activityHeaders, ApiRequestError, basicHeader, readError, requireOk } from './api';
import { questionLabel } from './question-label';
import { phaseLabels } from './ClassroomList';

const messageType = 'classroom-projection';
class ProjectionScopeChanged extends Error {}
const projectionPath = /^\/teacher\/classrooms\/([^/]+)\/projection$/;

// 後端會等待最多 20 秒才回覆 204，另留時間供傳輸與讀取內容。
const projectionTimeoutMs = 25_000;

async function requestProjection(path: string, init: RequestInit, lifetime: AbortSignal) {
  const deadline = new AbortController();
  const signal = AbortSignal.any([lifetime, deadline.signal]);
  const timeout = setTimeout(() => deadline.abort(), projectionTimeoutMs);
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }),
      (async () => {
        const response = await fetch(path, { ...init, signal });
        if (response.status === 204) return null;
        if (!response.ok) {
          const issue = await readError(response);
          if (response.status === 409 && issue.code === 'ACTIVITY_EXPIRED') throw new ProjectionScopeChanged();
          throw new ApiRequestError(issue.message);
        }
        const view = await response.json() as ProjectionView;
        if (!Number.isFinite(view?.version) || typeof view.classroomName !== 'string'
          || !Array.isArray(view.groups) || !Array.isArray(view.questions)) throw new Error();
        return view;
      })(),
    ]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
  }
}

export function useOpenProjection(credential: string, authorized: boolean) {
  const windows = useRef(new Map<string, { window: Window; stop: () => void }>());
  const clear = useCallback(() => {
    for (const entry of windows.current.values()) entry.stop();
    windows.current.clear();
  }, []);
  useEffect(() => {
    window.addEventListener('pagehide', clear);
    return () => { window.removeEventListener('pagehide', clear); clear(); };
  }, [credential, authorized, clear]);

  return useCallback((room: ClassroomLocation) => {
    if (!authorized) return false;
    const key = room.id;
    const existing = windows.current.get(key);
    if (existing && !existing.window.closed) {
      existing.window.focus();
      return true;
    }
    existing?.stop();
    const projection = window.open('/teacher/classrooms/' + encodeURIComponent(key) + '/projection', '_blank');
    if (!projection) return false;
    const controller = new AbortController();
    let current = room;
    let snapshot: ProjectionView | null = null;
    const send = () => {
      try { projection.postMessage({ type: messageType, roomId: key, view: snapshot }, window.location.origin); }
      catch { /* 視窗正在關閉。 */ }
    };
    const heartbeat = window.setInterval(() => { if (projection.closed) stop(); else send(); }, 700);
    function stop() {
      controller.abort();
      clearInterval(heartbeat);
      snapshot = null;
      send();
      if (windows.current.get(key)?.stop === stop) windows.current.delete(key);
    }
    windows.current.set(key, { window: projection, stop });
    void (async () => {
      try {
        while (!controller.signal.aborted) {
          const suffix = snapshot ? '?after=' + snapshot.version : '';
          try {
            const headers = activityHeaders({ role: 'teacher', ...current }, credential);
            const next = await requestProjection('/api/classrooms/' + encodeURIComponent(key) + '/projection' + suffix, { headers }, controller.signal);
            if (controller.signal.aborted) return;
            if (!next) continue;
            snapshot = next;
            send();
          } catch (cause) {
            if (!(cause instanceof ProjectionScopeChanged) || controller.signal.aborted) throw cause;
            snapshot = null;
            send();
            const response = await fetch('/api/classrooms/' + encodeURIComponent(key), {
              signal: controller.signal, headers: { Authorization: basicHeader('teacher', credential) },
            });
            await requireOk(response);
            const latest = await response.json() as ClassroomLocation;
            if (latest.classroomId !== key || (latest.activityId === current.activityId && latest.activityEpoch === current.activityEpoch)) throw cause;
            current = latest;
          }
        }
      } catch { stop(); }
    })();
    return true;
  }, [authorized, credential]);
}

export function ProjectionEntry() {
  const match = window.location.pathname.match(projectionPath);
  return match ? <FullProjection roomId={match[1]} /> : <ProjectionPrompt />;
}

function FullProjection({ roomId }: { roomId: string }) {
  const [view, setView] = useState<ProjectionView | null>(null);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const receive = (event: MessageEvent) => {
      if (!window.opener || event.source !== window.opener || event.origin !== window.location.origin
        || event.data?.type !== messageType || event.data.roomId !== roomId) return;
      setView(event.data.view ?? null);
      clearTimeout(timeout);
      timeout = setTimeout(() => setView(null), 2400);
    };
    window.addEventListener('message', receive);
    return () => { clearTimeout(timeout); window.removeEventListener('message', receive); };
  }, [roomId]);
  return view ? <ProjectionDisplay view={view} /> : <ProjectionPrompt />;
}

function ProjectionPrompt() {
  return <main className="projection-screen">
    <h1>教室投影</h1><p>請登入教師端，從教室導覽選擇「開啟教室投影」。</p>
  </main>;
}

export function ProjectionDisplay({ view }: { view: ProjectionView }) {
  return <main className="projection-screen">
    <header className="projection-header"><div><h1>{view.classroomName}</h1></div>
      <p className="projection-phase" role="status">{phaseLabels[view.phase]}</p></header>
    <div className="projection-grid">
      <section className="projection-question">
        {view.questions.length ? <><h2>{view.questions[0].questionNumber === undefined ? view.title ?? '目前題目' : questionLabel({ questionNumber: view.questions[0].questionNumber })}</h2>
          {view.questions.map(question => <p key={question.questionId}>{(question.partNumber != null || (question.questionNumber === undefined && (view.questions.length > 1 || view.title !== question.questionId))) && <><b>{questionLabel(question)}</b>{' '}</>}{question.prompt}</p>)}</>
          : <h2>等待老師開放搶答</h2>}
        {view.phase === 'ended' && view.winnerGroupName && <p>勝組：{view.winnerGroupName}</p>}
      </section>
      <aside><h2>收件狀態</h2><ul>{view.groups.map(group => <li key={group.id}><strong>{group.name}</strong><span>{group.received ? '已送出' : '尚未送出'}</span></li>)}</ul></aside>
    </div>
  </main>;
}
