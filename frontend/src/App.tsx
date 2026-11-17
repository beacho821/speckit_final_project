import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SessionResponse, RosterResponse } from '../../shared/api';
import TeacherRound from './TeacherRound';
import StudentRound from './StudentRound';
import WorksheetImport from './WorksheetImport';
import Roster from './Roster';
import TeacherResults from './TeacherResults';
import { activityHeaders, basicHeader } from './api';
import { readStudent, saveStudent, clearStudent } from './session';
import { useActivityView } from './useActivityView';

export default function App() {
  const [role, setRole] = useState<'teacher' | 'student'>('teacher');
  const [credential, setCredential] = useState('');
  const [name, setName] = useState('');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const operation = useRef(0);
  const loginRequest = useRef<AbortController | null>(null);
  const confirmation = useRef(0);

  const logout = useCallback(() => {
    operation.current++;
    loginRequest.current?.abort();
    clearStudent();
    setSession(null); setRoster(null); setCredential(''); setName('');
    setBusy(false); setRestoring(false); setUnconfirmed(false); setImportBusy(false);
    setNotice(''); setError('');
  }, []);
  const { view, error: syncError, refresh, fullSnapshot } = useActivityView(session, credential, logout);

  useEffect(() => {
    if (unconfirmed && fullSnapshot > confirmation.current) setUnconfirmed(false);
  }, [fullSnapshot, unconfirmed]);

  useEffect(() => {
    if (session?.role !== 'teacher') return;
    let alive = true;
    const controller = new AbortController();
    void fetch('/api/roster', { headers: activityHeaders(session, credential), signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!alive) return;
        if (response.status === 401 || body.code === 'ACTIVITY_EXPIRED') { logout(); return; }
        if (!response.ok) throw new Error();
        setRoster(old => !old || body.rosterVersion >= old.rosterVersion ? body : old);
      })
      .catch(() => { if (alive) setError('名單同步失敗，請確認連線。'); });
    return () => { alive = false; controller.abort(); };
  }, [session, credential, view?.rosterVersion, logout]);

  async function authenticate(selected: 'teacher' | 'student', secret: string, studentName: string, priorActivity?: string) {
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
          ...(priorActivity ? { 'X-Activity-Id': priorActivity } : {}),
        },
        body: JSON.stringify(selected === 'student' ? { name: studentName } : {}),
        signal: controller.signal,
      });
      const body = await response.json();
      if (id !== operation.current) return;
      if (!response.ok) {
        if (response.status === 401 || body.code === 'ACTIVITY_EXPIRED') clearStudent();
        throw new Error(body.message ?? (selected === 'teacher' ? '請確認教師密碼。' : '請確認加入碼與名稱。'));
      }
      setRole(selected); setCredential(secret); setSession(body); setRestoring(false);
      if (selected === 'student' && !saveStudent(body, secret)) {
        setNotice('此分頁無法暫存身分，重新整理後請再輸入加入碼與名稱。');
      }
    } catch (cause) {
      if (id !== operation.current) return;
      setError(cause instanceof Error ? cause.message : '連線失敗，請確認服務已啟動。');
      setRestoring(false);
    } finally {
      if (id === operation.current) setBusy(false);
    }
  }

  useEffect(() => {
    const saved = readStudent();
    if (saved) {
      setRole('student'); setCredential(saved.joinCode); setName(saved.studentName); setRestoring(true);
      void authenticate('student', saved.joinCode, saved.studentName, saved.activityId);
    }
    return () => { operation.current++; loginRequest.current?.abort(); };
  }, []);

  function switchRole(next: 'teacher' | 'student') { logout(); setRole(next); }
  function login(event: FormEvent) {
    event.preventDefault();
    void authenticate(role, credential.trim(), name);
  }
  function importUnconfirmed() {
    confirmation.current = fullSnapshot;
    setUnconfirmed(true);
    refresh();
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

  return <main className="shell"><section className="card workspace">
    <div className="section-heading"><h1>{session.role === 'teacher' ? '教師工作台' : '學生工作台'}</h1><button className="quiet" onClick={logout}>登出</button></div>
    {session.role === 'student' && <p>{view?.groupName ?? session.groupName} · {session.studentName}</p>}
    {notice && <p role="status">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}
    {session.role === 'teacher' ? <>
      {roster && <Roster session={session} credential={credential} roster={roster} onSave={next => setRoster(old => !old || next.rosterVersion >= old.rosterVersion ? next : old)} />}
      <WorksheetImport session={session} credential={credential} preview={view?.worksheetPreview ?? null} locked={roster?.locked ?? false} unconfirmed={unconfirmed} onBusy={setImportBusy} onPublished={refresh} onUnconfirmed={importUnconfirmed} onExpired={logout} />
      <TeacherRound session={session} credential={credential} view={view} syncError={syncError} blocked={unconfirmed || importBusy} onExpired={logout} />
      <TeacherResults session={session} credential={credential} source={view?.worksheetPreview?.source} />
    </> : <StudentRound session={session} credential={credential} view={view} syncError={syncError} refresh={refresh} onExpired={logout} />}
  </section></main>;
}
