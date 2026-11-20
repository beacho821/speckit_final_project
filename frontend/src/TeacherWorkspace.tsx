import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArchivedRoster, ClassroomLocation, RosterResponse, SessionResponse } from '../../shared/api';
import { activityHeaders, basicHeader, readError, readList, requestMessage, requireOk } from './api';
import { useActivityView } from './useActivityView';
import ClassroomList from './ClassroomList';
import TeacherRound from './TeacherRound';
import TeacherResults, { useTeacherWriteback } from './TeacherResults';
import Roster from './Roster';
import WorksheetImport from './WorksheetImport';

const rootPath = '/teacher/classrooms';
type Area = 'settings' | 'groups' | 'console';
const areaNames: Record<Area, string> = { groups: '分組管理', settings: '題目管理', console: '老師控制台' };

export default function TeacherPortal({ credential, path, navigate, logout, openProjection }: {
  credential: string; path: string; navigate: (path: string) => void;
  logout: () => void; openProjection: (room: ClassroomLocation) => boolean;
}) {
  const id = path.match(/^\/teacher\/classrooms\/([^/]+)(?:\/(groups|console))?$/);
  return <main className="teacher-shell">
    <header className="teacher-bar"><a href={rootPath} onClick={event => { event.preventDefault(); navigate(rootPath); }}>課堂活動</a>
      <button className="quiet" onClick={logout}>登出</button></header>
    {id ? <SelectedRoom key={id[1]} id={id[1]} area={(id[2] as Area | undefined) ?? 'settings'} {...{ credential, navigate, logout, openProjection }} />
      : <ClassroomList credential={credential} onOpen={roomId => navigate(rootPath + '/' + roomId + '/groups')} onExpired={logout} />}
  </main>;
}

function SelectedRoom({ id, area, credential, navigate, logout, openProjection }: {
  id: string; area: Area; credential: string; navigate: (path: string) => void; logout: () => void;
  openProjection: (room: ClassroomLocation) => boolean;
}) {
  const [room, setRoom] = useState<ClassroomLocation>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(rootApi(id), { headers: { Authorization: basicHeader('teacher', credential) }, signal: controller.signal })
      .then(async response => {
        if (controller.signal.aborted) return;
        if (response.status === 401) return logout();
        await requireOk(response);
        const info = await response.json() as ClassroomLocation;
        if (!controller.signal.aborted) setRoom(info);
      }).catch(error => { if (!controller.signal.aborted) setError(requestMessage(error, '教室載入失敗，請確認連線後重新載入。')); });
    return () => controller.abort();
  }, [id, credential, logout, retry]);

  if (!room) return <section className="work-panel">
    <button className="secondary-button" onClick={() => navigate(rootPath)}>返回教室列表</button>
    {error ? <><p className="error" role="alert">{error}</p><button className="secondary-button" onClick={() => { setError(''); setRetry(value => value + 1); }}>重新載入</button></> : <p role="status">正在載入教室…</p>}
  </section>;
  return <TeacherWorkspace key={room.activityId + ':' + room.activityEpoch} {...{ room, area, credential, navigate, logout, openProjection, setRoom }} />;
}

function rootApi(id: string) { return '/api/classrooms/' + encodeURIComponent(id); }

