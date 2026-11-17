import { useEffect, useState } from 'react';
import type { ActivityView, SessionResponse } from '../../shared/api';
import { activityHeaders, readError } from './api';
import RoundHistory from './RoundHistory';

export default function StudentRound({ session, credential, view, syncError = '', refresh, onExpired }: { session: SessionResponse; credential: string; view: ActivityView|null; syncError?: string; blocked?: boolean; refresh?: () => void; onExpired?: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  useEffect(() => { setError(''); setDrafts({}); }, [view?.roundId]);
  useEffect(() => {
    setRemainingMs(view?.waitRemainingMs ?? 0);
    if (!view?.waitRemainingMs) return;
    const timer = setInterval(() => setRemainingMs(current => Math.max(0, current - 250)), 250);
    return () => clearInterval(timer);
  }, [view?.waitRemainingMs, view?.roundId]);

  async function submit() {
    if (!view?.roundId || !view.unit) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/rounds/${view.roundId}/submissions`, { method: 'POST', headers: { ...activityHeaders(session, credential), 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: view.unit.questionIds.map(questionId => ({ questionId, text: drafts[questionId] ?? '' })) }) });
      if (!response.ok) { const issue=await readError(response); if(response.status===401||issue.code==='ACTIVITY_EXPIRED')onExpired?.(); else setError(issue.message); } else refresh?.();
    } catch { setError('送出結果待確認，草稿已保留；請等待同步收件狀態，不會自動重送。'); refresh?.(); }
    finally { setBusy(false); }
  }
  if (!view) return <section className="round-panel"><h2>學生作答</h2><p className="muted">{syncError || '正在連線並取得課堂狀態…'}</p></section>;
  return <section className="round-panel"><p className="eyebrow">學生作答</p><h2>{view.phase === 'active' ? '請完成本回合答案' : view.phase === 'preparing' ? '老師正在準備題目' : '等待老師開啟下一題'}</h2>
    {syncError && <p className="error" role="status">{syncError}</p>}
    {view.unit && <><p className="question-chip">題號：{view.unit.questionIds.join('、')}</p>
      {view.phase === 'active' && !view.received && <><p className="muted">{remainingMs ? `本組有優先送出時段，請稍候 ${Math.ceil(remainingMs / 1000)} 秒；可先填寫答案。` : '請填妥所有題目後一次送出。'}</p>
        <div className="answer-list">{view.unit.questionIds.map(questionId => <label key={questionId}>{questionId}<textarea rows={2} value={drafts[questionId] ?? ''} onChange={event => setDrafts(previous => ({ ...previous, [questionId]: event.target.value }))} /></label>)}</div>
        {error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy} onClick={() => void submit()}>{busy ? '送出中…' : '送出本組答案'}</button></>}
      {view.received && <div className="success-box">本組答案已收件，請等待老師公布結果。{view.ownAnswers?.map(answer => <p key={answer.questionId}>{answer.questionId}：{answer.text}</p>)}</div>}
    </>}
    {!view.unit && view.closedRoundIds.length > 0 && <RoundHistory session={session} credential={credential} roundIds={view.closedRoundIds} />}
  </section>;
}
