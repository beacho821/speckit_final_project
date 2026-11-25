import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClassroomLocation, GroupStanding, ProjectionView } from '../../shared/api';
import { activityHeaders, basicHeader, readError } from './api';
import { questionLabel } from './question-label';
import { phaseLabels } from './ClassroomList';
import Settlement from './Settlement';
import Standings from './Standings';

const messageType = 'classroom-projection';
const readyType = 'classroom-projection-ready';
const projectionPath = /^\/teacher\/classrooms\/([^/]+)\/projection$/;
const retentionMs = 10_000;
const requestTimeoutMs = 25_000;
const sourceProbeMs = 5_000;

type TerminalState = 'reopen' | 'unauthorized';
type ProjectionState =
  | { kind: 'waiting' | TerminalState }
  | { kind: 'live'; view: ProjectionView }
  | { kind: 'reconnecting'; view: ProjectionView | null; expiresAt: number };
type ProjectionWindow = { window: Window; send: () => void; stop: (reason: TerminalState) => void };

class ProjectionError extends Error {
  constructor(readonly kind: TerminalState | 'scope') { super(kind); }
}

function isStandings(value: unknown): value is GroupStanding[] {
  return Array.isArray(value) && value.every(group => group && typeof group.id === 'string'
    && typeof group.name === 'string' && Number.isSafeInteger(group.rank) && group.rank > 0
    && Number.isSafeInteger(group.points) && group.points >= 0);
}

function isProjectionView(value: unknown): value is ProjectionView {
  if (!value || typeof value !== 'object') return false;
  const view = value as ProjectionView;
  return Number.isSafeInteger(view.version) && typeof view.classroomName === 'string'
    && Object.hasOwn(phaseLabels, view.phase)
    && Array.isArray(view.groups) && view.groups.every(group => group && typeof group.id === 'string'
      && typeof group.name === 'string' && typeof group.received === 'boolean')
    && (view.standings === undefined || isStandings(view.standings))
    && (view.settlement === undefined || (view.settlement && Number.isSafeInteger(view.settlement.roundCount)
      && isStandings(view.settlement.groups)))
    && Array.isArray(view.questions) && view.questions.every(question => question
      && typeof question.questionId === 'string' && (question.prompt === null || typeof question.prompt === 'string'));
}

function isProjectionState(value: unknown): value is ProjectionState {
  if (!value || typeof value !== 'object') return false;
  const state = value as ProjectionState;
  switch (state.kind) {
    case 'waiting': case 'reopen': case 'unauthorized': return true;
    case 'live': return isProjectionView(state.view);
    case 'reconnecting': return Number.isFinite(state.expiresAt) && (state.view === null || isProjectionView(state.view));
    default: return false;
  }
}

function withoutExpiredView(state: ProjectionState): ProjectionState {
  return state.kind === 'reconnecting' && state.view && Date.now() >= state.expiresAt
    ? { ...state, view: null } : state;
}

