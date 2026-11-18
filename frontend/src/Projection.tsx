import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ClassroomLocation, ProjectionView } from '../../shared/api';
import { activityHeaders, basicHeader, requestMessage, requireOk } from './api';
import { phaseLabels } from './ClassroomList';

const messageType = 'classroom-projection';
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
        await requireOk(response);
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
  const windows = useRef(new Map<string, () => void>());
  const clear = useCallback(() => {
    for (const stop of windows.current.values()) stop();
    windows.current.clear();
  }, []);
  useEffect(() => {
    window.addEventListener('pagehide', clear);
    return () => { window.removeEventListener('pagehide', clear); clear(); };
  }, [credential, authorized, clear]);

  return useCallback((room: ClassroomLocation) => {
    if (!authorized) return false;
    const key = room.id;
    const projection = window.open('/teacher/classrooms/' + encodeURIComponent(key) + '/projection', '_blank');
    if (!projection) return false;
    windows.current.get(key)?.();
    const controller = new AbortController();
    const headers = activityHeaders({ role: 'teacher', ...room }, credential);
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
      if (windows.current.get(key) === stop) windows.current.delete(key);
    }
    windows.current.set(key, stop);
    void (async () => {
      try {
        while (!controller.signal.aborted) {
          const suffix: string = snapshot ? '?after=' + snapshot.version : '';
          const next: ProjectionView | null = await requestProjection('/api/classrooms/' + encodeURIComponent(key) + '/projection' + suffix, { headers }, controller.signal);
          if (controller.signal.aborted) return;
          if (!next) continue;
          snapshot = next;
          send();
        }
      } catch { stop(); }
    })();
    return true;
  }, [authorized, credential]);
}

export function ProjectionEntry() {
  const match = window.location.pathname.match(projectionPath);
  return match ? <FullProjection roomId={decodeURIComponent(match[1])} /> : <GroupProjection />;
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
  return view ? <ProjectionDisplay view={view} /> : <main className="projection-screen">
    <h1>教室投影</h1><p>請由已登入教師的教室管理頁開啟投影。</p>
  </main>;
}

function GroupProjection() {
  const [input, setInput] = useState('');
  const [code, setCode] = useState('');
  const [view, setView] = useState<ProjectionView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const loginRequest = useRef<AbortController | null>(null);

  useEffect(() => () => loginRequest.current?.abort(), []);
  useEffect(() => {
    if (!code) return;
    const controller = new AbortController();
    void (async () => {
      let revision: number | undefined;
      try {
        while (!controller.signal.aborted) {
          const next = await requestProjection('/api/projections/group/view' + (revision === undefined ? '' : '?after=' + revision), {
            headers: { Authorization: basicHeader('projection', code) },
          }, controller.signal);
          if (controller.signal.aborted) return;
          if (!next) continue;
          setView(next); revision = next.version;
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setView(null); setCode(''); setInput('');
          setError(requestMessage(cause, '投影連線未完成，請確認連線後重新輸入加入碼。'));
        }
      }
    })();
    return () => controller.abort();
  }, [code]);

  async function join(event: FormEvent) {
    event.preventDefault();
    const secret = input.trim();
    if (!secret || busy) return;
    const controller = new AbortController();
    loginRequest.current = controller;
    setBusy(true); setError('');
    try {
      const snapshot = await requestProjection('/api/projections/group/session', {
        method: 'POST', headers: { Authorization: basicHeader('projection', secret) },
      }, controller.signal);
      if (!snapshot) throw new Error();
      if (!controller.signal.aborted) { setView(snapshot); setCode(secret); setInput(''); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(requestMessage(cause, '投影連線未完成，請確認連線後重新輸入加入碼。'));
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return view ? <ProjectionDisplay view={view} /> : <main className="projection-screen">
    <h1>組別投影</h1>
    <form className="form-stack projection-entry" onSubmit={join}>
      <label htmlFor="projection-code">投影加入碼</label>
      <input id="projection-code" type="password" autoComplete="off" required value={input} onChange={event => setInput(event.target.value)} />
      <button className="primary" disabled={!input.trim() || busy}>{busy ? '正在驗證…' : '開啟投影'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </main>;
}

export function ProjectionDisplay({ view }: { view: ProjectionView }) {
  return <main className="projection-screen">
    <header className="projection-header"><div><h1>{view.classroomName}</h1>{view.groupName && <p>{view.groupName}</p>}</div>
      <p className="projection-phase" role="status">{phaseLabels[view.phase]}</p></header>
    <div className="projection-grid">
      <section className="projection-question">
        {view.questions.length ? <><h2>{view.title ?? '目前題目'}</h2>
          {view.questions.map(question => <p key={question.questionId}>{(view.questions.length > 1 || view.title !== question.questionId) && <><b>{question.questionId}</b>{' '}</>}{question.prompt}</p>)}</>
          : <h2>等待老師開放搶答</h2>}
        {view.phase === 'ended' && view.winnerGroupName && <p>勝組：{view.winnerGroupName}</p>}
      </section>
      <aside><h2>收件狀態</h2><ul>{view.groups.map(group => <li key={group.id}><strong>{group.name}</strong><span>{group.received ? '已送出' : '尚未送出'}</span></li>)}</ul></aside>
    </div>
  </main>;
}
