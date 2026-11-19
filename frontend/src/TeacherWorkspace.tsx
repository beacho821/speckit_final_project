import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArchivedRoster, ClassroomLocation, RosterResponse, SessionResponse } from '../../shared/api';
import { activityHeaders, basicHeader, readList, requestMessage, requireOk } from './api';
import { useActivityView } from './useActivityView';
import ClassroomList from './ClassroomList';
import TeacherRound from './TeacherRound';
import TeacherResults from './TeacherResults';
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
      : <ClassroomList credential={credential} onOpen={roomId => navigate(rootPath + '/' + roomId)} onExpired={logout} />}
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
  const changeDialog = useRef<HTMLDialogElement>(null);
  const newActivityButton = useRef<HTMLButtonElement>(null);
  const focus = useRef<HTMLHeadingElement>(null);
  const base = rootPath + '/' + room.id;
  const exitRoom = useCallback(() => navigate(rootPath), [navigate]);
  const { view, error: syncError, refresh, fullSnapshot, completedRefresh } = useActivityView(session, credential, exitRoom);
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
    setStarting(true); setError('');
    try {
      const response = await fetch(rootApi(room.id) + '/activities', { method: 'POST', headers: activityHeaders(session, credential) });
      await requireOk(response);
      closeChange();
      setRoom(await response.json());
    } catch (cause) {
      closeChange();
      setError(requestMessage(cause, '無法開始新活動，請稍後再試。'));
      refresh();
    } finally { setStarting(false); }
  }

  function closeChange() { changeDialog.current?.close?.(); newActivityButton.current?.focus(); }

  const phase = view?.phase ?? room.phase;
  const writeback = view ? Boolean(view.writebackInProgress) : room.writebackInProgress;
  const link = (to: Area) => to === 'settings' ? base : base + '/' + to;
  const roundRestriction = phase === 'active' ? '請先到控制台結束搶答，再審核並定案。'
    : phase === 'reviewing' ? '請先到控制台完成審核與定案。' : '';
  const startRestriction = roundRestriction || (writeback ? '回填進行中，請稍後再試。' : '');
  const canStartNew = view && !startRestriction && !importBusy && !waitingImport;

  return <>
    <header className="classroom-page-title">
      <a href={rootPath} onClick={event => { event.preventDefault(); exitRoom(); }}>返回教室列表</a>
      <h1 ref={focus} tabIndex={-1}>{room.name}</h1>
      <nav className="classroom-nav" aria-label="教室工作區">{(Object.keys(areaNames) as Area[]).map(item =>
        <a key={item} href={link(item)} aria-current={item === area ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate(link(item)); }}>{areaNames[item]}</a>)}
        <a className="projection-link" href={base + '/projection'} target="_blank" rel="opener"
          aria-label="開啟教室投影（新分頁）" onClick={event => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            setError(openProjection(room) ? '' : '瀏覽器阻擋投影視窗，請允許開啟新分頁後再試。');
          }}>開啟教室投影</a>
      </nav>
    </header>
    {error && <p className="error work-message" role="alert">{error}</p>}
    {area === 'groups' && <section className="work-panel">
      {roster ? <Roster {...{ session, credential, roster }} onSave={setRoster} />
        : !error && <p role="status">正在載入分組…</p>}
      <ArchivedRosters classroomId={room.id} credential={credential} />
    </section>}
    <div hidden={area === 'groups'}>
      <div className={area === 'console' ? 'work-panel console-panel' : 'work-panel'}>
        <div hidden={area !== 'settings'}>{view && <WorksheetImport {...{ session, credential }}
          catalogRevision={view?.catalogRevision} preview={view?.worksheetPreview ?? null} locked={roster?.locked ?? false}
          unconfirmed={waitingImport} completedRefresh={completedRefresh} onBusy={setImportBusy} onPublished={refresh}
          onUnconfirmed={() => setPendingImportRefresh(refresh())} onExpired={exitRoom} />}</div>
        <TeacherRound {...{ session, credential, view, syncError, refresh, fullSnapshot, completedRefresh }}
          mode={area === 'settings' ? 'settings' : 'console'} blocked={waitingImport || importBusy}
          onSettings={() => navigate(base)} onExpired={exitRoom} />
      </div>
      {area === 'console' && <div className="activity-actions">
        <button className="secondary-button" ref={newActivityButton} aria-describedby={startRestriction ? 'start-activity-hint' : undefined} disabled={!canStartNew || starting} onClick={() => changeDialog.current?.showModal()}>開始新活動</button>
        {startRestriction && <p id="start-activity-hint" className="muted">{startRestriction}</p>}
      </div>}
    </div>
    {area === 'console' && <div className="work-panel teacher-results-panel"><TeacherResults {...{ session, credential }} source={view?.worksheetPreview?.source} /></div>}
    <dialog ref={changeDialog} className="work-dialog" aria-labelledby="activity-title" onCancel={event => { event.preventDefault(); if (!starting) closeChange(); }}>
      <h2 id="activity-title">開始新活動</h2><p>保留舊紀錄，並沿用分組與完整出題清單及順序。請向學生發放新加入碼。</p>
      <div className="row-actions"><button autoFocus className="secondary-button" disabled={starting} onClick={closeChange}>取消</button>
        <button className="primary" disabled={starting} onClick={() => void startNew()}>確認開始</button></div>
    </dialog>
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