// 正常長輪詢最多等待 20 秒，另留時間供傳輸及讀取內容。
async function requestJson(path: string, headers: HeadersInit, lifetime: AbortSignal): Promise<unknown> {
  const deadline = new AbortController();
  const signal = AbortSignal.any([lifetime, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), requestTimeoutMs);
  let onAbort = () => {};
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }),
      (async () => {
        const response = await fetch(path, { headers, signal });
        if (response.status === 204) return null;
        if (response.status === 401 || response.status === 403) throw new ProjectionError('unauthorized');
        if (response.status === 404) throw new ProjectionError('reopen');
        if (response.status === 409 && (await readError(response)).code === 'ACTIVITY_EXPIRED') {
          throw new ProjectionError('scope');
        }
        if (!response.ok) throw new Error();
        return response.json();
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

export function useOpenProjection(credential: string, authorized: boolean) {
  const windows = useRef(new Map<string, ProjectionWindow>());
  useEffect(() => {
    const entries = windows.current;
    const close = () => { for (const entry of entries.values()) entry.stop('reopen'); };
    const ready = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== readyType
        || typeof event.data.roomId !== 'string') return;
      const entry = entries.get(event.data.roomId);
      if (entry && event.source === entry.window) entry.send();
    };
    window.addEventListener('pagehide', close);
    window.addEventListener('message', ready);
    return () => {
      window.removeEventListener('pagehide', close);
      window.removeEventListener('message', ready);
      for (const entry of entries.values()) entry.stop('unauthorized');
    };
  }, [authorized, credential]);

  return useCallback((room: ClassroomLocation) => {
    if (!authorized) return false;
    const key = room.id;
    const existing = windows.current.get(key);
    if (existing && !existing.window.closed) {
      existing.window.focus();
      existing.send();
      return true;
    }
    existing?.stop('reopen');
    const projection = window.open('/teacher/classrooms/' + encodeURIComponent(key) + '/projection', '_blank');
    if (!projection) return false;
    const roomPath = '/api/classrooms/' + encodeURIComponent(key);
    let current = room;
    let state: ProjectionState = { kind: 'waiting' };
    let running = true;
    let revalidateScope = false;
    let request: AbortController | undefined;
    let wake: (() => void) | undefined;
    let delay = 500;

    function send() {
      state = withoutExpiredView(state);
      try { projection!.postMessage({ type: messageType, roomId: key, state }, window.location.origin); }
      catch { /* 投影分頁可能正在關閉。 */ }
    }
    function reconnect() {
      if (state.kind !== 'reconnecting') {
        state = { kind: 'reconnecting', view: state.kind === 'live' ? state.view : null, expiresAt: Date.now() + retentionMs };
      }
      send();
    }
    function interrupt() {
      reconnect();
      request?.abort();
      wake?.();
    }
    function stop(reason: TerminalState) {
      if (!running) return;
      running = false;
      request?.abort();
      wake?.();
      clearInterval(heartbeat);
      window.removeEventListener('offline', interrupt);
      window.removeEventListener('online', interrupt);
      state = { kind: reason };
      if (!projection!.closed) send();
      windows.current.delete(key);
    }
    function wait(ms: number) {
      return new Promise<void>(resolve => {
        const timer = setTimeout(done, ms);
        function done() { clearTimeout(timer); wake = undefined; resolve(); }
        wake = done;
      });
    }
    const heartbeat = window.setInterval(() => { if (projection.closed) stop('reopen'); else send(); }, 700);
    windows.current.set(key, { window: projection, send, stop });
    window.addEventListener('offline', interrupt);
    window.addEventListener('online', interrupt);
    send();

    void (async () => {
      while (running) {
        const attempt = new AbortController();
        request = attempt;
        try {
          if (revalidateScope) {
            const latest = await requestJson(roomPath, { Authorization: basicHeader('teacher', credential) }, attempt.signal) as ClassroomLocation;
            if (!running || attempt.signal.aborted) continue;
            if (latest?.classroomId !== key || typeof latest.activityId !== 'string'
              || typeof latest.activityEpoch !== 'string') throw new Error();
            if (latest.activityId === current.activityId && latest.activityEpoch === current.activityEpoch) throw new Error();
            current = latest;
            revalidateScope = false;
            state = { kind: 'waiting' };
            send();
          }
          const suffix = state.kind === 'live' ? '?after=' + state.view.version : '';
          const next = await requestJson(roomPath + '/projection' + suffix, activityHeaders({ role: 'teacher', ...current }, credential), attempt.signal);
          if (!running || attempt.signal.aborted) continue;
          if (next === null && suffix) continue;
          if (!isProjectionView(next)) throw new Error();
          state = { kind: 'live', view: next };
          delay = 500;
          send();
        } catch (error) {
          if (!running || attempt.signal.aborted) continue;
          if (error instanceof ProjectionError) {
            if (error.kind !== 'scope') { stop(error.kind); return; }
            revalidateScope = true;
            state = { kind: 'waiting' };
            send();
            continue;
          }
          reconnect();
          await wait(delay);
          delay = Math.min(delay * 2, 4000);
        }
      }
    })();
    return true;
  }, [authorized, credential]);
}

export function ProjectionEntry() {
  const match = window.location.pathname.match(projectionPath);
  if (match && window.opener) {
    try { return <FullProjection roomId={decodeURIComponent(match[1])} />; }
    catch { return <ProjectionPrompt kind="reopen" />; }
  }
  return <ProjectionPrompt kind="unauthorized" />;
}

