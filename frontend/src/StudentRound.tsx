import { useEffect, useRef, useState } from 'react';
import type { ActivityView, SessionResponse } from '../../shared/api';
import { activityHeaders, readError } from './api';
import RoundHistory from './RoundHistory';

export default function StudentRound({ session, credential, view, syncError = '', refresh, fullSnapshot, onExpired }: { session: SessionResponse; credential: string; view: ActivityView|null; syncError?: string; blocked?: boolean; refresh?: () => void; fullSnapshot?: number; onExpired?: () => void }) {
  const [drafts, setDrafts] = useState<Map<string, string>>(() => new Map());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<number>();
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const submittedRound = useRef(view?.roundId);
  const [remainingMs, setRemainingMs] = useState(0);
  useEffect(() => {
    submittedRound.current = view?.roundId;
    setError(''); setDrafts(new Map()); setPending(undefined); setBusy(false);
    return () => { submittedRound.current = undefined; };
  }, [view?.roundId]);
  useEffect(() => {
    if (view?.received) { setPending(undefined); receiptHeading.current?.focus(); }
  }, [view?.received]);
  useEffect(() => {
    if (pending !== undefined && fullSnapshot !== undefined && fullSnapshot > pending) {
      setPending(undefined);
    }
  }, [pending, fullSnapshot]);
  useEffect(() => {
    setRemainingMs(view?.waitRemainingMs ?? 0);
    if (!view?.waitRemainingMs) return;
    const timer = setInterval(() => setRemainingMs(current => Math.max(0, current - 250)), 250);
    return () => clearInterval(timer);
  }, [view?.waitRemainingMs, view?.roundId]);

  async function submit() {
    if (!view?.roundId || !view.unit || busy || pending !== undefined) return;
    const roundId = view.roundId;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/rounds/${view.roundId}/submissions`, { method: 'POST', headers: { ...activityHeaders(session, credential), 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: view.unit.questionIds.map(questionId => ({ questionId, text: drafts.get(questionId) ?? '' })) }) });
      if (submittedRound.current !== roundId) return;
      if (!response.ok) {
        const issue = await readError(response);
        if (submittedRound.current !== roundId) return;
        if (response.status === 401 || issue.code === 'ACTIVITY_EXPIRED') onExpired?.();
        else {
          setError(issue.message);
          if (issue.code === 'ALREADY_RECEIVED' || issue.code === 'ROUND_EXPIRED') {
            setPending(fullSnapshot ?? 0); refresh?.();
          }
        }
      } else {
        setPending(fullSnapshot ?? 0); refresh?.();
      }
    } catch {
      if (submittedRound.current === roundId) {
        setPending(fullSnapshot ?? 0);
        setError('送出結果待確認，草稿已保留。請等待同步收件狀態，不會自動重送。'); refresh?.();
      }
    } finally { if (submittedRound.current === roundId) setBusy(false); }
  }
  if (!view) return <section className="round-panel"><h2>學生作答</h2><p className="muted">{syncError || '正在連線並取得課堂狀態…'}</p></section>;
  const title = view.received ? '本組已鎖定送出'
    : view.phase === 'active' ? '請完成本回合答案'
      : view.phase === 'reviewing' ? '已停止收件，等待老師公布結果'
        : '等待老師準備題目';
  return <section className="round-panel student-round"><h2 ref={receiptHeading} tabIndex={-1} aria-live="polite">{title}</h2>
    {syncError && <p className="error" role="status">{syncError}</p>}
    {view.unit && view.phase !== 'preparing' && <><h3>{view.unit.name || view.unit.questionIds.join('、')}</h3>
      {view.phase === 'active' && !view.received && <><p className="muted">{remainingMs ? `本組有優先送出時段，請稍候 ${Math.ceil(remainingMs / 1000)} 秒；可先填寫答案。` : '請填妥所有題目後一次送出。'}</p>
        <div className="answer-list">{view.unit.questionIds.map(questionId => <label key={questionId}>{(view.unit!.questionIds.length > 1 || (view.unit!.name && view.unit!.name !== questionId)) && <strong>{questionId}</strong>}<span className="question-prompt">{view.unit?.questions?.find(question => question.questionId === questionId)?.prompt}</span><textarea rows={2} value={drafts.get(questionId) ?? ''} onChange={event => setDrafts(previous => new Map(previous).set(questionId, event.target.value))} /></label>)}</div>
        {error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy || pending !== undefined || (Boolean(session.classroomId) && remainingMs > 0)} onClick={() => void submit()}>{busy ? '送出中…' : pending !== undefined ? '等待收件確認…' : '送出本組答案'}</button></>}
      {(view.received || view.phase === 'reviewing') && view.unit.questions?.map(question =>
        <p className="question-prompt" key={question.questionId}><b>{question.questionId}</b> {question.prompt}</p>)}
      {view.received && <div className="success-box">本組答案已收件。{view.phase !== 'ended' && '請等待老師公布結果。'}{view.ownAnswers?.map(answer => <p key={answer.questionId}>{answer.questionId}：{answer.text}</p>)}</div>}
    </>}
    {view.closedRoundIds.length > 0 && <RoundHistory session={session} credential={credential} roundIds={view.closedRoundIds} snapshot={fullSnapshot} />}
  </section>;
}