function TeacherWorkspace({ room, area, credential, navigate, logout, openProjection, setRoom }: {
  room: ClassroomLocation; area: Area; credential: string; navigate: (path: string) => void;
  logout: () => void; openProjection: (room: ClassroomLocation) => boolean;
  setRoom: (next: ClassroomLocation) => void;
}) {
  const [session] = useState<SessionResponse>(() => ({
    role: 'teacher', activityId: room.activityId, classroomId: room.classroomId, activityEpoch: room.activityEpoch,
  }));
  const [roster, setRoster] = useState<RosterResponse>();
  const [error, setError] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [pendingImportRefresh, setPendingImportRefresh] = useState<number>();
  const [starting, setStarting] = useState(false);
  const [settlement, setSettlement] = useState(false);
  const [scopeStatus, setScopeStatus] = useState<'ready' | 'checking' | 'stale'>('ready');
  const [scopeRefresh, setScopeRefresh] = useState<number>();
  const refreshForLocation = useRef<() => number>(() => 0);
  const locationRequest = useRef<AbortController | null>(null);
  const startRequest = useRef<AbortController | null>(null);
  const settlementButton = useRef<HTMLButtonElement>(null);
  const settlementHeading = useRef<HTMLHeadingElement>(null);
  const changeDialog = useRef<HTMLDialogElement>(null);
  const newActivityButton = useRef<HTMLButtonElement>(null);
  const focus = useRef<HTMLHeadingElement>(null);
  const base = rootPath + '/' + room.id;
  const exitRoom = useCallback(() => navigate(rootPath), [navigate]);
  const reloadLocation = useCallback(async () => {
    if (locationRequest.current) return;
    const controller = new AbortController();
    locationRequest.current = controller;
    setScopeStatus('checking');
    try {
      const response = await fetch(rootApi(room.id), {
        headers: { Authorization: basicHeader('teacher', credential) }, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { logout(); return; }
      await requireOk(response);
      const latest = await response.json() as ClassroomLocation;
      if (controller.signal.aborted) return;
      if (latest.id !== room.id || latest.classroomId !== room.classroomId
        || !latest.activityId || !latest.activityEpoch) throw new Error();
      if (latest.activityId !== room.activityId || latest.activityEpoch !== room.activityEpoch) {
        setRoom(latest);
        return;
      }
      setScopeRefresh(refreshForLocation.current());
      setScopeStatus('ready');
      setError('仍是同一場活動，請核對最新狀態後再試。');
    } catch {
      if (!controller.signal.aborted) {
        setScopeStatus('stale');
        setError('無法確認目前活動，請檢查連線並重新取得活動。');
      }
    } finally { if (locationRequest.current === controller) locationRequest.current = null; }
  }, [room.id, room.classroomId, room.activityId, room.activityEpoch, credential, logout, setRoom]);

  const expire = useCallback((reason: 'authorization' | 'activity') => {
    if (reason === 'authorization') { logout(); return; }
    setSettlement(false);
    setError('活動已更新，正在重新取得這間教室的目前活動。');
    void reloadLocation();
  }, [logout, reloadLocation]);
  const writeback = useTeacherWriteback(session, credential, expire);
  const { view, error: syncError, refresh, fullSnapshot, completedRefresh } = useActivityView(session, credential, expire);
  useEffect(() => () => { locationRequest.current?.abort(); startRequest.current?.abort(); }, []);
  useEffect(() => { refreshForLocation.current = refresh; }, [refresh]);
  const scopeUnconfirmed = scopeStatus !== 'ready' || (scopeRefresh !== undefined && completedRefresh < scopeRefresh);
  const waitingImport = pendingImportRefresh !== undefined && completedRefresh < pendingImportRefresh;

  useEffect(() => { focus.current?.focus(); }, [area]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/roster', { headers: activityHeaders(session, credential), signal: controller.signal })
      .then(async response => {
        if (controller.signal.aborted) return;
        if (response.status === 401) return logout();
        await requireOk(response);
        const data = await response.json() as RosterResponse;
        if (!controller.signal.aborted) setRoster(current => !current || current.rosterVersion <= data.rosterVersion ? data : current);
      }).catch(error => { if (!controller.signal.aborted) setError(requestMessage(error, '分組名單載入失敗，請確認連線後重新載入頁面。')); });
    return () => controller.abort();
  }, [session, credential, logout, view?.rosterVersion]);

  async function startNew() {
    if (!canStartNew || startRequest.current) return;
    const controller = new AbortController();
    startRequest.current = controller;
    setStarting(true); setError('');
    try {
      const response = await fetch(rootApi(room.id) + '/activities', {
        method: 'POST', headers: activityHeaders(session, credential), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        const issue = await readError(response);
        if (controller.signal.aborted) return;
        closeChange();
        if (response.status === 401 || response.status === 403) expire('authorization');
        else if (issue.code === 'ACTIVITY_EXPIRED') expire('activity');
        else { setError(issue.message); refresh(); }
        return;
      }
      const latest = await response.json() as ClassroomLocation;
      if (controller.signal.aborted) return;
      if (latest.id !== room.id || latest.classroomId !== room.classroomId || !latest.activityId
        || !latest.activityEpoch || latest.activityId === room.activityId) throw new Error();
      closeChange();
      setSettlement(false);
      setRoom(latest);
    } catch {
      if (controller.signal.aborted) return;
      closeChange();
      setError('切換結果待確認，正在重新取得目前活動。');
      await reloadLocation();
    } finally {
      if (startRequest.current === controller) startRequest.current = null;
      if (!controller.signal.aborted) setStarting(false);
    }
  }

  function closeChange() { changeDialog.current?.close?.(); newActivityButton.current?.focus(); }

  const phase = view?.phase ?? room.phase;
  const serverWriteback = view ? Boolean(view.writebackInProgress) : Boolean(room.writebackInProgress);
  const link = (to: Area) => to === 'settings' ? base : base + '/' + to;
  const roundRestriction = phase === 'active' ? '請先到控制台結束搶答，再審核並定案。'
    : phase === 'reviewing' ? '請先到控制台完成審核與定案。' : '';
  const settlementRestriction = roundRestriction || (!view || syncError || scopeUnconfirmed ? '請等待確認目前活動。' : '');
  const visibleSettlement = area === 'console' && settlement && !roundRestriction;
  const startRestriction = settlementRestriction || (serverWriteback || writeback.pending ? '回填進行中，請稍後再試。' : '')
    || (importBusy || waitingImport ? '請等待題目資料同步完成。' : '');
  const canStartNew = visibleSettlement && !startRestriction && !starting;

  useEffect(() => {
    if (area === 'console' && !roundRestriction) return;
    changeDialog.current?.close();
    setSettlement(false);
  }, [area, roundRestriction]);

  useEffect(() => {
    if (visibleSettlement) settlementHeading.current?.focus();
  }, [visibleSettlement]);

  function leaveSettlement() {
    setSettlement(false);
    requestAnimationFrame(() => settlementButton.current?.focus());
  }

  return <>
    <header className="classroom-page-title">
      <a href={rootPath} onClick={event => { event.preventDefault(); exitRoom(); }}>返回教室列表</a>
      <h1 ref={focus} tabIndex={-1}>{room.name}</h1>
      <nav className="classroom-nav" aria-label="教室工作區">{(Object.keys(areaNames) as Area[]).map(item =>
        <a key={item} href={link(item)} aria-current={item === area ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate(link(item)); }}>{areaNames[item]}</a>)}
        <a className="projection-link" href={base + '/projection'} target="_blank" rel="opener"
          aria-label="開啟教室投影（新分頁）" onAuxClick={event => {
            if (event.button !== 1) return;
            event.preventDefault();
            setError(openProjection(room) ? '' : '瀏覽器阻擋投影視窗，請允許開啟新分頁後再試。');
          }} onClick={event => {
            event.preventDefault();
            setError(openProjection(room) ? '' : '瀏覽器阻擋投影視窗，請允許開啟新分頁後再試。');
          }}>開啟教室投影</a>
      </nav>
    </header>
    {error && <p className="error work-message" role="alert">{error}</p>}
    {scopeStatus === 'stale' && <button className="secondary-button" onClick={() => void reloadLocation()}>重新取得活動</button>}
    {area === 'groups' && <section className="work-panel">
      {roster ? <Roster {...{ session, credential, roster }} onSave={setRoster} />
        : !error && <p role="status">正在載入分組…</p>}
      <ArchivedRosters classroomId={room.id} credential={credential} />
    </section>}
    <div hidden={area === 'groups' || visibleSettlement}>
      <div className={area === 'console' ? 'work-panel console-panel' : 'work-panel'}>
        <div hidden={area !== 'settings'}>{view && <WorksheetImport {...{ session, credential }}
          catalogRevision={view?.catalogRevision} preview={view?.worksheetPreview ?? null} locked={roster?.locked ?? false}
          unconfirmed={waitingImport} completedRefresh={completedRefresh} onBusy={setImportBusy} onPublished={refresh}
          onUnconfirmed={() => setPendingImportRefresh(refresh())} onExpired={exitRoom} />}</div>
        <TeacherRound {...{ session, credential, view, syncError, refresh, fullSnapshot, completedRefresh }}
          mode={area === 'console' ? 'console' : 'settings'} blocked={waitingImport || importBusy || scopeUnconfirmed}
          onSettings={() => navigate(base)} onExpired={exitRoom} />
      </div>
      {area === 'console' && !visibleSettlement && <div className="activity-actions">
        <button className="secondary-button" ref={settlementButton} disabled={Boolean(settlementRestriction)}
          aria-describedby={settlementRestriction ? 'settlement-hint' : undefined} onClick={() => setSettlement(true)}>結算</button>
        {settlementRestriction && <p id="settlement-hint" className="muted">{settlementRestriction}</p>}
      </div>}
    </div>
    {visibleSettlement && <section className="work-panel teacher-results-panel">
      <div className="section-heading">
        <h2 ref={settlementHeading} tabIndex={-1}>結算</h2>
        <button className="quiet" onClick={leaveSettlement}>返回主持</button>
      </div>
      <TeacherResults {...{ session, credential }} source={view?.worksheetPreview?.source}
        hasResults={Boolean(view?.closedRoundIds.length)}
        disabled={Boolean(settlementRestriction) || serverWriteback || starting}
        writeback={writeback} onExpired={expire} />
      <div className="activity-actions">
        <button className="secondary-button" ref={newActivityButton} aria-describedby={startRestriction ? 'start-activity-hint' : undefined}
          disabled={!canStartNew} onClick={() => changeDialog.current?.showModal()}>開始新活動</button>
        {startRestriction && <p id="start-activity-hint" className="muted">{startRestriction}</p>}
      </div>
      <dialog ref={changeDialog} className="work-dialog" aria-labelledby="activity-title" onCancel={event => { event.preventDefault(); if (!starting) closeChange(); }}>
        <h2 id="activity-title">開始新活動</h2><p>保留舊紀錄，並沿用分組與完整出題清單及順序。請向學生發放新加入碼。</p>
        <div className="row-actions"><button autoFocus className="secondary-button" disabled={starting} onClick={closeChange}>取消</button>
          <button className="primary" disabled={!canStartNew} onClick={() => void startNew()}>確認開始</button></div>
      </dialog>
    </section>}

  </>;
}


function ArchivedRosters({ classroomId, credential }: { classroomId: string; credential: string }) {
  const [expanded, setExpanded] = useState(false);
  const [rosters, setRosters] = useState<ArchivedRoster[]>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!expanded || rosters) return;
    const controller = new AbortController();
    void fetch(rootApi(classroomId) + '/activities/history', {
      headers: { Authorization: basicHeader('teacher', credential) }, signal: controller.signal,
    }).then(async response => {
      await requireOk(response);
      const data = await readList<ArchivedRoster>(response);
      if (!controller.signal.aborted) setRosters(data);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(requestMessage(cause, '歷史名單載入失敗，請確認連線後重新載入。'));
    });
    return () => controller.abort();
  }, [classroomId, credential, expanded, retry, rosters]);

  return <details className="archived-rosters" onToggle={event => { setExpanded(event.currentTarget.open); setError(''); }}>
    <summary>查閱歷史活動名單</summary>
    {expanded && (error
      ? <><p className="error" role="alert">{error}</p><button className="secondary-button" onClick={() => { setError(''); setRetry(value => value + 1); }}>重新載入</button></>
      : !rosters ? <p role="status">正在載入歷史名單…</p>
        : !rosters.length ? <p className="muted">這間教室還沒有封存的活動。</p>
          : rosters.map(activity => <details key={activity.activityId}>
            <summary>活動開始於 {new Date(activity.startedAt).toLocaleString('zh-TW')}</summary>
            {activity.groups.length ? <ul className="classroom-rows">{activity.groups.map(group => <li key={group.id}>
              <div><h3>{group.name}</h3><p>{group.members.map(member => member.name).join('、') || '尚無學生加入'}</p></div>
            </li>)}</ul> : <p className="muted">這場活動沒有組別。</p>}
          </details>))}
  </details>;
}
