import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SessionResponse } from '../../shared/api';
import StudentRound from './StudentRound';
import { StudentHistory } from './RoundHistory';
import TeacherPortal from './TeacherWorkspace';
import { ProjectionEntry, useOpenProjection } from './Projection';
import { ApiRequestError, basicHeader, readError, requestMessage } from './api';
import { readStudent, saveStudent, clearStudent, type SavedStudent } from './session';
import { useActivityView } from './useActivityView';
import Standings from './Standings';
import { ClassroomIcon } from './ClassroomIcon';

const studentPages = {
  '/student': '作答',
  '/student/standings': '即時排名',
  '/student/history': '歷史紀錄',
} as const;
type StudentPage = keyof typeof studentPages;

function studentPageFor(path: string): StudentPage {
  return path === '/student/standings' || path === '/student/history' ? path : '/student';
}

export default function App() {
  const path = window.location.pathname;
  if (path === '/projection' || /^\/teacher\/classrooms\/[^/]+\/projection$/.test(path)) return <ProjectionEntry />;
  return <ClassroomApp />;
}

function ClassroomApp() {
  const [role, setRole] = useState<'teacher' | 'student'>('teacher');
  const [username, setUsername] = useState("teacher");
  const [master, setMaster] = useState(false);
  const token = useRef("");
  const [credential, setCredential] = useState('');
  const [name, setName] = useState('');
  const [loginSession, setSession] = useState<Extract<SessionResponse, { role: 'student' }> | { role: 'teacher'; displayName?: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [path, setPath] = useState(window.location.pathname);
  const studentPageHeading = useRef<HTMLHeadingElement>(null);
  const operation = useRef(0);
  const loginRequest = useRef<AbortController | null>(null);
  const navigate = useCallback((next: string) => {
    if (window.location.pathname !== next) window.history.pushState(null, '', next);
    setPath(next);
  }, []);
  useEffect(() => {
    const back = () => setPath(window.location.pathname);
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);

  useEffect(() => {
    if (loginSession?.role === 'student') studentPageHeading.current?.focus();
  }, [path, loginSession?.role]);

  const logout = useCallback(() => {
    operation.current++;
    loginRequest.current?.abort();
    if (token.current) {
      void fetch('/api/sessions', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token.current } }).catch(() => {});
      token.current = '';
    }
    clearStudent();
    setSession(null); setCredential(''); setName('');
    setBusy(false); setRestoring(false); setNotice(''); setError('');
    navigate('/');
  }, [navigate]);
  const openProjection = useOpenProjection(credential, loginSession?.role === 'teacher');
  const { view, error: syncError, refresh, fullSnapshot } = useActivityView(loginSession?.role === 'student' ? loginSession : null, credential, logout);
  const session = useMemo(() => loginSession?.role === 'student' && view?.groupId && view.groupName
    ? { ...loginSession, groupId: view.groupId, groupName: view.groupName } : loginSession,
  [loginSession, view?.groupId, view?.groupName]);
  const settlementSeen = useRef(false);
  useEffect(() => {
    const published = session?.role === 'student' && Boolean(view?.settlement);
    if (published && !settlementSeen.current && window.location.pathname !== '/student') navigate('/student');
    settlementSeen.current = published;
  }, [session, view?.settlement, navigate]);

  async function authenticate(selected: 'teacher' | 'student', secret: string, studentName: string, prior?: SavedStudent) {
    const id = ++operation.current;
    loginRequest.current?.abort();
    const controller = new AbortController();
    loginRequest.current = controller;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          Authorization: basicHeader(selected, secret, true), 'Content-Type': 'application/json',
          ...(prior ? { 'X-Activity-Id': prior.activityId, 'X-Member-Id': prior.memberId,
            ...(prior.classroomId && prior.activityEpoch ? { 'X-Classroom-Id': prior.classroomId, 'X-Activity-Epoch': prior.activityEpoch } : {}),
          } : {}),
        },
        body: JSON.stringify(selected === 'student' ? { name: studentName } : { username: username.trim() }),
        signal: controller.signal,
      });
      if (id !== operation.current) return;
      if (!response.ok) {
        const body = await readError(response);
        if (id !== operation.current) return;
        if (response.status === 401 || body.code === 'ACTIVITY_EXPIRED') clearStudent();
        throw new ApiRequestError(body.message);
      }
      const body = await response.json();
      if (id !== operation.current) return;
      setMaster(body.master === true); token.current = body.token ?? "";
      const activeCredential = body.token ? "session:" + body.token : body.memberCredential ?? secret;
      setRole(selected); setCredential(activeCredential); setSession(body); setRestoring(false);
      navigate(selected === 'teacher' ? '/teacher/classrooms' : prior ? studentPageFor(window.location.pathname) : '/student');
      if (selected === 'student' && !saveStudent(body, activeCredential)) {
        setNotice('此分頁無法暫存身分，重新整理後請再輸入加入碼與名稱。');
      }
    } catch (cause) {
      if (id !== operation.current) return;
      setError(requestMessage(cause, '連線失敗，請確認服務已啟動後再試。'));
      setRestoring(false);
    } finally {
      if (id === operation.current) setBusy(false);
    }
  }

  useEffect(() => {
    const saved = readStudent();
    if (saved) {
      setRole('student'); setCredential(saved.version === 1 ? saved.joinCode : ''); setName(saved.studentName); setRestoring(true);
      void authenticate('student', saved.version === 1 ? saved.joinCode : saved.memberCredential, saved.studentName, saved);
    }
    return () => { operation.current++; loginRequest.current?.abort(); };
  }, []);

  function switchRole(next: 'teacher' | 'student') {
    if (role !== next) { logout(); setRole(next); }
  }
  function login(event: FormEvent) {
    event.preventDefault();
    void authenticate(role, role === "teacher" ? credential : credential.trim(), name);
  }
  if (!session) return <main className="login-scene">
    <div className="scene-wings" aria-hidden="true" />
    <section className="card login-card">
      <p className="login-brand"><span className="bell-tile"><ClassroomIcon name="bell" /></span>課堂活動</p>
      <h1>開始課堂活動</h1>
      <p className="muted login-hint">{restoring ? '正在驗證此分頁的學生身分…' : role === 'teacher' ? '使用教師帳號登入，開啟你的教室。' : '輸入老師提供的加入碼與你的名稱，加入教室。'}</p>
      <div className="role-switch" role="tablist" aria-label="登入身分" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'teacher' : event.key === 'End' ? 'student' : role === 'teacher' ? 'student' : 'teacher';
        switchRole(next);
        document.getElementById('role-' + next)?.focus();
      }}>
        {(['teacher', 'student'] as const).map(option => <button key={option} role="tab" id={'role-' + option}
          aria-controls="login-panel" tabIndex={role === option ? 0 : -1} aria-selected={role === option}
          className={role === option ? 'active' : ''} onClick={() => switchRole(option)}><ClassroomIcon name={option} />{option === 'teacher' ? '老師' : '學生'}</button>)}
      </div>
      <div id="login-panel" role="tabpanel" aria-labelledby={'role-' + role}>
      <form onSubmit={login} className="form-stack">
        {role === "teacher" && <label htmlFor="teacher-username">教師帳號<span className="login-field"><ClassroomIcon name="user" /><input id="teacher-username" autoComplete="username" required value={username} onChange={event => setUsername(event.target.value)} /></span></label>}
        <label htmlFor="credential">{role === 'teacher' ? '教師密碼' : '加入碼'}
          <span className="login-field"><ClassroomIcon name="key" /><input id="credential" aria-label={role === 'teacher' ? '教師密碼' : '加入碼'} type="password" autoComplete={role === 'teacher' ? 'current-password' : 'off'} required placeholder={role === 'teacher' ? '輸入教師密碼' : '輸入教室加入碼'} value={credential} onChange={event => setCredential(event.target.value)} /></span>
        </label>
        {role === 'student' && <label htmlFor="student-name">名稱
          <span className="login-field"><ClassroomIcon name="user" /><input id="student-name" aria-label="名稱" autoComplete="off" required placeholder="輸入你的名稱" value={name} onChange={event => setName(event.target.value)} /></span>
        </label>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary login-submit" aria-busy={busy} disabled={busy || !credential.trim() || (role === 'student' ? !name.trim() : !username.trim())}>{busy ? '正在驗證…' : role === 'teacher' ? '登入活動' : '加入活動'}<ClassroomIcon name="arrow" /></button>
      </form>
      </div>
    </section>
    <footer>每個分頁可獨立加入。學生重新整理時會先驗證身分。</footer>
  </main>;

  if (session.role === 'teacher') return <TeacherPortal displayName={session.displayName ?? username.trim()} {...{ master, credential, path, navigate, logout, openProjection }} />;
  const studentPage = studentPageFor(path);
  const pageLabel = (page: StudentPage) => page === '/student' && view?.settlement ? '活動結算' : studentPages[page];
  const standings = view?.standings ?? view?.settlement?.groups ?? [];
  const ownStanding = standings.find(group => group.id === session.groupId);
  return <main className={studentPage === '/student' ? 'student-shell' : 'student-shell student-wide'}>
    <header className="student-bar">
      <div><h1>{session.classroomName ?? '學生工作台'}</h1><p>{view?.groupName ?? session.groupName} · {session.studentName}</p></div>
      <button className="quiet icon-label" onClick={logout}><ClassroomIcon name="exit" />登出</button>
    </header>
    <nav className="classroom-nav student-nav" aria-label="學生工作區">
      {(Object.keys(studentPages) as StudentPage[]).map(page => <a key={page} href={page}
        aria-current={studentPage === page ? 'page' : undefined} onClick={event => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); navigate(page);
        }}><ClassroomIcon name={page === '/student' ? 'pencil' : page === '/student/history' ? 'clock' : 'trophy'} />{pageLabel(page)}</a>)}
    </nav>
    {studentPage !== '/student/standings' && <h2 className="sr-only" tabIndex={-1} ref={studentPageHeading}>{pageLabel(studentPage)}</h2>}
    {notice && <p role="status">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}
    <div hidden={studentPage !== '/student'} key={session.activityId + '/' + session.groupId}>
      <StudentRound {...{ session, credential, view, syncError, refresh, fullSnapshot }} onExpired={logout} />
    </div>
    {studentPage === '/student/standings' && <section className="round-panel student-round student-standings" aria-labelledby="student-standings-title">
      <h2 id="student-standings-title" tabIndex={-1} ref={studentPageHeading}>即時排名</h2>
      {syncError && <p className="error" role="status">{syncError}</p>}
      {ownStanding && <p className="muted" aria-live="polite">本組第 {ownStanding.rank} 名 · {ownStanding.points} 分</p>}
      {standings.length > 0 ? <Standings groups={standings} ownGroupId={session.groupId} />
        : view ? <p className="muted">目前沒有排名。</p> : !syncError && <p role="status">正在載入排名…</p>}
    </section>}
    {studentPage === '/student/history' && (view ? <StudentHistory {...{ session, credential }} roundIds={view.closedRoundIds}
      snapshot={fullSnapshot} onExpired={logout} /> : <p role="status">{syncError || '正在取得歷史紀錄…'}</p>)}
  </main>;
}
