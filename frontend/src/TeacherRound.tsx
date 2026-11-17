import { useEffect, useState } from 'react';
import type { ActivityView, SessionResponse } from '../../shared/api';
import { activityHeaders, readError } from './api';
import RoundHistory from './RoundHistory';

export default function TeacherRound({ session, credential, view, syncError = '', blocked = false, onExpired }: { session: SessionResponse; credential: string; view: ActivityView|null; syncError?: string; blocked?: boolean; refresh?: () => void; onExpired?: () => void }) {
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSelected(''); }, [view?.roundId, view?.worksheetPreview?.source.importedAt]);

  async function action(path: string, body?: unknown) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(path, { method: 'POST', headers: { ...activityHeaders(session, credential), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) { const issue=await readError(response); if(response.status===401||issue.code==='ACTIVITY_EXPIRED')onExpired?.(); else setMessage(issue.message); return; }
      setMessage('操作已完成。');
    } catch { setMessage('連線中斷，請確認本機服務後重試。'); }
    finally { setBusy(false); }
  }

  if (!view) return <section className="round-panel"><h2>課堂回合</h2><p className="muted">{syncError || '正在連線並取得課堂狀態…'}</p></section>;
  return <section className="round-panel">
    <div className="section-heading"><div><p className="eyebrow">課堂回合</p><h2>{view.phase === 'preparing' ? '準備中' : view.phase === 'active' ? '進行中' : '尚未開題'}</h2></div><span className="phase-badge">{view.phase === 'active' ? 'LIVE' : '同步中'}</span></div>
    {syncError && <p className="error" role="status">{syncError}</p>}
    {(view.phase === 'idle' || view.phase === 'preparing') && <div className="form-stack"><label htmlFor="unit">{view.phase === 'preparing' ? '更換準備中的題目' : '選擇尚未使用的題目'}</label><select id="unit" value={selected || (view.phase === 'preparing' ? view.unit?.id ?? '' : '')} onChange={event => setSelected(event.target.value)}><option value="">請選擇題目</option>{view.availableUnits?.map(unit => <option key={unit.unitId} value={unit.unitId}>{unit.questionIds.join('、')}</option>)}</select><button className="primary" disabled={!selected || busy || blocked} onClick={() => void action('/api/rounds', { unitId: selected })}>{view.phase === 'preparing' ? '更換準備題目' : '準備這一題'}</button></div>}
    {view.unit && <div className="question-chip">題號：{view.unit.questionIds.join('、')}</div>}
    {view.phase === 'preparing' && view.roundId && <button className="primary" disabled={busy || blocked || !view.groups?.length} onClick={() => void action(`/api/rounds/${view.roundId}/start`)}>開始搶答</button>}
    {view.phase === 'active' && view.roundId && <button className="danger-button" disabled={busy} onClick={() => void action(`/api/rounds/${view.roundId}/end`)}>結束本回合</button>}
    {view.groups && <div className="group-progress">{view.groups.map(group => <article className="progress-card" key={group.id}><div><strong>{group.name}</strong><span className={group.received ? 'status received' : 'status'}>{group.received ? `已送出 · 第 ${group.rank} 順位` : '尚未送出'}</span></div>{group.answers?.map(answer => <p key={answer.questionId}><span>{answer.questionId}</span>{answer.text}</p>)}</article>)}</div>}
    {message && <p className="muted" role="status">{message}</p>}
    {view.closedRoundIds.length > 0 && <><p className="muted">已結束 {view.closedRoundIds.length} 個回合</p><RoundHistory session={session} credential={credential} roundIds={view.closedRoundIds} /></>}
  </section>;
}