function FullProjection({ roomId }: { roomId: string }) {
  const [state, setState] = useState<ProjectionState>({ kind: 'waiting' });
  useEffect(() => {
    const opener = window.opener as Window;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let probe: ReturnType<typeof setTimeout> | undefined;
    let sourceDeadline: ReturnType<typeof setTimeout> | undefined;
    let revoked = false;
    const expire = () => setState(withoutExpiredView);
    const ready = () => opener.postMessage({ type: readyType, roomId }, window.location.origin);
    function cancelSourceTimers() {
      clearTimeout(probe);
      clearTimeout(sourceDeadline);
    }
    function sourceUnavailable() {
      if (revoked) return;
      cancelSourceTimers();
      clearTimeout(expiry);
      setState({ kind: 'reopen' });
    }
    const receive = (event: MessageEvent) => {
      if (revoked || event.source !== opener || event.origin !== window.location.origin
        || event.data?.type !== messageType || event.data.roomId !== roomId || !isProjectionState(event.data.state)) return;
      cancelSourceTimers();
      clearTimeout(expiry);
      const next = withoutExpiredView(event.data.state);
      revoked = next.kind === 'unauthorized';
      setState(next);
      if (revoked || next.kind === 'reopen') return;
      if (next.kind === 'reconnecting' && next.view) expiry = setTimeout(expire, next.expiresAt - Date.now());
      // 背景分頁的心跳可能延遲。先請來源回覆，再判斷視窗是否失聯。
      probe = setTimeout(() => { if (!opener.closed) ready(); }, sourceProbeMs);
      sourceDeadline = setTimeout(sourceUnavailable, retentionMs);
    };
    const checkSource = () => { if (opener.closed) sourceUnavailable(); };
    const onVisible = () => {
      if (document.hidden || revoked) return;
      expire();
      checkSource();
      if (!opener.closed) ready();
    };
    window.addEventListener('message', receive);
    document.addEventListener('visibilitychange', onVisible);
    sourceDeadline = setTimeout(sourceUnavailable, retentionMs);
    const sourceCheck = setInterval(checkSource, 1000);
    ready();
    return () => {
      clearTimeout(expiry);
      cancelSourceTimers();
      clearInterval(sourceCheck);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('message', receive);
    };
  }, [roomId]);
  if (state.kind === 'live') return <ProjectionDisplay view={state.view} />;
  if (state.kind === 'reconnecting' && state.view) return <ProjectionDisplay view={state.view} reconnecting />;
  return <ProjectionPrompt kind={state.kind} />;
}

function ProjectionPrompt({ kind }: { kind: Exclude<ProjectionState['kind'], 'live'> }) {
  const instructions = {
    waiting: '正在連線…',
    reconnecting: '重新連線中…',
    reopen: '請從教室導覽重新選擇「開啟教室投影」。',
    unauthorized: '請登入教師端，從教室導覽選擇「開啟教室投影」。',
  };
  return <main className="projection-screen">
    <h1>教室投影</h1><p role="status">{instructions[kind]}</p>
  </main>;
}

export function ProjectionDisplay({ view, reconnecting = false }: { view: ProjectionView; reconnecting?: boolean }) {
  return <main className="projection-screen">
    <header className="projection-header"><div><h1>{view.classroomName}</h1></div>
      <p className="projection-phase" role="status">{view.settlement ? '結算已公布' : phaseLabels[view.phase]}</p></header>
    {reconnecting && <p role="status">重新連線中…</p>}
    {view.settlement ? <Settlement settlement={view.settlement} /> : <div className="projection-grid">
      <section className="projection-question">
        {view.questions.length ? <><h2>{view.questions[0].questionNumber === undefined ? view.title ?? '目前題目' : questionLabel({ questionNumber: view.questions[0].questionNumber })}</h2>
          {view.questions.map(question => <p key={question.questionId}>{(question.partNumber != null || (question.questionNumber === undefined && (view.questions.length > 1 || view.title !== question.questionId))) && <><b>{questionLabel(question)}</b>{' '}</>}{question.prompt}</p>)}</>
          : <h2>等待老師開放搶答</h2>}
        {view.phase === 'ended' && view.winnerGroupName && <p>勝組：{view.winnerGroupName}</p>}
      </section>
      {view.standings ? <aside aria-labelledby="projection-standings-title">
        <h2 id="projection-standings-title">即時排名</h2>
        {view.standings.length ? <Standings groups={view.standings}
          receivedByGroup={view.phase === 'active' || view.phase === 'reviewing'
            ? new Set(view.groups.filter(group => group.received).map(group => group.id)) : undefined} />
          : <p className="projection-phase">尚無組別</p>}
      </aside> : <aside><h2>收件狀態</h2><ul>{view.groups.map(group => <li key={group.id}><strong>{group.name}</strong><span>{group.received ? '已送出' : '尚未送出'}</span></li>)}</ul></aside>}
    </div>}
  </main>;
}
