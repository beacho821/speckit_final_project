import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [credential, setCredential] = useState('');
  const [name, setName] = useState('');
  const [session, setSession] = useState<Extract<SessionResponse, { role: 'student' }> | { role: 'teacher' } | null>(null);
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
    if (session?.role === 'student') studentPageHeading.current?.focus();
  }, [path, session?.role]);

  const logout = useCallback(() => {
    operation.current++;
    loginRequest.current?.abort();
    clearStudent();
    setSession(null); setCredential(''); setName('');
    setBusy(false); setRestoring(false); setNotice(''); setError('');
    navigate('/');
  }, [navigate]);
  const openProjection = useOpenProjection(credential, session?.role === 'teacher');
  const { view, error: syncError, refresh, fullSnapshot } = useActivityView(session?.role === 'student' ? session : null, credential, logout);
  const settlementSeen = useRef(false);
  useEffect(() => {
    const published = session?.role === 'student' && Boolean(view?.settlement);
    if (published && !settlementSeen.current && window.location.pathname === '/student/history') navigate('/student');
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
          Authorization: basicHeader(selected, secret), 'Content-Type': 'application/json',
          ...(prior ? { 'X-Activity-Id': prior.activityId, 'X-Member-Id': prior.memberId,
            ...(prior.classroomId && prior.activityEpoch ? { 'X-Classroom-Id': prior.classroomId, 'X-Activity-Epoch': prior.activityEpoch } : {}),
          } : {}),
        },
        body: JSON.stringify(selected === 'student' ? { name: studentName } : {}),
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
      setRole(selected); setCredential(secret); setSession(body); setRestoring(false);
      navigate(selected === 'teacher' ? '/teacher/classrooms' : prior ? studentPageFor(window.location.pathname) : '/student');
      if (selected === 'student' && !saveStudent(body, secret)) {
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
      setRole('student'); setCredential(saved.joinCode); setName(saved.studentName); setRestoring(true);
      void authenticate('student', saved.joinCode, saved.studentName, saved);
    }
    return () => { operation.current++; loginRequest.current?.abort(); };
  }, []);

  function switchRole(next: 'teacher' | 'student') { logout(); setRole(next); }
  function login(event: FormEvent) {
    event.preventDefault();
    void authenticate(role, credential.trim(), name);
  }
  if (!session) return <main className="shell">
    <section className="card login-card">
      <p className="eyebrow">課堂活動</p><h1>開始課堂活動</h1>
      <p className="muted">{restoring ? '正在驗證此分頁的學生身分…' : '老師請輸入教師密碼；學生請輸入老師提供的加入碼與名稱。'}</p>
      <div className="role-switch" role="tablist" aria-label="登入身分">
        {(['teacher', 'student'] as const).map(option => <button key={option} role="tab" aria-selected={role === option} className={role === option ? 'active' : ''} onClick={() => switchRole(option)}>{option === 'teacher' ? '老師' : '學生'}</button>)}
      </div>
      <form onSubmit={login} className="form-stack">
        <label htmlFor="credential">{role === 'teacher' ? '教師密碼' : '加入碼'}</label>
        <input id="credential" aria-label={role === 'teacher' ? '教師密碼' : '加入碼'} type="password" autoComplete={role === 'teacher' ? 'current-password' : 'off'} required value={credential} onChange={event => setCredential(event.target.value)} />
        {role === 'student' && <>
          <label htmlFor="student-name">名稱</label>
          <input id="student-name" aria-label="名稱" autoComplete="off" required value={name} onChange={event => setName(event.target.value)} />
        </>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy || !credential.trim() || (role === 'student' && !name.trim())}>{busy ? '正在驗證…' : role === 'teacher' ? '登入活動' : '加入活動'}</button>
      </form>
    </section>
    <footer>每個分頁可獨立加入。學生重新整理時會先驗證身分。</footer>
  </main>;

  if (session.role === 'teacher') return <TeacherPortal {...{ credential, path, navigate, logout, openProjection }} />;
  const studentPage = studentPageFor(path);
  const pageLabel = (page: StudentPage) => page === '/student' && view?.settlement ? '活動結算' : studentPages[page];
  const standings = view?.standings ?? view?.settlement?.groups ?? [];
  const ownStanding = standings.find(group => group.id === session.groupId);
  return <main className="student-shell">
    <header className="student-bar">
      <div><h1>{session.classroomName ?? '學生工作台'}</h1><p>{view?.groupName ?? session.groupName} · {session.studentName}</p></div>
      <button className="quiet" onClick={logout}>登出</button>
    </header>
    <nav className="classroom-nav student-nav" aria-label="學生工作區">
      {(Object.keys(studentPages) as StudentPage[]).map(page => <a key={page} href={page}
        aria-current={studentPage === page ? 'page' : undefined} onClick={event => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); navigate(page);
        }}>{pageLabel(page)}</a>)}
    </nav>
    {studentPage !== '/student/standings' && <h2 className="sr-only" tabIndex={-1} ref={studentPageHeading}>{pageLabel(studentPage)}</h2>}
    {notice && <p role="status">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}
    <div hidden={studentPage !== '/student'} key={session.activityId}>
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
