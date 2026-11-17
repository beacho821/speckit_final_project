import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import type { SessionResponse, RosterResponse } from '../../shared/api';
import TeacherRound from './TeacherRound';
import StudentRound from './StudentRound';
import WorksheetImport from './WorksheetImport';
import Roster from './Roster';
import TeacherResults from './TeacherResults';

const labels = { teacher: '老師', student: '學生組別' } as const;

function basicToken(role: string, credential: string) {
  const bytes = new TextEncoder().encode(`${role}:${credential}`);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return `Basic ${btoa(binary)}`;
}

export default function App() {
  const [role, setRole] = useState<'teacher' | 'student'>('teacher');
  const [credential, setCredential] = useState('');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST', headers: { Authorization: basicToken(role, credential) },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? '登入失敗，請確認憑證後再試。');
      setSession(body as SessionResponse);
      if (role === 'teacher') {
        const list = await fetch('/api/roster', { headers: authHeaders(body.activityId) });
        if (!list.ok) throw new Error('無法載入組別名單，請重新登入。');
        setRoster(await list.json());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '連線失敗，請確認本機服務已啟動。');
    } finally { setBusy(false); }
  }

  function authHeaders(activityId: string) {
    return { Authorization: basicToken(role, credential), 'X-Activity-Id': activityId };
  }

  const logout = useCallback(() => { setSession(null); setRoster(null); setCredential(''); }, []);

  if (!session) return <main className="shell">
    <header className="brand"><span className="brand-mark">答</span><span>課堂線上搶答</span></header>
    <section className="card login-card">
      <p className="eyebrow">CLASSROOM BUZZER</p><h1>開始課堂活動</h1>
      <p className="muted">請選擇身分並輸入對應的登入代碼。</p>
      <div className="role-switch" role="tablist" aria-label="登入身分">
        {(Object.keys(labels) as Array<keyof typeof labels>).map(option => <button key={option} role="tab" aria-selected={role === option} className={role === option ? 'active' : ''} onClick={() => setRole(option)}>{labels[option]}</button>)}
      </div>
      <form onSubmit={login} className="form-stack">
        <label htmlFor="credential">{role === 'teacher' ? '教師密碼' : '組別代碼'}</label>
        <input id="credential" type="password" autoComplete="current-password" required value={credential} onChange={event => setCredential(event.target.value)} placeholder="輸入登入憑證" />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy || !credential}>{busy ? '正在登入…' : '登入活動'}</button>
      </form>
    </section>
    <footer>同一台電腦上的每個分頁都可獨立登入不同身分。</footer>
  </main>;

  return <main className="shell"><header className="brand"><span className="brand-mark">答</span><span>課堂線上搶答</span><button className="quiet" onClick={logout}>登出</button></header>
    <section className="card workspace"><p className="eyebrow">課堂活動 · {session.activityId.slice(0, 8)}</p>
      <h1>{session.role === 'teacher' ? '教師工作台' : `學生工作台${session.groupId ? ` · ${session.groupId}` : ''}`}</h1>
      {session.role === 'teacher' && roster ? <Roster session={session} credential={credential} roster={roster} onSave={setRoster} /> : null}
      {session.role === 'teacher' ? <>{!roster?.locked && <WorksheetImport session={session} credential={credential} />}<TeacherRound session={session} credential={credential} onExpired={logout} /><TeacherResults session={session} credential={credential} /></> : <StudentRound session={session} credential={credential} onExpired={logout} />}
    </section></main>;
}
